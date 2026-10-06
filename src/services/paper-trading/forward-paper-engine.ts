import { Candle } from '../../market-data/provider.interface';
import { BreakoutStrategy } from '../../strategy/breakout-strategy';
import { classifyTimestampSession } from '../../strategy/session-classifier';
import { evaluateFilterAB } from '../../strategy/filter-ab';
import { MarketStructureEngine } from '../../intelligence/market-structure-engine';
import { MarketRegimeEngine, marketRegimeEngine } from '../../intelligence/market-regime-engine';
import { BreakoutValidationEngine } from '../../strategy/breakout-validation-engine';
import {
  ForwardAccountState,
  ForwardCandle,
  ForwardDataStatus,
  ForwardEngineState,
  ForwardEngineStatus,
  ForwardEquitySnapshot,
  ForwardPerformanceMetrics,
  ForwardPosition,
  ForwardRiskDecision,
  ForwardSignal,
  ForwardSignalDecision,
  ForwardSystemEvent,
  ForwardTrade,
  ForwardTradeAttribution,
  ForwardValidationProgress,
} from '../../types/forward-validation';
import { ForwardCandleValidator, CandleValidationResult } from './forward-candle-validator';
import { ForwardPersistence, INITIAL_FORWARD_ACCOUNT } from './forward-persistence';

export interface ProcessCandleResult {
  candle: ForwardCandle;
  validation: CandleValidationResult;
  signal: ForwardSignal;
  positionOpened: ForwardPosition | null;
  positionsClosed: ForwardTrade[];
}

export class ForwardPaperEngine {
  // Frozen parameters per Phase 7F/7G
  public static readonly FROZEN_PARAMS = {
    minDisplacementRatio: 0.55,
    maxExtensionAtrMultiplier: 2.2,
    minBreakoutDistanceAtr: 0.15,
    maxRetestBars: 8,
    retestToleranceAtr: 0.35,
    minAtrThreshold: 0.10,
    minimumRR: 2.0,
    riskPerTradePercent: 1.0,
    maxOpenPositions: 3,
    maximumDailyLossPercent: 3.0,
    maximumDrawdownPercent: 10.0,
    commissionPerLotPerSide: 3.50, // $3.50 per lot per side ($7.00 round trip)
    spreadMarkupPips: 1.0,         // 1.0 pip = $0.10 on XAU/USD
    slippagePips: 0.5,             // 0.5 pip = $0.05 on XAU/USD
    contractOuncesPerLot: 100,     // 100 oz = 1 standard lot
  };

  private strategy: BreakoutStrategy;
  private regimeEngine: MarketRegimeEngine;
  private structureEngine: MarketStructureEngine;
  private validationEngine: BreakoutValidationEngine;

  private account: ForwardAccountState;
  private openPositions: Map<string, ForwardPosition> = new Map();
  private signals: ForwardSignal[] = [];
  private trades: ForwardTrade[] = [];
  private equitySnapshots: ForwardEquitySnapshot[] = [];
  private events: ForwardSystemEvent[] = [];
  private processedCandleTimestamps: Set<number> = new Set();
  private historicalCandleBuffer: Candle[] = [];

  private lastCandle: ForwardCandle | null = null;
  private lastSignal: ForwardSignal | null = null;
  private dataStatus: ForwardDataStatus = 'DATA_SAFE';
  private engineState: ForwardEngineState = 'IDLE';

  private statusListeners: ((status: ForwardEngineStatus) => void)[] = [];
  private signalListeners: ((signal: ForwardSignal) => void)[] = [];
  private tradeListeners: ((trade: ForwardTrade) => void)[] = [];
  private positionOpenedListeners: ((position: ForwardPosition, signal: ForwardSignal) => void)[] = [];
  private riskLockListeners: ((reason: string, account: ForwardAccountState) => void)[] = [];
  private dataWarningListeners: ((reason: string, lastValidCandle?: string) => void)[] = [];

  constructor() {
    this.structureEngine = new MarketStructureEngine({ leftBars: 2, rightBars: 2 });
    this.regimeEngine = marketRegimeEngine;
    this.validationEngine = new BreakoutValidationEngine({
      minDisplacementRatio: ForwardPaperEngine.FROZEN_PARAMS.minDisplacementRatio,
      maxExtensionAtrMultiplier: ForwardPaperEngine.FROZEN_PARAMS.maxExtensionAtrMultiplier,
      minBreakoutDistanceAtr: ForwardPaperEngine.FROZEN_PARAMS.minBreakoutDistanceAtr,
      maxRetestBars: ForwardPaperEngine.FROZEN_PARAMS.maxRetestBars,
      retestToleranceAtr: ForwardPaperEngine.FROZEN_PARAMS.retestToleranceAtr,
      minAtrThreshold: ForwardPaperEngine.FROZEN_PARAMS.minAtrThreshold,
    });
    this.strategy = new BreakoutStrategy(
      this.regimeEngine,
      this.structureEngine,
      undefined,
      this.validationEngine
    );

    // 1. LOAD & 2. RESTORE
    this.account = ForwardPersistence.loadAccount();
    this.openPositions = ForwardPersistence.loadPositions();
    this.signals = ForwardPersistence.loadSignals();
    this.trades = ForwardPersistence.loadTrades();
    this.equitySnapshots = ForwardPersistence.loadEquitySnapshots();
    this.events = ForwardPersistence.loadEvents();
    this.processedCandleTimestamps = ForwardPersistence.loadProcessedTimestamps();
    this.lastCandle = ForwardPersistence.loadLastCandle();

    // 3. VALIDATE & 4. RECONCILE
    let realizedPnL = 0;
    let totalFees = 0;
    for (const t of this.trades) {
      realizedPnL = Number((realizedPnL + t.netPnL).toFixed(2));
      totalFees = Number((totalFees + (t.totalFees || t.fees || 0)).toFixed(2));
    }
    this.account.realizedPnL = realizedPnL;
    this.account.totalFeesPaid = totalFees;
    this.account.currentBalance = Number((this.account.startingBalance + realizedPnL).toFixed(2));

    let unrealizedPnL = 0;
    for (const pos of this.openPositions.values()) {
      unrealizedPnL = Number((unrealizedPnL + pos.unrealizedPnL).toFixed(2));
    }
    this.account.unrealizedPnL = unrealizedPnL;
    this.account.currentEquity = Number((this.account.currentBalance + unrealizedPnL).toFixed(2));
    if (this.account.currentEquity > this.account.peakEquity) {
      this.account.peakEquity = this.account.currentEquity;
    }
    ForwardPersistence.saveAccount(this.account);

    // Prune any corrupt future-dated signals or out-of-order error records
    const nowInit = Date.now();
    const validSignals = this.signals.filter(
      s => s.candleTimestamp <= nowInit &&
           !s.decisionReason?.includes('OUT_OF_ORDER_TIMESTAMP')
    );
    if (validSignals.length !== this.signals.length) {
      this.signals = validSignals;
      ForwardPersistence.saveSignals(this.signals);
    }

    if (this.signals.length > 0) {
      this.lastSignal = this.signals[this.signals.length - 1];
    }

    // 5. CONTINUE
    this.recordEvent('RESTART_RECOVERED', 'Startup recovery sequence completed: LOAD -> RESTORE -> VALIDATE -> RECONCILE -> CONTINUE.', {
      tradesCount: this.trades.length,
      signalsCount: this.signals.length,
      openPositionsCount: this.openPositions.size,
      paperTradingActive: this.account.paperTradingActive,
      equity: this.account.currentEquity,
      balance: this.account.currentBalance,
      lastCandleTimestamp: this.lastCandle?.timestamp,
    });
  }

