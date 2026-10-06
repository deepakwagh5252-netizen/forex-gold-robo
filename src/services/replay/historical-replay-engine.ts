import { Candle } from '../../market-data/provider.interface';
import { 
  PaperPosition, 
  PaperOrder, 
  PaperTradeJournalEntry, 
  PaperRiskConfig, 
  PaperAccount,
  PaperOrderCloseReason,
  PaperRejectionReason
} from '../../types/paper-trading';
import { SetupRecord } from '../../types/scanner';
import { 
  ReplayState, 
  ReplayConfig, 
  ReplayCandleContext, 
  ReplayJournalRecord, 
  ReplayMetrics, 
  ReplayStepResult, 
  IReplayStrategy 
} from '../../types/replay';
import { RiskManager, DEFAULT_PAPER_RISK_CONFIG } from '../paper-trading/risk-manager';
import { PaperExecutionService } from '../paper-trading/paper-execution-service';
import { PositionMonitor } from '../paper-trading/position-monitor';
import { PaperOrderService } from '../paper-trading/paper-order-service';
import { evaluateFilterAB } from '../../strategy/filter-ab';

export interface DatasetValidationResult {
  isValid: boolean;
  error: string | null;
  candleCount: number;
}

/**
 * PHASE 6: Deterministic Historical Replay Engine
 * 
 * Strict Guarantees:
 * 1. Historical Data Input: verified Candle[] preserving source values exactly.
 * 2. Strict No-Lookahead Protection: at candle N, the strategy/context may only access
 *    candles [0..N]. Access to N+1 or later is architecturally impossible.
 * 3. Exact deterministic candle-by-candle event order (Steps A through M).
 * 4. Intrabar Execution: Reuse Phase 4B conservative intrabar logic (AMBIGUOUS_INTRABAR_EXIT).
 * 5. Execution Friction: Reuse Phase 4B friction engine without hidden assumptions.
 * 6. Position Lifecycle: PENDING -> OPEN -> PARTIALLY CLOSED -> CLOSED.
 * 7. Replay Controls: Play, Pause, Step Forward, Reset, Jump, Speed.
 * 8. Superchart Integration: delivers candles 0..N, open positions, and closed trades.
 * 9. Deterministic Auditable Journal: records every single event with full provenance.
 * 10. Reproducibility: identical inputs produce identical outputs with zero randomness.
 */
export class HistoricalReplayEngine {
  private rawDataset: readonly Candle[] = [];
  private config: ReplayConfig;
  private riskManager: RiskManager;
  private strategy: IReplayStrategy | null = null;

  // Replay State
  private state: ReplayState = 'IDLE';
  private currentIndex: number = -1; // -1: before start; 0..N: current active candle
  private isDatasetValid: boolean = false;
  private validationError: string | null = null;

  // Simulated Account & Positions
  private balance: number;
  private equity: number;
  private peakEquity: number;
  private maxDrawdownAmount: number = 0;
  private maxDrawdownPercent: number = 0;
  private currentUtcDay: string = '';
  private dailyStartingEquity: number;
  private openPositions: Map<string, PaperPosition> = new Map();
  private closedTrades: PaperTradeJournalEntry[] = [];
  private pendingOrders: PaperOrder[] = [];
  private orderSeq: number = 0;

  // Deterministic Replay Journal
  private journal: ReplayJournalRecord[] = [];

  // Listeners
  private stepListeners: ((result: ReplayStepResult) => void)[] = [];
  private stateListeners: ((state: ReplayState) => void)[] = [];

  // Playback timer (runs locally without any network or API calls)
  private playbackTimer: any = null;

  constructor(config?: Partial<ReplayConfig>) {
    this.config = {
      symbol: config?.symbol || 'XAU/USD',
      timeframe: config?.timeframe || '15m',
      initialBalance: config?.initialBalance ?? 100_000,
      riskConfig: {
        ...DEFAULT_PAPER_RISK_CONFIG,
        riskPerTradePercent: 1.0,
        maxOpenPositions: 3,
        minimumRR: 2.0,
        maximumDailyLossPercent: 3.0,
        maximumDrawdownPercent: 10.0,
        commissionPerLot: 3.50, // Explicitly configured friction
        commissionDisabled: false,
        slippagePips: 0.5,
        slippageDisabled: false,
        spreadMarkupPips: 1.0,
        spreadDisabled: false,
        requireContractSpec: false,
        ...config?.riskConfig,
      },
      stepDelayMs: config?.stepDelayMs ?? 400,
      filterABEnabled: config?.filterABEnabled ?? false,
    };

    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.peakEquity = this.config.initialBalance;
    this.dailyStartingEquity = this.config.initialBalance;
    this.riskManager = new RiskManager(this.config.riskConfig);
  }

