/**
 * Phase 8 Forward Paper Validation Types
 * Strictly deterministic, auditable forward paper-trading architecture.
 */

export type ForwardDataStatus = 'DATA_SAFE' | 'DATA_UNSAFE' | 'FEED_DISCONNECTED' | 'STALE';
export type ForwardEngineState = 'IDLE' | 'RUNNING' | 'PAUSED';
export type ForwardPaperStatus = 'PAPER_DISABLED' | 'PAPER_ACTIVE';

export type ForwardSignalDecision = 
  | 'EXECUTED'
  | 'FILTERED'
  | 'RISK_REJECTED'
  | 'CAPACITY_REJECTED'
  | 'INVALIDATED'
  | 'NO_TRADE'
  | 'DATA_REJECTED';

export type ForwardRiskDecision =
  | 'RISK_ACCEPTED'
  | 'RISK_REJECTED_DAILY_LOSS'
  | 'RISK_REJECTED_MAX_DRAWDOWN'
  | 'RISK_REJECTED_POSITION_CAPACITY'
  | 'RISK_REJECTED_PAPER_DISABLED'
  | 'RISK_REJECTED_INVALID_RR'
  | 'RISK_REJECTED_INVALID_RISK';

export type ForwardEventType =
  | 'ENGINE_START'
  | 'PAPER_ENABLED'
  | 'PAPER_DISABLED'
  | 'DATA_UNSAFE'
  | 'DATA_RESTORED'
  | 'CANDLE_INGESTED'
  | 'CANDLE_PROCESSED'
  | 'ORDER_FILLED'
  | 'POSITION_CLOSED'
  | 'DAILY_RESET'
  | 'RECOVERY_COMPLETED'
  | 'RESTART_RECOVERED'
  | 'SIGNAL_CREATED'
  | 'RISK_APPROVED'
  | 'ENTRY_REQUESTED'
  | 'ENTRY_EXECUTED'
  | 'ENTRY_FILLED'
  | 'SL_INITIALIZED'
  | 'TP_INITIALIZED'
  | 'EXIT_REQUESTED'
  | 'EXIT_EXECUTED'
  | 'EXIT_FILLED'
  | 'TRADE_CLOSED'
  | 'ACCOUNT_UPDATED'
  | 'DUPLICATE_EVENT_IGNORED';

export interface ForwardCandle {
  candleId: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isVerified: boolean;
  isConfirmedClosed: boolean;
  receivedAt: string;
  validationStatus: 'VALID' | 'MALFORMED' | 'OUT_OF_ORDER' | 'DUPLICATE' | 'INCOMPLETE';
  validationError: string | null;
}

export interface ForwardSignal {
  signalId: string;
  timestampUTC: string;
  candleTimestampUTC: string;
  candleTimestamp: number;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  marketRegime: string;
  session: string;

  breakoutDetected: boolean;
  retestDetected: boolean;
  displacement: number;
  ATR: number;
  breakoutDistanceATR: number;
  extensionATR: number;
  riskReward: number;

  filterAResult: 'PASS' | 'REJECT';
  filterBResult: 'PASS' | 'REJECT';
  combinedFilterResult: 'PASS' | 'REJECT';
  filterDetails: {
    rejectA: boolean;
    rejectB: boolean;
    reason: string;
  };

  riskCheckResult: ForwardRiskDecision;
  positionCapacityResult: 'AVAILABLE' | 'FULL';
  decision: ForwardSignalDecision;
  decisionReason: string;

  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  positionSize: number | null; // Ounces
  lotSize: number | null;      // Standard lots (100 oz = 1 lot)
  estimatedSpread: number;
  estimatedSlippage: number;
  estimatedCommission: number;
}

export interface ForwardTradeAttribution {
  regime: string;
  session: string;
  direction: 'LONG' | 'SHORT';
  filterStatus: string;
  entryQualityEvidence: string[];
  riskState: string;
  exitReason: string;
  pnl: number;
}

export interface ForwardTrade {
  tradeId: string;
  positionId: string;
  signalId: string;
  paperOrderId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';