  public setPaperTradingActive(enabled: boolean): void {
    this.account.paperTradingActive = enabled;
    ForwardPersistence.saveAccount(this.account);
    this.recordEvent(
      enabled ? 'PAPER_ENABLED' : 'PAPER_DISABLED',
      `Paper trading ${enabled ? 'ACTIVATED by user' : 'DEACTIVATED by user'}.`
    );
    this.notifyStatus();
  }

  public isPaperTradingActive(): boolean {
    return this.account.paperTradingActive;
  }

  public resetForwardState(startingBalance: number = 100_000): void {
    this.openPositions.clear();
    this.signals = [];
    this.trades = [];
    this.equitySnapshots = [];
    this.events = [];
    this.processedCandleTimestamps.clear();
    this.historicalCandleBuffer = [];
    this.lastCandle = null;
    this.lastSignal = null;
    this.dataStatus = 'DATA_SAFE';

    this.account = {
      ...INITIAL_FORWARD_ACCOUNT,
      startingBalance,
      currentBalance: startingBalance,
      currentEquity: startingBalance,
      peakEquity: startingBalance,
      dailyStartingEquity: startingBalance,
      dailyStartDayUTC: new Date().toISOString().substring(0, 10),
    };

    ForwardPersistence.clearAll();
    ForwardPersistence.saveAccount(this.account);
    this.recordEvent('ENGINE_START', `Forward paper state reset to initial balance of $${startingBalance.toLocaleString()}.`);
    this.notifyStatus();
  }

  public primeCandleBuffer(candles: Candle[]): void {
    if (!candles || candles.length === 0) return;
    this.historicalCandleBuffer = [...candles];
    const last = candles[candles.length - 1];
    if (last) {
      this.lastCandle = {
        candleId: `CANDLE-XAUUSD-15m-${last.timestamp}`,
        symbol: 'XAU/USD',
        timeframe: '15m',
        timestamp: last.timestamp,
        datetime: last.datetime || new Date(last.timestamp).toISOString(),
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume || 0,
        isConfirmedClosed: true,
        isVerified: true,
        receivedAt: new Date().toISOString(),
        validationStatus: 'VALID',
        validationError: null,
      };
    }
  }

  public hasProcessedCandle(timestamp: number): boolean {
    if (typeof timestamp !== 'number' || timestamp <= 0) return false;
    return this.processedCandleTimestamps.has(timestamp) || (this.lastCandle !== null && this.lastCandle.timestamp >= timestamp);
  }