  /**
   * STEP 11: DATA INTEGRITY VALIDATION
   * Validates dataset before starting replay:
   * - Valid timestamps (positive, non-zero)
   * - Strict chronological ascending order
   * - No duplicate timestamps
   * - Valid OHLC prices (positive, non-zero, high >= max(open, close), low <= min(open, close))
   * - Stops deterministically if invalid data is encountered.
   */
  public static validateDataset(dataset: Candle[]): DatasetValidationResult {
    if (!dataset || !Array.isArray(dataset) || dataset.length === 0) {
      return { isValid: false, error: 'DATASET_EMPTY: Historical dataset contains zero candles', candleCount: 0 };
    }

    let lastTimestamp = -1;

    for (let i = 0; i < dataset.length; i++) {
      const c = dataset[i];
      if (!c) {
        return { isValid: false, error: `INVALID_CANDLE_AT_INDEX_${i}: Candle is null or undefined`, candleCount: dataset.length };
      }

      if (typeof c.timestamp !== 'number' || isNaN(c.timestamp) || c.timestamp <= 0) {
        return { isValid: false, error: `INVALID_TIMESTAMP_AT_INDEX_${i}: timestamp must be positive number`, candleCount: dataset.length };
      }

      // Chronological & Duplicate check
      if (c.timestamp <= lastTimestamp) {
        if (c.timestamp === lastTimestamp) {
          return { isValid: false, error: `DUPLICATE_TIMESTAMP_AT_INDEX_${i}: timestamp ${c.timestamp} matches previous candle`, candleCount: dataset.length };
        }
        return { isValid: false, error: `NON_CHRONOLOGICAL_ORDER_AT_INDEX_${i}: timestamp ${c.timestamp} is before previous timestamp ${lastTimestamp}`, candleCount: dataset.length };
      }
      lastTimestamp = c.timestamp;

      // Positive prices check
      if (
        typeof c.open !== 'number' || isNaN(c.open) || c.open <= 0 ||
        typeof c.high !== 'number' || isNaN(c.high) || c.high <= 0 ||
        typeof c.low !== 'number' || isNaN(c.low) || c.low <= 0 ||
        typeof c.close !== 'number' || isNaN(c.close) || c.close <= 0
      ) {
        return { isValid: false, error: `NON_POSITIVE_PRICE_AT_INDEX_${i}: OHLC values must be numbers > 0`, candleCount: dataset.length };
      }

      // OHLC Structural validity
      const maxOC = Math.max(c.open, c.close);
      const minOC = Math.min(c.open, c.close);
      if (c.high < maxOC - 1e-5) {
        return { isValid: false, error: `INVALID_HIGH_AT_INDEX_${i}: high (${c.high}) < max(open, close) (${maxOC})`, candleCount: dataset.length };
      }
      if (c.low > minOC + 1e-5) {
        return { isValid: false, error: `INVALID_LOW_AT_INDEX_${i}: low (${c.low}) > min(open, close) (${minOC})`, candleCount: dataset.length };
      }
    }

    return { isValid: true, error: null, candleCount: dataset.length };
  }

  /**
   * Load a validated historical dataset into the replay engine.
   */
  public loadDataset(dataset: Candle[]): DatasetValidationResult {
    this.stopPlayback();
    const validation = HistoricalReplayEngine.validateDataset(dataset);
    
    if (!validation.isValid) {
      this.isDatasetValid = false;
      this.validationError = validation.error;
      this.rawDataset = [];
      this.resetSimulation();
      this.setState('ERROR');
      return validation;
    }

    // Freeze dataset to guarantee immutability across replays
    this.rawDataset = Object.freeze([...dataset]);
    this.isDatasetValid = true;
    this.validationError = null;
    this.resetSimulation();
    return validation;
  }

  /**
   * Set or swap strategy evaluator.
   */
  public setStrategy(strategy: IReplayStrategy | null): void {
    this.strategy = strategy;
  }

  /**
   * Enable or disable Phase 7F/7G Filter AB evaluation.
   */
  public setFilterABEnabled(enabled: boolean): void {
    this.config.filterABEnabled = enabled;
  }

  /**
   * Configure risk or execution parameters.
   */
  public updateRiskConfig(riskConfig: Partial<PaperRiskConfig>): void {
    this.config.riskConfig = {
      ...this.config.riskConfig,
      ...riskConfig,
    };
    this.riskManager.updateConfig(this.config.riskConfig);
  }

  /**
   * STEP 7: RESET SIMULATION
   * Returns simulation to exactly the initial state.
   */
  public resetSimulation(): void {
    this.stopPlayback();
    this.currentIndex = -1;
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.peakEquity = this.config.initialBalance;
    this.maxDrawdownAmount = 0;
    this.maxDrawdownPercent = 0;
    this.currentUtcDay = '';
    this.dailyStartingEquity = this.config.initialBalance;
    this.openPositions.clear();
    this.closedTrades = [];
    this.pendingOrders = [];
    this.orderSeq = 0;
    this.journal = [];

    this.recordJournalEvent({
      eventType: 'REPLAY_RESET',
      price: this.rawDataset[0]?.open || 0,
      reason: 'Replay reset to initial zero-state',
      equity: this.equity,
      balance: this.balance,
      drawdownPercent: 0,
    });

    this.setState(this.rawDataset.length > 0 ? 'PAUSED' : 'IDLE');
    this.notifyStep();
  }