  // Explicit separated UTC timestamps
  signalCandleTimeUtc: string;      // Setup / signal M15 candle boundary (UTC)
  entryRequestedAtUtc: string;      // Simulated paper order request time (UTC)
  entryExecutedAtUtc: string;       // Simulated paper fill execution time (UTC)
  exitRequestedAtUtc: string;       // Simulated paper exit request time (UTC)
  exitExecutedAtUtc: string;        // Simulated paper exit fill time (UTC)

  openedAt: string;                 // Backward compatibility alias (= entryExecutedAtUtc)
  closedAt: string;                 // Backward compatibility alias (= exitExecutedAtUtc)

  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  initialStopLoss: number;          // Permanent initial SL
  takeProfit: number;
  initialTakeProfit: number;        // Permanent initial TP
  positionSize: number;             // Ounces
  quantity: number;                 // Quantity alias (oz)
  lotSize: number;                  // Standard lots

  grossPnL: number;
  netPnL: number;
  commission: number;
  fees: number;                     // Total fees alias
  spreadCost: number;
  slippageCost: number;
  slippage: number;                 // Slippage cost alias
  totalFees: number;
  rMultiple: number;
  closeReason: string;
  exitReason: string;               // Exit reason alias
  isWin: boolean;

  strategyVersion: string;          // "Phase 7F/7G Frozen Breakout-Retest"
  filterVersion: string;            // "Filter AB Frozen"
  riskConfigurationVersion: string; // "Phase 8 Frozen 1% Risk / 3 Max Pos"
  createdAtUtc: string;
  updatedAtUtc: string;

  attribution: ForwardTradeAttribution;
}

export interface ForwardPosition {
  positionId: string;
  signalId: string;
  paperOrderId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';

  // Explicit separated timestamps
  signalCandleTimeUtc: string;
  entryRequestedAtUtc: string;
  entryExecutedAtUtc: string;

  openedAt: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  initialStopLoss: number;
  takeProfit: number;
  initialTakeProfit: number;
  positionSize: number; // Ounces
  quantity: number;     // Quantity alias (oz)
  lotSize: number;      // Standard lots
  unrealizedPnL: number;
  unrealizedRMultiple: number;
  initialRisk: number;
  accumulatedFees: number;
  spreadPips: number;
  slippagePips: number;
  marketDataTimestamp: string;
}

export interface ForwardEquitySnapshot {
  timestamp: string;
  candleTimestamp: number;
  balance: number;
  equity: number;
  drawdown: number;
  drawdownPercent: number;
  dailyPnL: number;
  dailyStartingEquity: number;
  openPositionsCount: number;
  totalTradesCount: number;
}

export interface ForwardSystemEvent {
  eventId: string;
  tradeId?: string;
  timestamp: string;
  timestampUtc?: string;
  eventType: ForwardEventType;
  type?: ForwardEventType;
  state?: string;
  reason?: string;
  message: string;
  details?: Record<string, any>;
}

export interface ForwardEngineStatus {
  dataStatus: ForwardDataStatus;
  engineStatus: ForwardEngineState;
  paperStatus: ForwardPaperStatus;
  lastCandle: ForwardCandle | null;
  lastSignal: ForwardSignal | null;
  openPositionsCount: number;
  lastEvaluatedAt: string | null;
}

export interface ForwardPerformanceMetrics {
  forwardTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  consecutiveLosses: number;
  endingEquity: number;
  startingBalance: number;
}

export interface ForwardValidationProgress {
  forwardObservationCount: number;
  daysObserved: number;
  m15CandlesObserved: number;
  executedTrades: number;
  filteredSignals: number;
  riskRejections: number;
  dataRejections: number;
}

export interface ForwardAccountState {
  startingBalance: number;
  currentBalance: number;
  currentEquity: number;
  peakEquity: number;
  dailyStartingEquity: number;
  dailyStartDayUTC: string;
  realizedPnL: number;
  unrealizedPnL: number;
  totalFeesPaid: number;
  paperTradingActive: boolean;
}