  public processCandle(
    rawCandle: Candle,
    nowMs: number = Date.now(),
    bypassTimeClosedCheck: boolean = false
  ): ProcessCandleResult {
    this.engineState = 'RUNNING';

    // HARD IDEMPOTENCY GATE: If this candle timestamp was already processed, immediately return
    // without strategy evaluation, new signal, position, trade, P&L, fees, or equity mutation.
    if (rawCandle && typeof rawCandle.timestamp === 'number' && this.hasProcessedCandle(rawCandle.timestamp)) {
      const existingSignal = this.signals.find(s => s.candleTimestamp === rawCandle.timestamp) || this.createNoTradeSignal(
        rawCandle.timestamp,
        rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
        'DUPLICATE_CANDLE_IGNORED'
      );
      return {
        candle: this.lastCandle || {
          candleId: `CANDLE-XAUUSD-15m-${rawCandle.timestamp}`,
          symbol: 'XAU/USD',
          timeframe: '15m',
          timestamp: rawCandle.timestamp,
          datetime: rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
          open: rawCandle.open,
          high: rawCandle.high,
          low: rawCandle.low,
          close: rawCandle.close,
          volume: rawCandle.volume || 0,
          isConfirmedClosed: true,
          isVerified: true,
          receivedAt: new Date(nowMs).toISOString(),
          validationStatus: 'DUPLICATE',
          validationError: `DUPLICATE_CANDLE: Candle with timestamp ${rawCandle.timestamp} has already been processed.`,
        },
        validation: {
          isValid: false,
          isConfirmedClosed: true,
          status: 'DUPLICATE',
          error: `DUPLICATE_CANDLE: Candle with timestamp ${rawCandle.timestamp} has already been processed.`,
          candle: null,
        },
        signal: existingSignal,
        positionOpened: null,
        positionsClosed: [],
      };
    }

    // 1. DATA_RECEIVED & 2. DATA_VALIDATED
    const validation = ForwardCandleValidator.validate(
      rawCandle,
      this.lastCandle,
      nowMs,
      bypassTimeClosedCheck
    );

    if (!validation.isValid || !validation.candle) {
      if (validation.status === 'DUPLICATE') {
        const existingSignal = this.signals.find(s => s.candleTimestamp === rawCandle.timestamp) || this.createNoTradeSignal(
          rawCandle.timestamp,
          rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
          'DUPLICATE_CANDLE_IGNORED'
        );
        return {
          candle: this.lastCandle || {
            candleId: `CANDLE-XAUUSD-15m-${rawCandle.timestamp}`,
            symbol: 'XAU/USD',
            timeframe: '15m',
            timestamp: rawCandle.timestamp,
            datetime: rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
            open: rawCandle.open,
            high: rawCandle.high,
            low: rawCandle.low,
            close: rawCandle.close,
            volume: rawCandle.volume || 0,
            isConfirmedClosed: true,
            isVerified: true,
            receivedAt: new Date(nowMs).toISOString(),
            validationStatus: 'DUPLICATE',
            validationError: validation.error,
          },
          validation,
          signal: existingSignal,
          positionOpened: null,
          positionsClosed: [],
        };
      }

      if (validation.status === 'OUT_OF_ORDER') {
        // Chronological regression protection:
        // A delayed, stale, or historical candle arriving after a newer confirmed candle
        // must be safely ignored/rejected without mutating engine state or falsely marking DATA_UNSAFE.
        const outOfOrderCandle: ForwardCandle = this.lastCandle || {
          candleId: `CANDLE-XAUUSD-15m-${rawCandle.timestamp}`,
          symbol: 'XAU/USD',
          timeframe: '15m',
          timestamp: rawCandle.timestamp,
          datetime: rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
          open: rawCandle.open,
          high: rawCandle.high,
          low: rawCandle.low,
          close: rawCandle.close,
          volume: rawCandle.volume || 0,
          isConfirmedClosed: false,
          isVerified: Boolean(rawCandle.isVerified),
          receivedAt: new Date(nowMs).toISOString(),
          validationStatus: 'OUT_OF_ORDER',
          validationError: validation.error,
        };
        return {
          candle: outOfOrderCandle,
          validation,
          signal: this.createNoTradeSignal(
            rawCandle.timestamp,
            rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
            validation.error || 'OUT_OF_ORDER_CANDLE_IGNORED'
          ),
          positionOpened: null,
          positionsClosed: [],
        };
      }

      if (validation.status === 'INCOMPLETE') {
        // Genuinely active / incomplete candle: reject signal evaluation until confirmed closed.
        // Data status remains normal (active forming candles are expected in live forward polling).
        const incompleteCandle: ForwardCandle = validation.candle || {
          candleId: `CANDLE-XAUUSD-15m-${rawCandle.timestamp}`,
          symbol: 'XAU/USD',
          timeframe: '15m',
          timestamp: rawCandle.timestamp,
          datetime: rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
          open: rawCandle.open,
          high: rawCandle.high,
          low: rawCandle.low,
          close: rawCandle.close,
          volume: rawCandle.volume || 0,
          isConfirmedClosed: false,
          isVerified: Boolean(rawCandle.isVerified),
          receivedAt: new Date(nowMs).toISOString(),
          validationStatus: 'INCOMPLETE',
          validationError: validation.error,
        };
        return {
          candle: incompleteCandle,
          validation,
          signal: this.createNoTradeSignal(
            rawCandle.timestamp,
            rawCandle.datetime || new Date(rawCandle.timestamp).toISOString(),
            validation.error || 'INCOMPLETE_CANDLE: Candle active. Awaiting close.'
          ),
          positionOpened: null,
          positionsClosed: [],
        };
      }

      this.dataStatus = 'DATA_UNSAFE';
      this.recordEvent('DATA_UNSAFE', `Data validation failed: ${validation.error}`, { rawCandle });
      this.notifyDataWarning(validation.error || 'DATA_VALIDATION_FAILED', this.lastCandle?.datetime);

      const errorSignal = this.createSignalRecord({
        timestampUTC: new Date(nowMs).toISOString(),
        candleTimestampUTC: rawCandle?.datetime || new Date(rawCandle?.timestamp || nowMs).toISOString(),
        candleTimestamp: rawCandle?.timestamp || nowMs,
        direction: 'FLAT',
        marketRegime: 'UNKNOWN',
        session: 'UNKNOWN',
        breakoutDetected: false,
        retestDetected: false,
        displacement: 0,
        ATR: 0,
        breakoutDistanceATR: 0,
        extensionATR: 0,
        riskReward: 0,
        filterAResult: 'REJECT',
        filterBResult: 'REJECT',
        combinedFilterResult: 'REJECT',
        filterDetails: { rejectA: false, rejectB: false, reason: 'DATA_UNSAFE' },
        riskCheckResult: 'RISK_REJECTED_INVALID_RISK',
        positionCapacityResult: 'AVAILABLE',
        decision: 'DATA_REJECTED',
        decisionReason: validation.error || 'DATA_VALIDATION_FAILED',
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        positionSize: null,
        lotSize: null,
        estimatedSpread: 0,
        estimatedSlippage: 0,
        estimatedCommission: 0,
      });

      this.signals.push(errorSignal);
      this.lastSignal = errorSignal;
      ForwardPersistence.saveSignals(this.signals);
      this.notifyStatus();

      return {
        candle: validation.candle || {
          candleId: `CANDLE-XAUUSD-15m-${rawCandle?.timestamp || 0}`,
          symbol: 'XAU/USD',
          timeframe: '15m',
          timestamp: rawCandle?.timestamp || 0,
          datetime: rawCandle?.datetime || '',
          open: rawCandle?.open || 0,
          high: rawCandle?.high || 0,
          low: rawCandle?.low || 0,
          close: rawCandle?.close || 0,
          volume: rawCandle?.volume || 0,
          isConfirmedClosed: false,
          isVerified: Boolean(rawCandle?.isVerified),
          receivedAt: new Date(nowMs).toISOString(),
          validationStatus: validation.status,
          validationError: validation.error,
        },
        validation,
        signal: errorSignal,
        positionOpened: null,
        positionsClosed: [],
      };
    }

    // 3. CANDLE_CONFIRMED
    const candle = validation.candle;
    this.dataStatus = 'DATA_SAFE';
    this.lastCandle = candle;
    ForwardPersistence.saveLastCandle(candle);
    this.processedCandleTimestamps.add(candle.timestamp);
    ForwardPersistence.saveProcessedTimestamps(this.processedCandleTimestamps);
    this.recordEvent('CANDLE_PROCESSED', `Confirmed M15 candle processed at ${candle.datetime || new Date(candle.timestamp).toISOString()}.`, {
      timestamp: candle.timestamp,
      close: candle.close,
    });

    this.historicalCandleBuffer.push({
      timestamp: candle.timestamp,
      datetime: candle.datetime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      isVerified: true,
    });
    if (this.historicalCandleBuffer.length > 500) {
      this.historicalCandleBuffer = this.historicalCandleBuffer.slice(-500);
    }

    // 4. MARKET_STATE_UPDATED
    const candleDayUTC = new Date(candle.timestamp).toISOString().substring(0, 10);
    if (candleDayUTC !== this.account.dailyStartDayUTC) {
      const priorDailyRef = this.account.dailyStartingEquity;
      this.account.dailyStartingEquity = this.account.currentEquity;
      this.account.dailyStartDayUTC = candleDayUTC;
      this.recordEvent(
        'DAILY_RESET',
        `UTC Day Rollover (${candleDayUTC}). Reset daily starting equity from $${priorDailyRef.toFixed(2)} to $${this.account.currentEquity.toFixed(2)}.`
      );
    }

    const positionsClosed = this.monitorOpenPositions(candle, nowMs);
    this.updateEquityAndDrawdown(candle);

    // 5. SIGNAL_EVALUATED
    const contextCandles = this.historicalCandleBuffer;
    const strategySignal = this.strategy.evaluateSignal(contextCandles);
    const sessionName = classifyTimestampSession(candle.timestamp);
    const candleHourUTC = new Date(candle.timestamp).getUTCHours();

    const candidateSetup = strategySignal.candidateSetup;
    const breakoutDetected = strategySignal.state !== 'NO_SETUP' && strategySignal.state !== 'INSUFFICIENT_DATA';
    const retestDetected = candidateSetup?.evidence?.retestDetected ?? false;
    const displacement = candidateSetup?.evidence?.displacementBodyRatio ?? 0;
    const atr = this.computeAtr(contextCandles, 14);
    const breakoutDistanceATR = atr > 0 && strategySignal.levelBroken
      ? Math.abs(candle.close - strategySignal.levelBroken) / atr
      : 0;
    const extensionATR = atr > 0 && strategySignal.levelBroken
      ? Math.abs(candle.close - strategySignal.levelBroken) / atr
      : 0;
    const riskReward = candidateSetup?.risk.riskRewardRatio ?? 2.0;

    if (!candidateSetup || strategySignal.decision === 'WAIT' || strategySignal.decision === 'NO_TRADE') {
      const noTradeSignal = this.createSignalRecord({
        timestampUTC: new Date(nowMs).toISOString(),
        candleTimestampUTC: candle.datetime,
        candleTimestamp: candle.timestamp,
        direction: 'FLAT',
        marketRegime: strategySignal.regime || 'UNKNOWN',
        session: sessionName,
        breakoutDetected,
        retestDetected,
        displacement,
        ATR: atr,
        breakoutDistanceATR,
        extensionATR,
        riskReward: 0,
        filterAResult: 'PASS',
        filterBResult: 'PASS',
        combinedFilterResult: 'PASS',
        filterDetails: { rejectA: false, rejectB: false, reason: 'NO_CANDIDATE_SETUP' },
        riskCheckResult: 'RISK_ACCEPTED',
        positionCapacityResult: this.openPositions.size >= ForwardPaperEngine.FROZEN_PARAMS.maxOpenPositions ? 'FULL' : 'AVAILABLE',
        decision: 'NO_TRADE',
        decisionReason: `Strategy state: ${strategySignal.decision}. No confirmed breakout/retest setup.`,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        positionSize: null,
        lotSize: null,
        estimatedSpread: 0,
        estimatedSlippage: 0,
        estimatedCommission: 0,
      });

      this.signals.push(noTradeSignal);
      this.lastSignal = noTradeSignal;
      ForwardPersistence.saveSignals(this.signals);
      this.notifySignal(noTradeSignal);
      this.notifyStatus();

      return {
        candle,
        validation,
        signal: noTradeSignal,
        positionOpened: null,
        positionsClosed,
      };
    }

    // 6. FILTER_EVALUATED (Combined Filter AB)
    const isShort = candidateSetup.direction === 'BEARISH';
    const regime = candidateSetup.validation.marketRegime || strategySignal.regime;
    const filterResult = evaluateFilterAB({
      direction: candidateSetup.direction,
      regime,
      timestamp: candle.timestamp,
    });
    const { rejectA, rejectB, rejectAB, reason: filterReason } = filterResult;

    const direction: 'LONG' | 'SHORT' = isShort ? 'SHORT' : 'LONG';
    const entryPriceRef = candidateSetup.risk.entryReference || candle.close;
    const stopLossRef = candidateSetup.risk.stopLossReference || (isShort ? entryPriceRef + 10 : entryPriceRef - 10);
    const targetRef = candidateSetup.risk.targetReference || (isShort ? entryPriceRef - 20 : entryPriceRef + 20);

    if (rejectAB) {
      const filteredSignal = this.createSignalRecord({
        timestampUTC: new Date(nowMs).toISOString(),
        candleTimestampUTC: candle.datetime,
        candleTimestamp: candle.timestamp,
        direction,
        marketRegime: regime,
        session: sessionName,
        breakoutDetected,
        retestDetected,
        displacement,
        ATR: atr,
        breakoutDistanceATR,
        extensionATR,
        riskReward,
        filterAResult: rejectA ? 'REJECT' : 'PASS',
        filterBResult: rejectB ? 'REJECT' : 'PASS',
        combinedFilterResult: 'REJECT',
        filterDetails: { rejectA, rejectB, reason: filterReason },
        riskCheckResult: 'RISK_ACCEPTED',
        positionCapacityResult: this.openPositions.size >= ForwardPaperEngine.FROZEN_PARAMS.maxOpenPositions ? 'FULL' : 'AVAILABLE',
        decision: 'FILTERED',
        decisionReason: filterReason,
        entryPrice: entryPriceRef,
        stopLoss: stopLossRef,
        takeProfit: targetRef,
        positionSize: null,
        lotSize: null,
        estimatedSpread: 0,
        estimatedSlippage: 0,
        estimatedCommission: 0,
      });

      this.signals.push(filteredSignal);
      this.lastSignal = filteredSignal;
      ForwardPersistence.saveSignals(this.signals);
      this.notifySignal(filteredSignal);
      this.notifyStatus();

      return {
        candle,
        validation,
        signal: filteredSignal,
        positionOpened: null,
        positionsClosed,
      };
    }

    // 7. RISK_EVALUATED
    let riskDecision: ForwardRiskDecision = 'RISK_ACCEPTED';
    let riskRejectionReason: string | null = null;
    let signalDecision: ForwardSignalDecision = 'EXECUTED';

    if (!this.account.paperTradingActive) {
      riskDecision = 'RISK_REJECTED_PAPER_DISABLED';
      riskRejectionReason = 'PAPER_TRADING_DISABLED: Forward paper trading is inactive. Explicit user activation required.';
      signalDecision = 'RISK_REJECTED';
    }

    const dailyPnL = this.account.currentEquity - this.account.dailyStartingEquity;
    const dailyLossAmount = Math.max(0, -dailyPnL);
    const dailyLossPercent = (dailyLossAmount / this.account.dailyStartingEquity) * 100;
    if (dailyLossPercent >= ForwardPaperEngine.FROZEN_PARAMS.maximumDailyLossPercent) {
      riskDecision = 'RISK_REJECTED_DAILY_LOSS';
      riskRejectionReason = `DAILY_LOSS_LIMIT_REACHED: Daily loss ${dailyLossPercent.toFixed(2)}% exceeds max limit of ${ForwardPaperEngine.FROZEN_PARAMS.maximumDailyLossPercent}%.`;
      signalDecision = 'RISK_REJECTED';
      this.notifyRiskLock(riskRejectionReason, this.account);
    }

    const drawdownAmount = Math.max(0, this.account.peakEquity - this.account.currentEquity);
    const drawdownPercent = (drawdownAmount / this.account.peakEquity) * 100;
    if (drawdownPercent >= ForwardPaperEngine.FROZEN_PARAMS.maximumDrawdownPercent) {
      riskDecision = 'RISK_REJECTED_MAX_DRAWDOWN';
      riskRejectionReason = `MAX_DRAWDOWN_REACHED: Drawdown ${drawdownPercent.toFixed(2)}% exceeds max limit of ${ForwardPaperEngine.FROZEN_PARAMS.maximumDrawdownPercent}%.`;
      signalDecision = 'RISK_REJECTED';
      this.notifyRiskLock(riskRejectionReason, this.account);
    }

    if (this.openPositions.size >= ForwardPaperEngine.FROZEN_PARAMS.maxOpenPositions) {
      riskDecision = 'RISK_REJECTED_POSITION_CAPACITY';
      riskRejectionReason = `POSITION_CAPACITY_LIMIT: Maximum concurrent open positions (${ForwardPaperEngine.FROZEN_PARAMS.maxOpenPositions}) reached.`;
      signalDecision = 'CAPACITY_REJECTED';
    }

    const riskDistance = Math.abs(entryPriceRef - stopLossRef);
    if (riskDistance <= 0.05) {
      riskDecision = 'RISK_REJECTED_INVALID_RISK';
      riskRejectionReason = `INVALID_RISK_DISTANCE: Entry-to-stop distance $${riskDistance.toFixed(2)} is too tight.`;
      signalDecision = 'RISK_REJECTED';
    }

    // Sizing (1.0% risk per trade)
    const riskAmount = (this.account.currentEquity * ForwardPaperEngine.FROZEN_PARAMS.riskPerTradePercent) / 100;
    const positionOunces = Number((riskAmount / riskDistance).toFixed(4));
    const lotSize = Number((positionOunces / ForwardPaperEngine.FROZEN_PARAMS.contractOuncesPerLot).toFixed(4));

    // Commission: $3.50 per lot per side = $7.00 round trip
    const roundTripCommission = Number((lotSize * (ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide * 2)).toFixed(2));
    const estimatedSpreadCost = Number((positionOunces * (ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips * 0.10)).toFixed(2));
    const estimatedSlippageCost = Number((positionOunces * (ForwardPaperEngine.FROZEN_PARAMS.slippagePips * 0.10)).toFixed(2));

    if (signalDecision !== 'EXECUTED') {
      const rejectedSignal = this.createSignalRecord({
        timestampUTC: new Date(nowMs).toISOString(),
        candleTimestampUTC: candle.datetime,
        candleTimestamp: candle.timestamp,
        direction,
        marketRegime: regime,
        session: sessionName,
        breakoutDetected,
        retestDetected,
        displacement,
        ATR: atr,
        breakoutDistanceATR,
        extensionATR,
        riskReward,
        filterAResult: 'PASS',
        filterBResult: 'PASS',
        combinedFilterResult: 'PASS',
        filterDetails: { rejectA: false, rejectB: false, reason: 'FILTER_AB_PASSED' },
        riskCheckResult: riskDecision,
        positionCapacityResult: this.openPositions.size >= ForwardPaperEngine.FROZEN_PARAMS.maxOpenPositions ? 'FULL' : 'AVAILABLE',
        decision: signalDecision,
        decisionReason: riskRejectionReason || 'RISK_REJECTED',
        entryPrice: entryPriceRef,
        stopLoss: stopLossRef,
        takeProfit: targetRef,
        positionSize: positionOunces,
        lotSize,
        estimatedSpread: estimatedSpreadCost,
        estimatedSlippage: estimatedSlippageCost,
        estimatedCommission: roundTripCommission,
      });

      this.signals.push(rejectedSignal);
      this.lastSignal = rejectedSignal;
      ForwardPersistence.saveSignals(this.signals);
      this.notifySignal(rejectedSignal);
      this.notifyStatus();

      return {
        candle,
        validation,
        signal: rejectedSignal,
        positionOpened: null,
        positionsClosed,
      };
    }

    // 8. PAPER_ORDER_CREATED & 9. PAPER_FILLED
    const halfSpread = (ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips * 0.10) / 2; // $0.05
    const slippageAmt = ForwardPaperEngine.FROZEN_PARAMS.slippagePips * 0.10;           // $0.05

    const executedEntryPrice = direction === 'LONG'
      ? Number((entryPriceRef + halfSpread + slippageAmt).toFixed(4))
      : Number((entryPriceRef - halfSpread - slippageAmt).toFixed(4));

    const entryCommission = Number((lotSize * ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide).toFixed(2));
    const paperOrderId = `ORD-P7F-XAUUSD-15M-${candle.timestamp}-${direction}`;
    const signalId = `SIG-P7F-XAUUSD-15M-${candle.timestamp}-${direction}`;
    const positionId = `POS-P7F-XAUUSD-15M-${candle.timestamp}-${direction}`;

    // =========================================================================
    // SIMULATED PAPER TRADING EXECUTION TIMING MODEL:
    // In paper-trading mode, simulated order evaluation and fill execution occur
    // upon candle arrival/processing at evaluation time (nowMs). No live broker API,
    // broker credentials, or sub-millisecond exchange gateways are used.
    // - signalCandleTimeUtc represents the candle/setup bar open/start time.
    // - entryRequestedAtUtc represents the time the engine evaluated the setup.
    // - entryExecutedAtUtc represents the simulated fill time upon evaluation.
    // =========================================================================
    const signalCandleTimeUtc = new Date(candle.timestamp).toISOString();
    const entryRequestedAtUtc = new Date(nowMs).toISOString();
    const entryExecutedAtUtc = new Date(nowMs).toISOString(); // Simulated paper execution fill at evaluation time

    const newPosition: ForwardPosition = {
      positionId,
      signalId,
      paperOrderId,
      symbol: 'XAU/USD',
      direction,

      signalCandleTimeUtc,
      entryRequestedAtUtc,
      entryExecutedAtUtc,

      openedAt: entryExecutedAtUtc,
      entryPrice: executedEntryPrice,
      currentPrice: executedEntryPrice,
      stopLoss: stopLossRef,
      initialStopLoss: stopLossRef,
      takeProfit: targetRef,
      initialTakeProfit: targetRef,
      positionSize: positionOunces,
      quantity: positionOunces,
      lotSize,
      unrealizedPnL: -entryCommission,
      unrealizedRMultiple: 0,
      initialRisk: riskAmount,
      accumulatedFees: entryCommission,
      spreadPips: ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips,
      slippagePips: ForwardPaperEngine.FROZEN_PARAMS.slippagePips,
      marketDataTimestamp: candle.datetime || new Date(candle.timestamp).toISOString(),
    };

    this.openPositions.set(newPosition.positionId, newPosition);
    ForwardPersistence.savePositions(this.openPositions);

    const executedSignal = this.createSignalRecord({
      signalId,
      timestampUTC: new Date(nowMs).toISOString(),
      candleTimestampUTC: candle.datetime,
      candleTimestamp: candle.timestamp,
      direction,
      marketRegime: regime,
      session: sessionName,
      breakoutDetected,
      retestDetected,
      displacement,
      ATR: atr,
      breakoutDistanceATR,
      extensionATR,
      riskReward,
      filterAResult: 'PASS',
      filterBResult: 'PASS',
      combinedFilterResult: 'PASS',
      filterDetails: { rejectA: false, rejectB: false, reason: 'FILTER_AB_PASSED' },
      riskCheckResult: 'RISK_ACCEPTED',
      positionCapacityResult: 'AVAILABLE',
      decision: 'EXECUTED',
      decisionReason: `Paper order filled at $${executedEntryPrice.toFixed(2)} (${lotSize} lots / ${positionOunces} oz).`,
      entryPrice: executedEntryPrice,
      stopLoss: stopLossRef,
      takeProfit: targetRef,
      positionSize: positionOunces,
      lotSize,
      estimatedSpread: estimatedSpreadCost,
      estimatedSlippage: estimatedSlippageCost,
      estimatedCommission: roundTripCommission,
    });

    this.signals.push(executedSignal);
    this.lastSignal = executedSignal;
    ForwardPersistence.saveSignals(this.signals);

    this.recordEvent('SIGNAL_CREATED', `Strategy generated valid ${direction} candidate setup at $${entryPriceRef}.`, {
      signalId,
      candleTimestamp: candle.timestamp,
      direction,
      entryPriceRef,
    });
    this.recordEvent('RISK_APPROVED', `Risk manager approved 1.0% risk allocation ($${riskAmount.toFixed(2)}).`, {
      riskAmount,
      positionOunces,
      lotSize,
    });
    this.recordEvent('ENTRY_REQUESTED', `Simulated paper market entry requested for ${lotSize} lots XAU/USD.`, {
      paperOrderId,
      direction,
      entryPriceRef,
    });
    this.recordEvent('ENTRY_FILLED', `Paper order ${paperOrderId} filled: ${direction} ${lotSize} lots XAU/USD at $${executedEntryPrice}.`, {
      positionId: newPosition.positionId,
      entryPrice: executedEntryPrice,
      lotSize,
      stopLoss: stopLossRef,
      takeProfit: targetRef,
    });
    this.recordEvent('ORDER_FILLED', `Paper order ${paperOrderId} filled: ${direction} ${lotSize} lots XAU/USD at $${executedEntryPrice}.`, {
      positionId: newPosition.positionId,
      entryPrice: executedEntryPrice,
      lotSize,
      stopLoss: stopLossRef,
      takeProfit: targetRef,
    });

    this.updateEquityAndDrawdown(candle);
    this.notifySignal(executedSignal);
    this.notifyPositionOpened(newPosition, executedSignal);
    this.notifyStatus();

    return {
      candle,
      validation,
      signal: executedSignal,
      positionOpened: newPosition,
      positionsClosed,
    };
  }