  /**
   * STEP 2: STRICT NO-LOOKAHEAD CONTEXT FACTORY
   * At candle N, constructs a context exposing ONLY candles 0..N.
   * Attempting to access N+1 or later is architecturally impossible.
   */
  public getReplayContext(index: number): ReplayCandleContext | null {
    if (!this.isDatasetValid || index < 0 || index >= this.rawDataset.length) {
      return null;
    }

    const currentCandle = this.rawDataset[index];
    // Slices exactly 0 to index + 1 (shallow frozen copy preventing tampering)
    const historySlice = Object.freeze(this.rawDataset.slice(0, index + 1));

    return {
      currentCandle,
      history: historySlice as Candle[],
      currentIndex: index,
      totalCandles: this.rawDataset.length,
      timestamp: currentCandle.timestamp,
    };
  }

  /**
   * STEP 3: EXACT CANDLE-BY-CANDLE EVENT SEQUENCE
   * Processes single candle at currentIndex + 1.
   */
  public stepForward(): ReplayStepResult | null {
    if (!this.isDatasetValid || this.rawDataset.length === 0) {
      return null;
    }

    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.rawDataset.length) {
      this.setState('COMPLETED');
      this.stopPlayback();
      this.recordJournalEvent({
        eventType: 'REPLAY_COMPLETED',
        price: this.rawDataset[this.rawDataset.length - 1].close,
        reason: 'Dataset completed: reached last historical candle',
        equity: this.equity,
        balance: this.balance,
        drawdownPercent: this.getCurrentDrawdownPercent(),
      });
      return this.getCurrentStepResult();
    }

    this.currentIndex = nextIndex;
    const currentCandle = this.rawDataset[this.currentIndex];

    // Reset daily baseline at every 00:00 UTC boundary
    const candleUtcDay = new Date(currentCandle.timestamp).toISOString().slice(0, 10);
    if (this.currentUtcDay !== candleUtcDay) {
      this.currentUtcDay = candleUtcDay;
      this.dailyStartingEquity = this.equity;
    }

    // =========================================================================
    // EXACT CANDLE-BY-CANDLE EVENT ORDER (SPECIFICATION REQUIREMENT 3):
    // A. Advance replay clock to candle timestamp.
    // B. Make ONLY the current candle available (No-Lookahead Context).
    // C. Update indicators using available data only.
    // D. Update/manage existing open positions.
    // E. Check existing SL/TP conditions.
    // F. Evaluate new strategy signals.
    // G. Pass any new order through RiskManager.
    // H. Pass approved orders through Phase 4B simulated execution.
    // I. Update position lifecycle.
    // J. Calculate realized and unrealized P&L.
    // K. Update equity/drawdown statistics.
    // L. Record the complete journal event.
    // M. Advance to the next candle.
    // =========================================================================

    // A & B: Advance clock and build strictly no-lookahead context (0..N)
    const context = this.getReplayContext(this.currentIndex)!;

    // Log CANDLE_TICK
    this.recordJournalEvent({
      eventType: 'CANDLE_TICK',
      price: currentCandle.close,
      reason: `Candle ${this.currentIndex + 1}/${this.rawDataset.length} opened at ${currentCandle.datetime || new Date(currentCandle.timestamp).toISOString()}`,
    });

    // D & E: Update/manage existing open positions against current candle
    this.evaluateOpenPositions(currentCandle);

    // Also evaluate any pending limit/setup entry orders against current candle
    this.evaluatePendingOrders(currentCandle);

    // F: Evaluate new strategy signals (Strategy receives context containing 0..N ONLY)
    if (this.strategy) {
      const setups = this.strategy.evaluate(context);
      if (setups && setups.length > 0) {
        for (const setup of setups) {
          this.processCandidateSetup(setup, currentCandle);
        }
      }
    }

    // J & K: Calculate mark-to-market P&L, equity, drawdown
    this.updateEquityAndDrawdown(currentCandle);

    // L: Step complete notification
    const result = this.getCurrentStepResult();
    this.notifyStep();

    if (this.currentIndex >= this.rawDataset.length - 1) {
      this.setState('COMPLETED');
      this.stopPlayback();
    }

