import { 
  PaperAccount, 
  PaperRiskConfig, 
  PaperOrder, 
  PaperPosition, 
  PaperTradeJournalEntry, 
  PaperExecutionMode, 
  PaperRejectionReason, 
  PaperOrderCloseReason 
} from '../../types/paper-trading';
import { SetupRecord, ScannerSummary } from '../../types/scanner';
import { InstrumentQuote } from '../../types/terminal';
import { Candle } from '../../market-data/provider.interface';
import { RiskManager, DEFAULT_PAPER_RISK_CONFIG } from './risk-manager';
import { paperAccountService, PaperAccountService } from './paper-account-service';
import { paperOrderService, PaperOrderService } from './paper-order-service';
import { tradeJournalService, TradeJournalService } from './trade-journal-service';
import { PaperExecutionService } from './paper-execution-service';
import { PositionMonitor } from './position-monitor';

const POSITIONS_STORAGE_KEY = 'forex_gold_robo_paper_positions_v1';

export interface ProcessSetupResult {
  success: boolean;
  order: PaperOrder | null;
  position: PaperPosition | null;
  rejectionReason: PaperRejectionReason | null;
  message: string;
}

export class PaperTradingEngine {
  private riskManager: RiskManager;
  private accountService: PaperAccountService;
  private orderService: PaperOrderService;
  private journalService: TradeJournalService;
  private openPositions: Map<string, PaperPosition> = new Map();
  private positionListeners: ((positions: PaperPosition[]) => void)[] = [];

  constructor(
    riskConfig: Partial<PaperRiskConfig> = {},
    accountService: PaperAccountService = paperAccountService,
    orderService: PaperOrderService = paperOrderService,
    journalService: TradeJournalService = tradeJournalService
  ) {
    this.riskManager = new RiskManager(riskConfig);
    this.accountService = accountService;
    this.orderService = orderService;
    this.journalService = journalService;
    this.loadPersistedPositions();
  }