  // =========================================================================
  // POSITION MONITORING & EXITS
  // =========================================================================

  private monitorOpenPositions(candle: Candle | ForwardCandle, nowMs: number = Date.now()): ForwardTrade[] {
    const closedTrades: ForwardTrade[] = [];
    const positions = Array.from(this.openPositions.values());

    for (const pos of positions) {
      const isLong = pos.direction === 'LONG';
      const halfSpread = (ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips * 0.10) / 2;
      const slippageAmt = ForwardPaperEngine.FROZEN_PARAMS.slippagePips * 0.10;

      let shouldClose = false;
      let exitReason = '';
      let executedExitPrice = candle.close;

      if (isLong) {
        const hitSL = candle.low <= pos.stopLoss;
        const hitTP = candle.high >= pos.takeProfit;

        if (hitSL && hitTP) {
          shouldClose = true;
          exitReason = 'STOP_LOSS (AMBIGUOUS_INTRABAR_EXIT)';
          executedExitPrice = Number((pos.stopLoss - halfSpread - slippageAmt).toFixed(4));
        } else if (hitSL) {
          shouldClose = true;
          exitReason = 'STOP_LOSS';
          executedExitPrice = Number((pos.stopLoss - halfSpread - slippageAmt).toFixed(4));
        } else if (hitTP) {
          shouldClose = true;
          exitReason = 'TAKE_PROFIT';
          executedExitPrice = Number((pos.takeProfit - halfSpread - slippageAmt).toFixed(4));
        }
      } else {
        const hitSL = candle.high >= pos.stopLoss;
        const hitTP = candle.low <= pos.takeProfit;

        if (hitSL && hitTP) {
          shouldClose = true;
          exitReason = 'STOP_LOSS (AMBIGUOUS_INTRABAR_EXIT)';
          executedExitPrice = Number((pos.stopLoss + halfSpread + slippageAmt).toFixed(4));
        } else if (hitSL) {
          shouldClose = true;
          exitReason = 'STOP_LOSS';
          executedExitPrice = Number((pos.stopLoss + halfSpread + slippageAmt).toFixed(4));
        } else if (hitTP) {
          shouldClose = true;
          exitReason = 'TAKE_PROFIT';
          executedExitPrice = Number((pos.takeProfit + halfSpread + slippageAmt).toFixed(4));
        }
      }

      if (shouldClose) {
        const exitCommission = Number((pos.lotSize * ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide).toFixed(2));
        const totalFees = Number((pos.accumulatedFees + exitCommission).toFixed(2));

        const grossPnL = isLong
          ? Number(((executedExitPrice - pos.entryPrice) * pos.positionSize).toFixed(2))
          : Number(((pos.entryPrice - executedExitPrice) * pos.positionSize).toFixed(2));

        const netPnL = Number((grossPnL - totalFees).toFixed(2));
        const isWin = netPnL > 0;
        const rMultiple = pos.initialRisk > 0 ? Number((netPnL / pos.initialRisk).toFixed(2)) : 0;

        const spreadCost = Number((pos.positionSize * (ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips * 0.10)).toFixed(2));
        const slippageCost = Number((pos.positionSize * (ForwardPaperEngine.FROZEN_PARAMS.slippagePips * 0.10)).toFixed(2));

        const session = classifyTimestampSession(candle.timestamp);
        const attribution: ForwardTradeAttribution = {
          regime: this.regimeEngine.evaluateRegime(this.historicalCandleBuffer).regime,
          session,
          direction: pos.direction,
          filterStatus: 'FILTER_AB_PASSED',
          entryQualityEvidence: [
            `Entry: $${pos.entryPrice}`,
            `Stop Loss: $${pos.stopLoss}`,
            `Target: $${pos.takeProfit}`,
            `Position Size: ${pos.lotSize} lots (${pos.positionSize} oz)`,
          ],
          riskState: `Risk: $${pos.initialRisk.toFixed(2)} (1.0%)`,
          exitReason,
          pnl: netPnL,
        };

        // =====================================================================
        // SIMULATED PAPER TRADING EXIT EXECUTION TIMING MODEL:
        // Exit triggers (SL / TP / close) are evaluated upon candle processing.
        // - exitRequestedAtUtc represents the time exit conditions were detected.
        // - exitExecutedAtUtc represents the simulated paper fill timestamp.
        // =====================================================================
        const exitRequestedAtUtc = new Date(nowMs).toISOString();
        const exitExecutedAtUtc = new Date(nowMs).toISOString(); // Simulated paper fill at candle evaluation
        const candleTs = typeof candle.timestamp === 'number' ? candle.timestamp : Date.now();
        const setupTs = pos.signalCandleTimeUtc ? new Date(pos.signalCandleTimeUtc).getTime() : candleTs;
        const tradeId = `TRD-P7F-XAUUSD-15M-${setupTs}-${pos.direction}`;

        const trade: ForwardTrade = {
          tradeId,
          positionId: pos.positionId,
          signalId: pos.signalId,
          paperOrderId: pos.paperOrderId,
          symbol: pos.symbol,
          timeframe: '15m',
          direction: pos.direction,

          signalCandleTimeUtc: pos.signalCandleTimeUtc || pos.openedAt,
          entryRequestedAtUtc: pos.entryRequestedAtUtc || pos.openedAt,
          entryExecutedAtUtc: pos.entryExecutedAtUtc || pos.openedAt,
          exitRequestedAtUtc,
          exitExecutedAtUtc,

          openedAt: pos.openedAt,
          closedAt: exitExecutedAtUtc,
          entryPrice: pos.entryPrice,
          exitPrice: executedExitPrice,
          stopLoss: pos.stopLoss,
          initialStopLoss: pos.initialStopLoss || pos.stopLoss,
          takeProfit: pos.takeProfit,
          initialTakeProfit: pos.initialTakeProfit || pos.takeProfit,
          positionSize: pos.positionSize,
          quantity: pos.quantity || pos.positionSize,
          lotSize: pos.lotSize,
          grossPnL,
          netPnL,
          commission: totalFees,
          fees: totalFees,
          spreadCost,
          slippageCost,
          slippage: slippageCost,
          totalFees,
          rMultiple,
          closeReason: exitReason,
          exitReason,
          isWin,

          strategyVersion: 'Phase 7F/7G Frozen Breakout-Retest',
          filterVersion: 'Filter AB Frozen',
          riskConfigurationVersion: 'Phase 8 Frozen 1% Risk / 3 Max Pos',
          createdAtUtc: pos.entryExecutedAtUtc || pos.openedAt,
          updatedAtUtc: exitExecutedAtUtc,

          attribution,
        };

        this.account.currentBalance = Number((this.account.currentBalance + netPnL).toFixed(2));
        this.account.realizedPnL = Number((this.account.realizedPnL + netPnL).toFixed(2));
        this.account.totalFeesPaid = Number((this.account.totalFeesPaid + totalFees).toFixed(2));

        this.openPositions.delete(pos.positionId);
        this.trades.push(trade);
        closedTrades.push(trade);

        this.recordEvent('EXIT_REQUESTED', `Exit trigger reached (${exitReason}) for trade ${trade.tradeId}.`, {
          positionId: pos.positionId,
          exitReason,
        });
        this.recordEvent('EXIT_FILLED', `Paper exit filled at $${executedExitPrice}.`, {
          tradeId: trade.tradeId,
          exitPrice: executedExitPrice,
        });
        this.recordEvent('TRADE_CLOSED', `Forward paper trade ${trade.tradeId} closed: ${exitReason} | Net P&L: $${netPnL.toFixed(2)} (${rMultiple.toFixed(2)}R).`, {
          tradeId: trade.tradeId,
          netPnL,
          rMultiple,
          exitPrice: executedExitPrice,
        });
        this.recordEvent('POSITION_CLOSED', `Forward paper trade ${trade.tradeId} closed: ${exitReason} | Net P&L: $${netPnL.toFixed(2)} (${rMultiple.toFixed(2)}R).`, {
          tradeId: trade.tradeId,
          netPnL,
          rMultiple,
          exitPrice: executedExitPrice,
        });
        this.recordEvent('ACCOUNT_UPDATED', `Account updated: Balance $${this.account.currentBalance.toFixed(2)}, Equity $${this.account.currentEquity.toFixed(2)}.`, {
          currentBalance: this.account.currentBalance,
          currentEquity: this.account.currentEquity,
        });

        this.notifyTrade(trade);
      } else {
        pos.currentPrice = candle.close;
        const currentGross = isLong
          ? (candle.close - pos.entryPrice) * pos.positionSize
          : (pos.entryPrice - candle.close) * pos.positionSize;
        pos.unrealizedPnL = Number((currentGross - pos.accumulatedFees).toFixed(2));
        pos.unrealizedRMultiple = pos.initialRisk > 0 ? Number((pos.unrealizedPnL / pos.initialRisk).toFixed(2)) : 0;
        pos.marketDataTimestamp = candle.datetime || new Date(candle.timestamp).toISOString();
      }
    }

    if (closedTrades.length > 0) {
      ForwardPersistence.savePositions(this.openPositions);
      ForwardPersistence.saveTrades(this.trades);
      ForwardPersistence.saveAccount(this.account);
    }

    return closedTrades;
  }