    return result;
  }

  /**
   * Evaluates open positions against the current candle (Reuses Phase 4B PositionMonitor).
   */
  private evaluateOpenPositions(candle: Candle): void {
    const positionEntries = Array.from(this.openPositions.entries());

    for (const [posId, position] of positionEntries) {
      // Reuses Phase 4B evaluateWithCandle (Strictly handles AMBIGUOUS_INTRABAR_EXIT)
      const evaluation = PositionMonitor.evaluateWithCandle(
        position,
        candle,
        this.config.riskConfig
      );

      if (evaluation.shouldClose) {
        // Position Closed
        const closedAt = new Date(candle.timestamp).toISOString();
        const grossPnL = Number(evaluation.realizedPnL.toFixed(2));
        const entryCommission = Number((position.accumulatedFees || 0).toFixed(2));
        const exitCommission = Number((evaluation.commissionFee ?? 0).toFixed(2));
        const totalFees = Number((entryCommission + exitCommission).toFixed(2));
        position.accumulatedFees = totalFees;

        const netPnL = Number((grossPnL - totalFees).toFixed(2));
        const rMultiple = position.initialRisk > 0
          ? Number((netPnL / position.initialRisk).toFixed(2))
          : evaluation.rMultiple;
        const rMultipleDisplay = PositionMonitor.formatRMultiple(rMultiple);

        // Apply realized NET P&L to account balance (matches Forward paper trading)
        this.balance = Number((this.balance + netPnL).toFixed(2));

        // Create PaperTradeJournalEntry (Phase 4B Journal schema)
        const cleanSymbol = (position.symbol || this.config.symbol || 'XAUUSD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const cleanTimeframe = (this.config.timeframe || '15M').toUpperCase();
        const setupTs = position.openedAt ? new Date(position.openedAt).getTime() : candle.timestamp;
        const tradeId = `TRD-P7F-${cleanSymbol}-${cleanTimeframe}-${setupTs}-${position.direction}`;
        const journalId = `JRN-P7F-${cleanSymbol}-${cleanTimeframe}-${setupTs}-${position.direction}`;

        const journalEntry: PaperTradeJournalEntry = {
          journalId,
          tradeId,
          positionId: position.positionId,
          paperOrderId: position.paperOrderId,
          setupId: position.setupId,
          symbol: position.symbol,
          direction: position.direction,
          setupFamily: position.setupFamily,
          timeframe: this.config.timeframe,
          entryPrice: position.entryPrice,
          exitPrice: evaluation.exitPrice,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          plannedRR: position.stopLoss !== position.entryPrice ? Math.abs(position.takeProfit - position.entryPrice) / Math.abs(position.entryPrice - position.stopLoss) : 1.5,
          positionSize: position.positionSize,
          positionSizeDisplay: position.positionSizeDisplay,
          initialRisk: position.initialRisk,
          openedAt: position.openedAt,
          closedAt,
          grossPnL,
          entryCommission,
          exitCommission,
          totalFees,
          netPnL,
          realizedPnL: netPnL,
          rMultiple,
          rMultipleDisplay,
          closeReason: evaluation.closeReason || 'MANUAL_PAPER_CLOSE',
          isAmbiguousExit: evaluation.isAmbiguousExit,
          ambiguityNote: evaluation.ambiguityNote,
          marketDataSource: position.marketDataSource,
          marketDataTimestamp: position.marketDataTimestamp,
          slippagePips: position.slippagePips,
          setupSnapshot: {
            setupId: position.setupId,
            setupFamily: position.setupFamily,
            direction: position.direction,
            timeframe: this.config.timeframe,
            symbol: position.symbol,
            entry: position.entryPrice,
            stopLoss: position.stopLoss,
            target: position.takeProfit,
            riskRewardRatio: rMultiple,
            liquidityEvidence: [],
            sweepEvidence: [],
            structureEvidence: [],
            displacementEvidence: [],
            fvgEvidence: [],
            retestEvidence: [],
            volatilityEvidence: [],
            mtfEvidence: [],
            rrEvidence: [],
            validationState: 'VALIDATED_CANDIDATE',
            provenance: {
              fact: [`Position closed at ${closedAt}`],
              calculation: [`Exit price: ${evaluation.exitPrice}`],
              modelOutput: 'REPLAY_SIMULATED',
            },
            createdAt: position.openedAt,
            validatedAt: position.openedAt,
          },
          provenance: {
            fact: [
              `Exit observed on Twelve Data Historical Replay at ${closedAt}`,
              `Execution venue: PAPER_SIMULATION`,
            ],
            calculation: [
              `Gross PnL: $${grossPnL.toFixed(2)}`,
              `Entry Commission: $${entryCommission.toFixed(2)}`,
              `Exit Commission: $${exitCommission.toFixed(2)}`,
              `Total Fees: $${totalFees.toFixed(2)}`,
              `Net Realized PnL: $${netPnL.toFixed(2)}`,
              `R-Multiple: ${rMultipleDisplay}`,
            ],
            modelOutput: `HISTORICAL_REPLAY_ENGINE_V1 - ${evaluation.closeReason}`,
          },
        };

        this.closedTrades.push(journalEntry);
        this.openPositions.delete(posId);

        // Immediate equity reconciliation after closing position
        this.updateEquityAndDrawdown(candle);

        // Record replay journal record
        this.recordJournalEvent({
          eventType: 'POSITION_CLOSED',
          price: evaluation.exitPrice,
          side: position.direction,
          positionState: 'CLOSED',
          quantity: position.positionSize ?? undefined,
          entryPrice: position.entryPrice,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          commission: totalFees,
          spread: position.spreadPips,
          slippage: position.slippagePips,
          grossPnL,
          entryCommission,
          exitCommission,
          totalFees,
          netPnL,
          realizedPnL: netPnL,
          tradeId,
          positionId: position.positionId,
          paperOrderId: position.paperOrderId,
          reason: `Position closed: ${evaluation.closeReason}${evaluation.isAmbiguousExit ? ' (AMBIGUOUS_INTRABAR_EXIT)' : ''}`,
          details: {
            tradeId,
            journalId,
            positionId: position.positionId,
            paperOrderId: position.paperOrderId,
            setupId: position.setupId,
            rMultiple,
            exitReason: evaluation.closeReason,
            isAmbiguousExit: evaluation.isAmbiguousExit,
            grossPnL,
            entryCommission,
            exitCommission,
            totalFees,
            netPnL,
          },
        });
      } else {
        // Position still open - update mark-to-market stats
        position.currentPrice = candle.close;
        position.unrealizedPnL = evaluation.unrealizedPnL;
        position.unrealizedRMultiple = evaluation.unrealizedRMultiple;
        position.marketDataTimestamp = new Date(candle.timestamp).toISOString();

        this.recordJournalEvent({
          eventType: 'POSITION_UPDATED',
          price: candle.close,
          side: position.direction,
          positionState: 'OPEN',
          quantity: position.positionSize ?? undefined,
          entryPrice: position.entryPrice,
          unrealizedPnL: evaluation.unrealizedPnL,
          positionId: position.positionId,
          paperOrderId: position.paperOrderId,
          details: {
            positionId: position.positionId,
            paperOrderId: position.paperOrderId,
            setupId: position.setupId,
          },
          reason: `Position MTM updated: unrealized PnL $${evaluation.unrealizedPnL.toFixed(2)} (${evaluation.unrealizedRMultiple.toFixed(2)}R)`,
        });
      }
    }
  }

  /**
   * Evaluates pending orders against the current candle.
   */
  private evaluatePendingOrders(candle: Candle): void {
    if (this.pendingOrders.length === 0) return;

    const remainingPending: PaperOrder[] = [];

    for (const order of this.pendingOrders) {
      const execResult = PaperExecutionService.executeWithCandle(
        order,
        candle,
        this.config.riskConfig
      );

      if (execResult.filled && execResult.newPosition) {
        this.openPositions.set(execResult.newPosition.positionId, execResult.newPosition);
        this.recordJournalEvent({
          eventType: 'ORDER_FILLED',
          price: execResult.executedPrice ?? candle.close,
          side: order.direction,
          positionState: 'OPEN',
          quantity: order.positionSize ?? undefined,
          entryPrice: execResult.executedPrice ?? candle.close,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          commission: execResult.commissionFee,
          spread: execResult.spreadPips,
          slippage: execResult.slippagePips,
          paperOrderId: order.paperOrderId,
          positionId: execResult.newPosition.positionId,
          details: {
            paperOrderId: order.paperOrderId,
            positionId: execResult.newPosition.positionId,
            setupId: order.setupId,
          },
          reason: `Pending order filled at ${execResult.executedPrice}`,
        });
      } else if (execResult.rejectionReason) {
        this.recordJournalEvent({
          eventType: 'ORDER_REJECTED',
          price: candle.close,
          side: order.direction,
          positionState: 'PENDING',
          reason: `Pending order rejected: ${execResult.error}`,
        });
      } else {
        remainingPending.push(order);
      }
    }

    this.pendingOrders = remainingPending;
  }

  /**
   * Passes candidate setups through RiskManager and PaperExecutionService.
   */
  private processCandidateSetup(setup: SetupRecord, candle: Candle): void {
    const currentMetrics = this.getMetrics();
    const dailyPnL = Number((this.equity - this.dailyStartingEquity).toFixed(2));
    const dailyLossAmount = Math.max(0, -dailyPnL);
    const dailyLossPercent = this.dailyStartingEquity > 0
      ? Number(((dailyLossAmount / this.dailyStartingEquity) * 100).toFixed(2))
      : 0;

    const syntheticAccount: PaperAccount = {
      accountId: 'REPLAY_SIMULATED_ACCOUNT',
      accountCurrency: 'USD',
      mode: 'PAPER ONLY',
      paperTradingEnabled: true,
      state: 'PAPER_ENABLED',
      riskBlockReason: null,
      initialCapital: this.config.initialBalance,
      currentEquity: this.equity,
      availableBalance: this.balance,
      usedMargin: 0,
      realizedPnL: currentMetrics.totalRealizedPnL,
      unrealizedPnL: currentMetrics.currentUnrealizedPnL,
      dailyPnL,
      peakEquity: this.peakEquity,
      currentDrawdown: this.peakEquity - this.equity,
      totalTrades: this.closedTrades.length,
      winningTrades: currentMetrics.winningTrades,
      losingTrades: currentMetrics.losingTrades,
      createdAt: new Date(candle.timestamp).toISOString(),
      updatedAt: new Date(candle.timestamp).toISOString(),
      isTradingEnabled: true,
      dailyStartingEquity: this.dailyStartingEquity,
      drawdownPercent: currentMetrics.maxDrawdownPercent,
      dailyLossPercent,
      lastUpdatedAt: new Date(candle.timestamp).toISOString(),
    };

    // Filter AB Evaluation (Harmonized with ForwardPaperEngine)
    if (this.config.filterABEnabled) {
      const regime = setup.validation?.marketRegime || 'UNKNOWN';
      const filterResult = evaluateFilterAB({
        direction: setup.direction,
        regime,
        timestamp: candle.timestamp,
      });

      if (filterResult.rejectAB) {
        this.recordJournalEvent({
          eventType: 'ORDER_REJECTED',
          price: candle.close,
          side: setup.direction === 'BULLISH' ? 'LONG' : 'SHORT',
          details: {
            setupId: setup.setupId,
          },
          reason: filterResult.reason,
        });
        return;
      }
    }

    // G. Pass through RiskManager
    const riskEval = this.riskManager.evaluateOrderEligibility(
      setup,
      syntheticAccount,
      this.openPositions.size
    );

    if (!riskEval.isEligible) {
      this.recordJournalEvent({
        eventType: 'ORDER_REJECTED',
        price: candle.close,
        side: setup.direction === 'BULLISH' ? 'LONG' : 'SHORT',
        details: {
          setupId: setup.setupId,
        },
        reason: `RiskManager blocked order: ${riskEval.decision} - ${riskEval.rejectionDetails}`,
      });
      return;
    }

    const direction: 'LONG' | 'SHORT' = setup.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    const entryPrice = setup.risk.entryReference || candle.close;
    const stopLoss = setup.risk.stopLossReference ?? (direction === 'LONG' ? entryPrice - 10 : entryPrice + 10);
    const takeProfit = setup.risk.targetReference ?? (direction === 'LONG' ? entryPrice + 20 : entryPrice - 20);
    const rawPositionSize = riskEval.sizing?.positionSize || 1.0;

    let positionSize: number;
    let lotSize: number;

    if (setup.symbol === 'XAU/USD') {
      // Contract size: 100 oz per standard lot (harmonized with ForwardPaperEngine)
      if (riskEval.sizing?.contractSpecification && riskEval.sizing.contractSpecification > 0) {
        lotSize = rawPositionSize;
        positionSize = Number((lotSize * 100).toFixed(4));
      } else if (riskEval.sizing) {
        positionSize = rawPositionSize;
        lotSize = Number((positionSize / 100).toFixed(4));
      } else {
        lotSize = rawPositionSize;
        positionSize = Number((lotSize * 100).toFixed(4));
      }
    } else {
      lotSize = rawPositionSize;
      positionSize = rawPositionSize;
    }

    const cleanSymbol = (setup.symbol || this.config.symbol || 'XAUUSD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const cleanTimeframe = (setup.timeframe || this.config.timeframe || '15M').toUpperCase();
    const setupId = setup.setupId || `SIG-P7F-${cleanSymbol}-${cleanTimeframe}-${candle.timestamp}-${direction}`;
    this.orderSeq = (this.orderSeq || 0) + 1;
    const paperOrderId = `ORD-P7F-${cleanSymbol}-${cleanTimeframe}-${candle.timestamp}-${direction}`;
    const paperOrder: PaperOrder = {
      paperOrderId,
      setupId,
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      direction,
      setupFamily: setup.setupFamily,
      executionMode: 'MARKET',
      status: 'PENDING',
      createdAt: new Date(candle.timestamp).toISOString(),
      filledAt: null,
      closedAt: null,
      plannedEntryPrice: entryPrice,
      executedEntryPrice: null,
      stopLoss,
      takeProfit,
      positionSize,
      lotSize,
      positionSizeDisplay: `${lotSize} lots (${positionSize} ${setup.symbol === 'XAU/USD' ? 'oz' : 'units'})`,
      initialRisk: Math.abs(entryPrice - stopLoss) * positionSize,
      riskAmount: Math.abs(entryPrice - stopLoss) * positionSize,
      riskPercent: this.config.riskConfig.riskPerTradePercent ?? 1.0,
      plannedReward: Math.abs(takeProfit - entryPrice) * positionSize,
      plannedRR: Math.abs(entryPrice - stopLoss) > 0 ? Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss) : 2.0,
      currentPrice: candle.close,
      unrealizedPnL: 0,
      realizedPnL: null,
      rMultiple: null,
      closeReason: null,
      rejectionReason: null,
      rejectionDetails: null,
      marketDataTimestamp: new Date(candle.timestamp).toISOString(),
      marketDataSource: 'Twelve Data Historical OHLCV (Replay)',
      setupSnapshot: PaperOrderService.createSetupSnapshot(setup),
      evidenceSnapshot: {},
    };

    this.recordJournalEvent({
      eventType: 'ORDER_SUBMITTED',
      price: entryPrice,
      side: direction,
      quantity: positionSize,
      stopLoss,
      takeProfit,
      paperOrderId: paperOrder.paperOrderId,
      details: {
        paperOrderId: paperOrder.paperOrderId,
        setupId: paperOrder.setupId,
      },
      reason: `Order submitted from setup: ${setup.setupFamily} (${setup.direction})`,
    });

    // H. Pass approved orders through Phase 4B simulated execution
    const execResult = PaperExecutionService.executeWithCandle(
      paperOrder,
      candle,
      this.config.riskConfig
    );

    if (execResult.filled && execResult.newPosition) {
      this.openPositions.set(execResult.newPosition.positionId, execResult.newPosition);
      this.recordJournalEvent({
        eventType: 'POSITION_OPENED',
        price: execResult.executedPrice ?? candle.close,
        side: direction,
        positionState: 'OPEN',
        quantity: positionSize,
        entryPrice: execResult.executedPrice ?? candle.close,
        stopLoss,
        takeProfit,
        commission: execResult.commissionFee,
        spread: execResult.spreadPips,
        slippage: execResult.slippagePips,
        positionId: execResult.newPosition.positionId,
        paperOrderId: paperOrder.paperOrderId,
        details: {
          positionId: execResult.newPosition.positionId,
          paperOrderId: paperOrder.paperOrderId,
          setupId: paperOrder.setupId,
        },
        reason: `Position opened via simulated execution: Entry ${execResult.executedPrice}`,
      });
    } else {
      this.recordJournalEvent({
        eventType: 'ORDER_REJECTED',
        price: candle.close,
        side: direction,
        paperOrderId: paperOrder.paperOrderId,
        details: {
          paperOrderId: paperOrder.paperOrderId,
          setupId: paperOrder.setupId,
        },
        reason: `Execution failed: ${execResult.rejectionReason || ''} - ${execResult.error}`,
      });
    }
  }

  /**
   * K. Mark-to-market equity and drawdown calculations.
   */
  private updateEquityAndDrawdown(candle: Candle): void {
    let totalUnrealized = 0;
    for (const pos of this.openPositions.values()) {
      totalUnrealized += (pos.unrealizedPnL || 0);
    }

    this.equity = Number((this.balance + totalUnrealized).toFixed(2));
    if (this.equity > this.peakEquity) {
      this.peakEquity = this.equity;
    }

    const ddAmount = Math.max(0, this.peakEquity - this.equity);
    const ddPercent = this.peakEquity > 0 ? Number(((ddAmount / this.peakEquity) * 100).toFixed(2)) : 0;

    if (ddAmount > this.maxDrawdownAmount) {
      this.maxDrawdownAmount = ddAmount;
    }
    if (ddPercent > this.maxDrawdownPercent) {
      this.maxDrawdownPercent = ddPercent;
    }
  }

  /**
   * J. Helper to calculate current drawdown percent.
   */
  public getCurrentDrawdownPercent(): number {
    if (this.peakEquity <= 0) return 0;
    const dd = Math.max(0, this.peakEquity - this.equity);
    return Number(((dd / this.peakEquity) * 100).toFixed(2));
  }

  /**
   * Records a deterministic replay journal event.
   */
  private recordJournalEvent(event: Omit<ReplayJournalRecord, 'id' | 'timestamp' | 'datetimeUtc' | 'symbol' | 'timeframe' | 'candleIndex'> & { price: number }): void {
    const currentCandle = this.rawDataset[this.currentIndex];
    const timestamp = currentCandle ? currentCandle.timestamp : (this.rawDataset[0]?.timestamp || 0);
    const datetimeUtc = currentCandle?.datetime || (timestamp > 0 ? new Date(timestamp).toISOString() : new Date(0).toISOString());
    const eventId = `EVT-${event.eventType}-${this.journal.length + 1}-${timestamp}`;

    const record: ReplayJournalRecord = {
      id: `RJRN-${this.journal.length + 1}-${timestamp}`,
      eventId,
      timestamp,
      datetimeUtc,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      candleIndex: this.currentIndex,
      equity: this.equity,
      balance: this.balance,
      drawdownPercent: this.getCurrentDrawdownPercent(),
      ...event,
    };

    this.journal.push(record);
  }

  /**
   * Jump directly to a specific timestamp or index.
   * Deterministically replays from 0 up to target to guarantee state integrity.
   */
  public jumpToIndex(targetIndex: number): void {
    if (!this.isDatasetValid || targetIndex < 0 || targetIndex >= this.rawDataset.length) {
      return;
    }

    this.resetSimulation();
    while (this.currentIndex < targetIndex) {
      this.stepForward();
    }
  }

  /**
   * STEP 7: PLAYBACK CONTROLS
   */
  public play(): void {
    if (this.state === 'PLAYING') return;
    if (this.currentIndex >= this.rawDataset.length - 1) {
      this.resetSimulation();
    }
    this.setState('PLAYING');
    this.playbackTimer = setInterval(() => {
      if (this.currentIndex >= this.rawDataset.length - 1) {
        this.stopPlayback();
        this.setState('COMPLETED');
      } else {
        this.stepForward();
      }
    }, this.config.stepDelayMs);
  }

  public pause(): void {
    this.stopPlayback();
    this.setState('PAUSED');
  }

  private stopPlayback(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  public setPlaybackSpeed(delayMs: number): void {
    this.config.stepDelayMs = Math.max(50, delayMs);
    if (this.state === 'PLAYING') {
      this.stopPlayback();
      this.play();
    }
  }

  private setState(newState: ReplayState): void {
    this.state = newState;
    this.stateListeners.forEach(l => l(newState));
  }

  public getState(): ReplayState {
    return this.state;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public getJournal(): readonly ReplayJournalRecord[] {
    return this.journal;
  }

  public getOpenPositions(): PaperPosition[] {
    return Array.from(this.openPositions.values());
  }

  public getClosedTrades(): PaperTradeJournalEntry[] {
    return [...this.closedTrades];
  }

  /**
   * Provides current metrics.
   */
  public getMetrics(): ReplayMetrics {
    const totalTrades = this.closedTrades.length;
    const winningTrades = this.closedTrades.filter(t => t.realizedPnL > 0).length;
    const losingTrades = this.closedTrades.filter(t => t.realizedPnL <= 0).length;
    const winRate = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(2)) : 0;
    const totalRealizedPnL = Number(this.closedTrades.reduce((acc, t) => acc + t.realizedPnL, 0).toFixed(2));
    
    let currentUnrealizedPnL = 0;
    for (const pos of this.openPositions.values()) {
      currentUnrealizedPnL += (pos.unrealizedPnL || 0);
    }

    return {
      totalCandles: this.rawDataset.length,
      processedCandles: Math.max(0, this.currentIndex + 1),
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalRealizedPnL,
      currentUnrealizedPnL: Number(currentUnrealizedPnL.toFixed(2)),
      currentEquity: this.equity,
      currentBalance: this.balance,
      peakEquity: this.peakEquity,
      maxDrawdownAmount: Number(this.maxDrawdownAmount.toFixed(2)),
      maxDrawdownPercent: Number(this.maxDrawdownPercent.toFixed(2)),
      currentDrawdownPercent: this.getCurrentDrawdownPercent(),
    };
  }

  /**
   * STEP 8: SUPERCHART INTEGRATION DATA FEED
   * Returns:
   * - Only historical candles up to current replay index (0..currentIndex)
   * - Never exposes future bars
   */
  public getChartCandles(): Candle[] {
    if (!this.isDatasetValid || this.currentIndex < 0) {
      return [];
    }
    return this.rawDataset.slice(0, this.currentIndex + 1);
  }

  public getCurrentStepResult(): ReplayStepResult {
    const currentCandle = this.rawDataset[this.currentIndex] || {
      timestamp: 0,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      volume: 0,
      isVerified: true,
    };

    return {
      candleIndex: this.currentIndex,
      timestamp: currentCandle.timestamp,
      datetimeUtc: currentCandle.datetime || new Date(currentCandle.timestamp).toISOString(),
      currentCandle,
      events: this.journal.filter(j => j.candleIndex === this.currentIndex),
      openPositions: this.getOpenPositions(),
      closedTrades: this.getClosedTrades(),
      metrics: this.getMetrics(),
      isComplete: this.currentIndex >= this.rawDataset.length - 1,
    };
  }

  public getAccount(): PaperAccount {
    const currentMetrics = this.getMetrics();
    return {
      accountId: 'REPLAY_SIMULATED_ACCOUNT',
      accountCurrency: 'USD',
      mode: 'PAPER ONLY',
      paperTradingEnabled: true,
      state: 'PAPER_ENABLED',
      riskBlockReason: null,
      initialCapital: this.config.initialBalance,
      currentEquity: this.equity,
      availableBalance: this.balance,
      usedMargin: 0,
      realizedPnL: currentMetrics.totalRealizedPnL,
      unrealizedPnL: currentMetrics.currentUnrealizedPnL,
      dailyPnL: Number((this.equity - this.dailyStartingEquity).toFixed(2)),
      peakEquity: this.peakEquity,
      currentDrawdown: this.peakEquity - this.equity,
      totalTrades: this.closedTrades.length,
      winningTrades: currentMetrics.winningTrades,
      losingTrades: currentMetrics.losingTrades,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isTradingEnabled: true,
      dailyStartingEquity: this.dailyStartingEquity,
      drawdownPercent: currentMetrics.maxDrawdownPercent,
      dailyLossPercent: this.dailyStartingEquity > 0 ? Number((Math.max(0, this.dailyStartingEquity - this.equity) / this.dailyStartingEquity * 100).toFixed(2)) : 0,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  public getDailyStartingEquity(): number {
    return this.dailyStartingEquity;
  }

  public getCurrentUtcDay(): string {
    return this.currentUtcDay;
  }

  public onStep(listener: (result: ReplayStepResult) => void): () => void {
    this.stepListeners.push(listener);
    return () => {
      this.stepListeners = this.stepListeners.filter(l => l !== listener);
    };
  }

  public onStateChange(listener: (state: ReplayState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  private notifyStep(): void {
    const result = this.getCurrentStepResult();
    this.stepListeners.forEach(l => l(result));
  }
}