  private loadPersistedPositions(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PaperPosition[];
          if (Array.isArray(parsed)) {
            this.openPositions.clear();
            for (const pos of parsed) {
              this.openPositions.set(pos.positionId, pos);
            }
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  private persistPositions(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const arr = Array.from(this.openPositions.values());
        window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(arr));
      }
    } catch {
      // Ignore
    }
    this.notifyPositionListeners();
  }

  private notifyPositionListeners(): void {
    const list = this.getOpenPositions();
    for (const listener of this.positionListeners) {
      try {
        listener(list);
      } catch {
        // Ignore
      }
    }
  }

  subscribePositions(listener: (positions: PaperPosition[]) => void): () => void {
    this.positionListeners.push(listener);
    listener(this.getOpenPositions());
    return () => {
      this.positionListeners = this.positionListeners.filter((l) => l !== listener);
    };
  }

  getOpenPositions(): PaperPosition[] {
    return Array.from(this.openPositions.values());
  }

  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  getAccountService(): PaperAccountService {
    return this.accountService;
  }

  getOrderService(): PaperOrderService {
    return this.orderService;
  }

  getJournalService(): TradeJournalService {
    return this.journalService;
  }

  enablePaperTrading(enabled: boolean): PaperAccount {
    return this.accountService.setTradingEnabled(enabled);
  }

  resetAll(newCapital: number = 1_000_000): void {
    this.openPositions.clear();
    this.persistPositions();
    this.orderService.clearOrders();
    this.journalService.clearJournal();
    this.accountService.resetAccount(newCapital);
  }

  /**
   * Primary entry point for turning a VALIDATED_CANDIDATE into a paper order/position.
   * Strictly enforces Section 1, 2, 3, 4, 7, 8, 13, 14, 18.
   */
  evaluateAndProcessSetup(
    setup: SetupRecord,
    quote?: InstrumentQuote | null,
    executionMode: PaperExecutionMode = 'MARKET'
  ): ProcessSetupResult {
    const account = this.accountService.getAccount();

    // 1. Check duplicate setup protection (Section 13)
    // One setup -> maximum one paper trade
    if (this.orderService.hasActiveOrderForSetup(setup.setupId)) {
      return {
        success: false,
        order: null,
        position: null,
        rejectionReason: 'DUPLICATE_SETUP',
        message: `DUPLICATE SETUP: A paper trade already exists for setup ${setup.setupId}.`,
      };
    }

    // 2. Risk & eligibility evaluation
    const eligibility = this.riskManager.evaluateOrderEligibility(
      setup,
      account,
      this.openPositions.size
    );

    if (!eligibility.isEligible || !eligibility.sizing) {
      return {
        success: false,
        order: null,
        position: null,
        rejectionReason: eligibility.rejectionReason,
        message: eligibility.rejectionDetails || 'Order rejected by risk management.',
      };
    }

    // 2b. Validate simulation friction parameters (Commission, Spread, Slippage)
    // No hidden assumptions: require explicit configuration or explicit OFF
    const riskConfig = this.riskManager.getConfig();
    const frictionEval = PaperExecutionService.evaluateFrictionConfig(riskConfig);
    if (!frictionEval.isValid) {
      return {
        success: false,
        order: null,
        position: null,
        rejectionReason: frictionEval.status as PaperRejectionReason,
        message: frictionEval.errorMessage || `Order blocked: ${frictionEval.status}. Configure simulation parameters or select OFF.`,
      };
    }

    // 3. Create deterministic paper order (starts in PENDING)
    const order = this.orderService.createOrder(setup, eligibility.sizing, executionMode);

    // 4. If verified quote is available, attempt immediate fill
    if (quote && quote.ltp !== null && quote.ltp !== undefined && quote.ltp > 0) {
      const execResult = PaperExecutionService.executeWithQuote(order, quote, riskConfig);

      if (execResult.filled && execResult.newPosition) {
        // Transition order to OPEN
        const openOrder = this.orderService.updateOrderStatus(order.paperOrderId, 'OPEN', {
          filledAt: execResult.timestamp || new Date().toISOString(),
          executedEntryPrice: execResult.executedPrice,
          currentPrice: execResult.executedPrice,
          slippagePips: execResult.slippagePips,
          spreadPips: execResult.spreadPips,
          commissionFee: execResult.commissionFee,
          commissionMode: execResult.commissionMode,
          spreadMode: execResult.spreadMode,
          slippageMode: execResult.slippageMode,
          marketDataTimestamp: execResult.timestamp,
          marketDataSource: execResult.source,
        });

        // Store active open position
        this.openPositions.set(execResult.newPosition.positionId, execResult.newPosition);
        this.persistPositions();

        // Update margin & unrealized P&L
        this.recalculateAccountPnL();

        return {
          success: true,
          order: openOrder,
          position: execResult.newPosition,
          rejectionReason: null,
          message: `Paper order filled at verified market price ${execResult.executedPrice} USD (slippage: ${execResult.slippagePips} pips, spread: ${execResult.spreadPips} pips, fee: $${execResult.commissionFee}).`,
        };
      } else if (execResult.rejectionReason) {
        // Order rejected due to market data failure
        const rejectedOrder = this.orderService.updateOrderStatus(order.paperOrderId, 'REJECTED', {
          rejectionReason: execResult.rejectionReason,
          rejectionDetails: execResult.error,
          closedAt: new Date().toISOString(),
        });

        return {
          success: false,
          order: rejectedOrder,
          position: null,
          rejectionReason: execResult.rejectionReason,
          message: execResult.error || 'ORDER NOT FILLED: NO VERIFIED MARKET PRICE',
        };
      }
    }

    // If Mode A without verified quote, reject immediately per Section 8
    if (executionMode === 'MARKET' && (!quote || quote.ltp === null)) {
      const rejectedOrder = this.orderService.updateOrderStatus(order.paperOrderId, 'REJECTED', {
        rejectionReason: 'NO_VERIFIED_MARKET_DATA',
        rejectionDetails: 'ORDER NOT FILLED: NO VERIFIED MARKET PRICE',
        closedAt: new Date().toISOString(),
      });

      return {
        success: false,
        order: rejectedOrder,
        position: null,
        rejectionReason: 'NO_VERIFIED_MARKET_DATA',
        message: 'ORDER NOT FILLED: NO VERIFIED MARKET PRICE',
      };
    }

    return {
      success: true,
      order,
      position: null,
      rejectionReason: null,
      message: 'Paper order created and waiting for verified entry condition (PENDING).',
    };
  }

  /**
   * Evaluates and updates open positions when a verified quote arrives.
   */
  onQuoteUpdate(quote: InstrumentQuote): void {
    if (!quote || !quote.symbol || quote.ltp === null || quote.ltp <= 0) {
      return;
    }

    const riskConfig = this.riskManager.getConfig();

    // 1. First check pending orders for this symbol
    const pendingOrders = this.orderService.getAllOrders().filter(
      (o) => o.status === 'PENDING' && o.symbol === quote.symbol
    );

    for (const pending of pendingOrders) {
      const execResult = PaperExecutionService.executeWithQuote(pending, quote, riskConfig);
      if (execResult.filled && execResult.newPosition) {
        this.orderService.updateOrderStatus(pending.paperOrderId, 'OPEN', {
          filledAt: execResult.timestamp || new Date().toISOString(),
          executedEntryPrice: execResult.executedPrice,
          currentPrice: execResult.executedPrice,
          slippagePips: execResult.slippagePips,
          spreadPips: execResult.spreadPips,
          commissionFee: execResult.commissionFee,
          commissionMode: execResult.commissionMode,
          spreadMode: execResult.spreadMode,
          slippageMode: execResult.slippageMode,
          marketDataTimestamp: execResult.timestamp,
          marketDataSource: execResult.source,
        });
        this.openPositions.set(execResult.newPosition.positionId, execResult.newPosition);
        this.persistPositions();
      }
    }

    // 2. Monitor open positions for this symbol
    for (const position of Array.from(this.openPositions.values())) {
      if (position.symbol !== quote.symbol) {
        continue;
      }

      const evaluation = PositionMonitor.evaluateWithQuote(position, quote, riskConfig);

      if (evaluation.shouldClose && evaluation.closeReason) {
        this.closePositionInternal(
          position, 
          evaluation.closeReason, 
          evaluation.exitPrice, 
          evaluation.realizedPnL, 
          evaluation.rMultiple, 
          evaluation.isAmbiguousExit, 
          evaluation.ambiguityNote, 
          quote.timestamp, 
          quote.provider || 'Twelve Data API',
          evaluation.commissionFee
        );
      } else {
        // Update mark-to-market prices
        position.currentPrice = evaluation.currentPrice;
        position.unrealizedPnL = evaluation.unrealizedPnL;
        position.unrealizedRMultiple = evaluation.unrealizedRMultiple;
        position.marketDataTimestamp = evaluation.marketDataTimestamp;

        // Update corresponding open order
        this.orderService.updateOrderStatus(position.paperOrderId, 'OPEN', {
          currentPrice: evaluation.currentPrice,
          unrealizedPnL: evaluation.unrealizedPnL,
          rMultiple: evaluation.unrealizedRMultiple,
          marketDataTimestamp: evaluation.marketDataTimestamp,
        });
      }
    }

    this.persistPositions();
    this.recalculateAccountPnL();
  }

  /**
   * Evaluates and updates open positions against a completed verified candle.
   */
  onCandleUpdate(symbol: string, candle: Candle): void {
    if (!candle || candle.close <= 0) {
      return;
    }

    const riskConfig = this.riskManager.getConfig();

    for (const position of Array.from(this.openPositions.values())) {
      if (position.symbol !== symbol) {
        continue;
      }

      const evaluation = PositionMonitor.evaluateWithCandle(position, candle, riskConfig);

      if (evaluation.shouldClose && evaluation.closeReason) {
        this.closePositionInternal(
          position,
          evaluation.closeReason,
          evaluation.exitPrice,
          evaluation.realizedPnL,
          evaluation.rMultiple,
          evaluation.isAmbiguousExit,
          evaluation.ambiguityNote,
          new Date(candle.timestamp).toISOString(),
          'Twelve Data Historical OHLCV',
          evaluation.commissionFee
        );
      } else {
        position.currentPrice = evaluation.currentPrice;
        position.unrealizedPnL = evaluation.unrealizedPnL;
        position.unrealizedRMultiple = evaluation.unrealizedRMultiple;
        position.marketDataTimestamp = evaluation.marketDataTimestamp;

        this.orderService.updateOrderStatus(position.paperOrderId, 'OPEN', {
          currentPrice: evaluation.currentPrice,
          unrealizedPnL: evaluation.unrealizedPnL,
          rMultiple: evaluation.unrealizedRMultiple,
          marketDataTimestamp: evaluation.marketDataTimestamp,
        });
      }
    }

    this.persistPositions();
    this.recalculateAccountPnL();
  }

  /**
   * Allows executing a partial take profit (e.g. 50% partial exit at current market rate)
   */
  partialClosePosition(
    positionId: string, 
    portionPercent: number = 50, 
    currentQuote?: InstrumentQuote | null
  ): boolean {
    const position = this.openPositions.get(positionId);
    if (!position || !position.positionSize || position.positionSize <= 0) return false;

    const fraction = Math.min(Math.max(portionPercent / 100, 0.1), 0.9);
    const closedSize = Number((position.positionSize * fraction).toFixed(2));
    const remainingSize = Number((position.positionSize - closedSize).toFixed(2));

    const rawExitPrice = currentQuote?.ltp ?? position.currentPrice;
    const isLong = position.direction === 'LONG';
    const riskConfig = this.riskManager.getConfig();

    const effectiveConfig = {
      ...riskConfig,
      commissionDisabled: position.commissionMode === 'DISABLED' ? true : (riskConfig?.commissionDisabled ?? false),
      commissionPerLot: position.commissionMode === 'DISABLED' ? 0 : (riskConfig?.commissionPerLot ?? null),
      spreadDisabled: position.spreadMode === 'DISABLED' ? true : (riskConfig?.spreadDisabled ?? false),
      spreadMarkupPips: position.spreadMode === 'DISABLED' ? 0 : (position.spreadPips ?? riskConfig?.spreadMarkupPips ?? null),
      slippageDisabled: position.slippageMode === 'DISABLED' ? true : (riskConfig?.slippageDisabled ?? false),
      slippagePips: position.slippageMode === 'DISABLED' ? 0 : (position.slippagePips ?? riskConfig?.slippagePips ?? null),
    };

    const closedLotSize = position.lotSize ? Number((position.lotSize * (portionPercent / 100)).toFixed(4)) : null;
    const friction = PaperExecutionService.calculateFillsWithFriction(
      rawExitPrice,
      isLong ? 'SHORT' : 'LONG',
      position.symbol,
      closedSize,
      effectiveConfig,
      false,
      closedLotSize
    );

    const exitPrice = friction.executedPrice;
    const grossPnL = isLong
      ? (exitPrice - position.entryPrice) * closedSize
      : (position.entryPrice - exitPrice) * closedSize;
    const netPnL = Number((grossPnL - friction.commissionFee).toFixed(2));

    const initialRiskDist = Math.abs(position.entryPrice - position.stopLoss);
    const rMultiple = initialRiskDist > 0
      ? Number(((isLong ? exitPrice - position.entryPrice : position.entryPrice - exitPrice) / initialRiskDist).toFixed(2))
      : 0;

    const exitRecord = {
      timestamp: new Date().toISOString(),
      portionPercent,
      closedSize,
      exitPrice,
      realizedPnL: netPnL,
      commissionFee: friction.commissionFee,
      rMultiple,
    };

    // Update position
    position.positionSize = remainingSize;
    position.positionSizeDisplay = `${remainingSize} units (Partial ${portionPercent}% closed)`;
    position.accumulatedFees = (position.accumulatedFees || 0) + friction.commissionFee;
    position.realizedPnL = (position.realizedPnL || 0) + netPnL;
    if (!position.partialExits) position.partialExits = [];
    position.partialExits.push(exitRecord);

    // Apply partial realized PnL to account
    this.accountService.applyRealizedPnL(netPnL, netPnL > 0);

    // Update order status
    this.orderService.updateOrderStatus(position.paperOrderId, 'OPEN', {
      positionSize: remainingSize,
      positionSizeDisplay: position.positionSizeDisplay,
      remainingSize,
      partialExits: position.partialExits,
    });

    this.persistPositions();
    this.recalculateAccountPnL();
    return true;
  }

  /**
   * Allows manual paper close from UI (Section 20: PAPER CLOSE)
   */
  closePositionManually(positionId: string, currentQuote?: InstrumentQuote | null): boolean {
    const position = this.openPositions.get(positionId);
    if (!position) return false;

    const rawExitPrice = currentQuote?.ltp ?? position.currentPrice;
    const isLong = position.direction === 'LONG';
    const riskConfig = this.riskManager.getConfig();

    const friction = PaperExecutionService.calculateFillsWithFriction(
      rawExitPrice,
      isLong ? 'SHORT' : 'LONG',
      position.symbol,
      position.positionSize,
      riskConfig,
      false,
      position.lotSize
    );

    const exitPrice = friction.executedPrice;
    const realizedPnL = position.positionSize
      ? isLong
        ? (exitPrice - position.entryPrice) * position.positionSize
        : (position.entryPrice - exitPrice) * position.positionSize
      : 0;

    const initialRiskDist = Math.abs(position.entryPrice - position.stopLoss);
    const rMultiple = position.initialRisk > 0 && position.positionSize
      ? Number((realizedPnL / position.initialRisk).toFixed(2))
      : initialRiskDist > 0
      ? Number(((isLong ? exitPrice - position.entryPrice : position.entryPrice - exitPrice) / initialRiskDist).toFixed(2))
      : 0;

    this.closePositionInternal(
      position,
      'MANUAL_PAPER_CLOSE',
      Number(exitPrice.toFixed(4)),
      Number(realizedPnL.toFixed(2)),
      rMultiple,
      false,
      undefined,
      currentQuote?.timestamp || new Date().toISOString(),
      currentQuote?.provider || 'Manual Simulation Action',
      friction.commissionFee
    );

    return true;
  }

  private closePositionInternal(
    position: PaperPosition,
    closeReason: PaperOrderCloseReason,
    exitPrice: number,
    realizedPnL: number,
    rMultiple: number,
    isAmbiguousExit: boolean,
    ambiguityNote: string | undefined,
    marketDataTimestamp: string | null,
    marketDataSource: string,
    exitCommissionFee: number = 0
  ): void {
    const closedAt = new Date().toISOString();
    const order = this.orderService.getOrderById(position.paperOrderId);

    // Total fees: entry fees + exit fees
    const totalFees = Number(((position.accumulatedFees || 0) + exitCommissionFee).toFixed(2));
    const priorRealizedPnL = position.realizedPnL || 0;
    const netPnL = Number((realizedPnL + priorRealizedPnL - totalFees).toFixed(2));

    // 1. Update order status to CLOSED
    if (order) {
      this.orderService.updateOrderStatus(order.paperOrderId, 'CLOSED', {
        closedAt,
        currentPrice: exitPrice,
        unrealizedPnL: 0,
        realizedPnL: netPnL,
        rMultiple,
        closeReason,
        isAmbiguousExit,
        ambiguityNote,
        marketDataTimestamp,
        marketDataSource,
        partialExits: position.partialExits,
      });
    }

    // Explicit friction provenance attribution (Phase 4B Execution Integrity)
    const commissionSource = (position.commissionMode === 'DISABLED' || totalFees === 0)
      ? 'DISABLED'
      : 'USER CONFIGURED SIMULATION PARAMETER';

    const spreadSource = (position.spreadMode === 'DISABLED' || (position.spreadPips ?? 0) === 0)
      ? 'DISABLED'
      : 'USER CONFIGURED SIMULATION PARAMETER';

    const slippageSource = (position.slippageMode === 'DISABLED' || (position.slippagePips ?? 0) === 0)
      ? 'DISABLED'
      : 'USER CONFIGURED SIMULATION PARAMETER';

    const commissionFact = `Commission: $${totalFees.toFixed(2)} | Source: ${commissionSource}`;
    const spreadFact = `Spread: ${position.spreadPips ?? 0} pips | Source: ${spreadSource}`;
    const slippageFact = `Slippage: ${position.slippagePips ?? 0} pips | Source: ${slippageSource}`;

    // 2. Record to Trade Journal with 3-tier provenance (Section 16 & 17)
    const journalEntry: PaperTradeJournalEntry = {
      journalId: `JRN-${Date.now()}-${position.symbol.replace('/', '')}-${Math.floor(Math.random() * 1000)}`,
      paperOrderId: position.paperOrderId,
      setupId: position.setupId,
      symbol: position.symbol,
      direction: position.direction,
      setupFamily: position.setupFamily,
      timeframe: order?.timeframe || '15min',
      openedAt: position.openedAt,
      closedAt,
      entryPrice: position.entryPrice,
      exitPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      plannedRR: order?.plannedRR || 2.0,
      realizedPnL: netPnL,
      netPnL,
      totalFees,
      slippagePips: position.slippagePips,
      rMultiple,
      rMultipleDisplay: PositionMonitor.formatRMultiple(rMultiple),
      positionSize: position.initialPositionSize || position.positionSize,
      positionSizeDisplay: position.positionSizeDisplay,
      initialRisk: position.initialRisk,
      closeReason,
      isAmbiguousExit,
      ambiguityNote,
      marketDataSource,
      marketDataTimestamp,
      partialExits: position.partialExits,
      provenance: {
        fact: [
          `Verified Market Entry: ${position.entryPrice} USD (${position.openedAt})`,
          `Verified Market Exit: ${exitPrice} USD (${closedAt})`,
          `Data Source: ${marketDataSource}`,
          `Stop Loss Level: ${position.stopLoss} USD | Target Level: ${position.takeProfit} USD`,
          commissionFact,
          spreadFact,
          slippageFact,
        ],
        calculation: [
          `Gross P&L: ${realizedPnL.toFixed(2)} USD`,
          `Net Realized P&L (after fees): ${netPnL.toFixed(2)} USD`,
          `Realized R Multiple: ${PositionMonitor.formatRMultiple(rMultiple)}`,
          `Initial Risk Amount: ${position.initialRisk.toFixed(2)} USD`,
          `Position Sizing: ${position.positionSizeDisplay}`,
          ...(position.partialExits && position.partialExits.length > 0 
            ? [`Partial Exits: ${position.partialExits.length} tranche(s) taken`] 
            : []),
        ],
        modelOutput: `Setup Family: ${position.setupFamily} [${position.direction}] -> Status: CLOSED (${closeReason})`,
      },
      setupSnapshot: order?.setupSnapshot || {
        setupId: position.setupId,
        setupFamily: position.setupFamily,
        direction: position.direction,
        timeframe: '15min',
        symbol: position.symbol,
        entry: position.entryPrice,
        stopLoss: position.stopLoss,
        target: position.takeProfit,
        riskRewardRatio: 2.0,
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
        provenance: { fact: [], calculation: [], modelOutput: 'VALIDATED_CANDIDATE' },
        createdAt: position.openedAt,
        validatedAt: position.openedAt,
      },
    };

    this.journalService.recordTrade(journalEntry);

    // 3. Update Paper Account (Realized net P&L)
    const isWin = netPnL > 0;
    this.accountService.applyRealizedPnL(netPnL, isWin);

    // 4. Remove from open positions
    this.openPositions.delete(position.positionId);
    this.persistPositions();
    this.recalculateAccountPnL();
  }

  private recalculateAccountPnL(): void {
    let totalUnrealized = 0;
    for (const pos of this.openPositions.values()) {
      totalUnrealized += pos.unrealizedPnL;
    }
    const config = this.riskManager.getConfig();
    this.accountService.updateUnrealizedPnL(
      totalUnrealized,
      config.maxDailyLossPercent,
      config.maxAccountDrawdownPercent
    );
  }

  /**
   * Consumes scanner results and processes newly validated setups automatically if enabled.
   */
  processScannerSummary(
    summary: ScannerSummary,
    currentQuotes: Record<string, InstrumentQuote>
  ): void {
    // 1. Invalidation checks: cancel pending orders if setup was invalidated
    for (const candidate of summary.candidates) {
      if (candidate.validation.isInvalidated || candidate.status === 'INVALIDATED') {
        this.orderService.cancelIfSetupInvalidated(candidate);
      }
    }

    // 2. If paper trading is not enabled, do not create paper orders
    const account = this.accountService.getAccount();
    if (!account.isTradingEnabled) {
      return;
    }

    // 3. Evaluate VALIDATED_CANDIDATE setups
    for (const candidate of summary.candidates) {
      if (candidate.status === 'VALIDATED_CANDIDATE') {
        const quote = currentQuotes[candidate.symbol];
        this.evaluateAndProcessSetup(candidate, quote, 'MARKET');
      }
    }
  }
}

export const paperTradingEngine = new PaperTradingEngine();