  private updateEquityAndDrawdown(candle: Candle | ForwardCandle): void {
    let totalUnrealized = 0;
    for (const pos of this.openPositions.values()) {
      totalUnrealized += pos.unrealizedPnL;
    }

    this.account.unrealizedPnL = Number(totalUnrealized.toFixed(2));
    this.account.currentEquity = Number((this.account.currentBalance + totalUnrealized).toFixed(2));

    if (this.account.currentEquity > this.account.peakEquity) {
      this.account.peakEquity = this.account.currentEquity;
    }

    const drawdown = Math.max(0, this.account.peakEquity - this.account.currentEquity);
    const drawdownPercent = this.account.peakEquity > 0
      ? Number(((drawdown / this.account.peakEquity) * 100).toFixed(2))
      : 0;

    const dailyPnL = Number((this.account.currentEquity - this.account.dailyStartingEquity).toFixed(2));

    const snapshot: ForwardEquitySnapshot = {
      timestamp: candle.datetime || new Date(candle.timestamp).toISOString(),
      candleTimestamp: candle.timestamp,
      balance: this.account.currentBalance,
      equity: this.account.currentEquity,
      drawdown,
      drawdownPercent,
      dailyPnL,
      dailyStartingEquity: this.account.dailyStartingEquity,
      openPositionsCount: this.openPositions.size,
      totalTradesCount: this.trades.length,
    };

    this.equitySnapshots.push(snapshot);
    ForwardPersistence.saveAccount(this.account);
    ForwardPersistence.saveEquitySnapshots(this.equitySnapshots);
  }

  // =========================================================================
  // METRICS & PROGRESS
  // =========================================================================

  public getMetrics(): ForwardPerformanceMetrics {
    const forwardTrades = this.trades.length;
    const wins = this.trades.filter(t => t.isWin).length;
    const losses = forwardTrades - wins;
    const winRate = forwardTrades > 0 ? Number(((wins / forwardTrades) * 100).toFixed(2)) : 0;

    let grossProfit = 0;
    let grossLoss = 0;
    let netPnL = 0;

    for (const t of this.trades) {
      netPnL += t.netPnL;
      if (t.netPnL > 0) grossProfit += t.netPnL;
      else grossLoss += Math.abs(t.netPnL);
    }

    const profitFactor = grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(2))
      : grossProfit > 0 ? 99.99 : 0;

    const expectancy = forwardTrades > 0
      ? Number((netPnL / forwardTrades).toFixed(2))
      : 0;

    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    for (const snap of this.equitySnapshots) {
      if (snap.drawdown > maxDrawdown) maxDrawdown = snap.drawdown;
      if (snap.drawdownPercent > maxDrawdownPercent) maxDrawdownPercent = snap.drawdownPercent;
    }

    const currentDrawdown = Math.max(0, this.account.peakEquity - this.account.currentEquity);
    const currentDrawdownPercent = this.account.peakEquity > 0
      ? Number(((currentDrawdown / this.account.peakEquity) * 100).toFixed(2))
      : 0;

    let maxConsecutiveLosses = 0;
    let curConsecutiveLosses = 0;
    for (const t of this.trades) {
      if (!t.isWin) {
        curConsecutiveLosses++;
        if (curConsecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = curConsecutiveLosses;
      } else {
        curConsecutiveLosses = 0;
      }
    }

    return {
      forwardTrades,
      wins,
      losses,
      winRate,
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      netPnL: Number(netPnL.toFixed(2)),
      profitFactor,
      expectancy,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      maxDrawdownPercent,
      currentDrawdown: Number(currentDrawdown.toFixed(2)),
      currentDrawdownPercent,
      consecutiveLosses: maxConsecutiveLosses,
      endingEquity: this.account.currentEquity,
      startingBalance: this.account.startingBalance,
    };
  }

  public getProgress(): ForwardValidationProgress {
    const executedTrades = this.trades.length;
    let filteredSignals = 0;
    let riskRejections = 0;
    let dataRejections = 0;

    for (const sig of this.signals) {
      if (sig.decision === 'FILTERED') filteredSignals++;
      if (sig.decision === 'RISK_REJECTED' || sig.decision === 'CAPACITY_REJECTED') riskRejections++;
      if (sig.decision === 'DATA_REJECTED') dataRejections++;
    }

    const m15CandlesObserved = this.processedCandleTimestamps.size;
    const daysObserved = m15CandlesObserved > 0
      ? Number((m15CandlesObserved / (4 * 24)).toFixed(1))
      : 0;

    return {
      forwardObservationCount: this.signals.length - dataRejections,
      daysObserved,
      m15CandlesObserved,
      executedTrades,
      filteredSignals,
      riskRejections,
      dataRejections,
    };
  }

  public getStatus(): ForwardEngineStatus {
    return {
      dataStatus: this.dataStatus,
      engineStatus: this.engineState,
      paperStatus: this.account.paperTradingActive ? 'PAPER_ACTIVE' : 'PAPER_DISABLED',
      lastCandle: this.lastCandle,
      lastSignal: this.lastSignal,
      openPositionsCount: this.openPositions.size,
      lastEvaluatedAt: this.lastSignal?.timestampUTC || null,
    };
  }

  public getAccount(): ForwardAccountState {
    return { ...this.account };
  }

  public getOpenPositions(): ForwardPosition[] {
    return Array.from(this.openPositions.values());
  }

  public getSignals(): ForwardSignal[] {
    return [...this.signals];
  }

  public getTrades(): ForwardTrade[] {
    return [...this.trades];
  }

  public getEquitySnapshots(): ForwardEquitySnapshot[] {
    return [...this.equitySnapshots];
  }

  public getEvents(): ForwardSystemEvent[] {
    return [...this.events];
  }

  public onStatusChange(listener: (status: ForwardEngineStatus) => void): () => void {
    this.statusListeners.push(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  public onSignal(listener: (signal: ForwardSignal) => void): () => void {
    this.signalListeners.push(listener);
    return () => {
      this.signalListeners = this.signalListeners.filter(l => l !== listener);
    };
  }

  public onTrade(listener: (trade: ForwardTrade) => void): () => void {
    this.tradeListeners.push(listener);
    return () => {
      this.tradeListeners = this.tradeListeners.filter(l => l !== listener);
    };
  }

  public onPositionOpened(listener: (position: ForwardPosition, signal: ForwardSignal) => void): () => void {
    this.positionOpenedListeners.push(listener);
    return () => {
      this.positionOpenedListeners = this.positionOpenedListeners.filter(l => l !== listener);
    };
  }

  public onRiskLock(listener: (reason: string, account: ForwardAccountState) => void): () => void {
    this.riskLockListeners.push(listener);
    return () => {
      this.riskLockListeners = this.riskLockListeners.filter(l => l !== listener);
    };
  }

  public onDataWarning(listener: (reason: string, lastValidCandle?: string) => void): () => void {
    this.dataWarningListeners.push(listener);
    return () => {
      this.dataWarningListeners = this.dataWarningListeners.filter(l => l !== listener);
    };
  }

  private notifyPositionOpened(position: ForwardPosition, signal: ForwardSignal): void {
    for (const listener of this.positionOpenedListeners) {
      try {
        listener(position, signal);
      } catch {
        // Protect loop
      }
    }
  }

  private notifyRiskLock(reason: string, account: ForwardAccountState): void {
    for (const listener of this.riskLockListeners) {
      try {
        listener(reason, account);
      } catch {
        // Protect loop
      }
    }
  }

  private notifyDataWarning(reason: string, lastValidCandle?: string): void {
    for (const listener of this.dataWarningListeners) {
      try {
        listener(reason, lastValidCandle);
      } catch {
        // Protect loop
      }
    }
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Protect loop
      }
    }
  }

  private notifySignal(sig: ForwardSignal): void {
    for (const listener of this.signalListeners) {
      try {
        listener(sig);
      } catch {
        // Protect loop
      }
    }
  }

  private notifyTrade(trade: ForwardTrade): void {
    for (const listener of this.tradeListeners) {
      try {
        listener(trade);
      } catch {
        // Protect loop
      }
    }
  }

  private recordEvent(eventType: ForwardSystemEvent['eventType'], message: string, details?: Record<string, any>): void {
    const event: ForwardSystemEvent = {
      eventId: `EVT-${eventType}-${Date.now()}-${this.events.length + 1}`,
      timestamp: new Date().toISOString(),
      eventType,
      message,
      details,
    };
    this.events.push(event);
    ForwardPersistence.saveEvents(this.events);
  }

  private createSignalRecord(params: Partial<ForwardSignal> & {
    candleTimestampUTC: string;
    candleTimestamp: number;
    decision: ForwardSignalDecision;
    decisionReason: string;
  }): ForwardSignal {
    return {
      signalId: params.signalId || `SIG-P7F-XAUUSD-15M-${params.candleTimestamp}-${params.direction || 'FLAT'}`,
      timestampUTC: params.timestampUTC || new Date().toISOString(),
      candleTimestampUTC: params.candleTimestampUTC,
      candleTimestamp: params.candleTimestamp,
      symbol: params.symbol || 'XAU/USD',
      timeframe: params.timeframe || '15m',
      direction: params.direction || 'FLAT',
      marketRegime: params.marketRegime || 'UNKNOWN',
      session: params.session || 'UNKNOWN',
      breakoutDetected: params.breakoutDetected ?? false,
      retestDetected: params.retestDetected ?? false,
      displacement: params.displacement ?? 0,
      ATR: params.ATR ?? 0,
      breakoutDistanceATR: params.breakoutDistanceATR ?? 0,
      extensionATR: params.extensionATR ?? 0,
      riskReward: params.riskReward ?? 0,
      filterAResult: params.filterAResult || 'PASS',
      filterBResult: params.filterBResult || 'PASS',
      combinedFilterResult: params.combinedFilterResult || 'PASS',
      filterDetails: params.filterDetails || { rejectA: false, rejectB: false, reason: 'NONE' },
      riskCheckResult: params.riskCheckResult || 'RISK_ACCEPTED',
      positionCapacityResult: params.positionCapacityResult || 'AVAILABLE',
      decision: params.decision,
      decisionReason: params.decisionReason,
      entryPrice: params.entryPrice ?? null,
      stopLoss: params.stopLoss ?? null,
      takeProfit: params.takeProfit ?? null,
      positionSize: params.positionSize ?? null,
      lotSize: params.lotSize ?? null,
      estimatedSpread: params.estimatedSpread ?? 0,
      estimatedSlippage: params.estimatedSlippage ?? 0,
      estimatedCommission: params.estimatedCommission ?? 0,
    };
  }

  private createNoTradeSignal(timestamp: number, datetime: string, reason: string): ForwardSignal {
    return this.createSignalRecord({
      candleTimestampUTC: datetime,
      candleTimestamp: timestamp,
      decision: 'NO_TRADE',
      decisionReason: reason,
    });
  }

  private computeAtr(candles: Candle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    let trSum = 0;
    const count = Math.min(candles.length - 1, period);
    const startIdx = candles.length - count;
    for (let i = startIdx; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trSum += tr;
    }
    return Number((trSum / count).toFixed(4));
  }
}

export const forwardPaperEngine = new ForwardPaperEngine();
