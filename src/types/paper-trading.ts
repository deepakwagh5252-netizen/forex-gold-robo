import { SetupRecord, SetupState, SetupFamily } from './scanner';

export type PaperTradingStatus = 'DISABLED' | 'ENABLED' | 'CIRCUIT_BREAKER_HALTED';

export type PaperAccountState = 'PAPER_DISABLED' | 'PAPER_ENABLED' | 'RISK_BLOCKED';

export type RiskBlockReason = 'DAILY_LOSS_LIMIT_REACHED' | 'MAX_DRAWDOWN_REACHED';

export type RiskEngineDecision = 
  | 'ALLOWED'
  | 'BLOCKED_DAILY_LOSS'
  | 'BLOCKED_MAX_DRAWDOWN'
  | 'BLOCKED_MAX_POSITIONS'
  | 'BLOCKED_PAPER_DISABLED'
  | 'BLOCKED_INVALID_RR'
  | 'BLOCKED_INVALID_RISK';

export type PaperOrderStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'REJECTED';

export type PaperExecutionMode = 'MARKET' | 'SETUP_ENTRY';

export type PaperOrderCloseReason = 
  | 'TAKE_PROFIT' 
  | 'PARTIAL_TAKE_PROFIT'
  | 'STOP_LOSS' 
  | 'AMBIGUOUS_INTRABAR_EXIT' 
  | 'MANUAL_PAPER_CLOSE' 
  | 'SETUP_INVALIDATED_BEFORE_FILL' 
  | 'EXPIRED_TIMEOUT';

export type PaperRejectionReason =
  | 'PAPER_TRADING_DISABLED'
  | 'NO_VALIDATED_SETUP'
  | 'NO_VERIFIED_MARKET_DATA'
  | 'INVALID_ENTRY'
  | 'INVALID_STOP'
  | 'INVALID_TARGET'
  | 'INVALID_RISK'
  | 'INVALID_RISK_DISTANCE'
  | 'RR_BELOW_MINIMUM'
  | 'POSITION_LIMIT_REACHED'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'MAX_DRAWDOWN_REACHED'
  | 'DUPLICATE_SETUP'
  | 'MISSING_CONTRACT_SPECIFICATION'
  | 'COMMISSION_NOT_CONFIGURED'
  | 'SPREAD_NOT_CONFIGURED'
  | 'SLIPPAGE_NOT_CONFIGURED';

export interface SetupSnapshot {
  setupId: string;
  setupFamily: SetupFamily;
  direction: 'LONG' | 'SHORT';
  timeframe: string;
  symbol: string;
  entry: number;
  stopLoss: number;
  target: number;
  riskRewardRatio: number;
  liquidityEvidence: string[];
  sweepEvidence: string[];
  structureEvidence: string[];
  displacementEvidence: string[];
  fvgEvidence: string[];
  retestEvidence: string[];
  volatilityEvidence: string[];
  mtfEvidence: string[];
  rrEvidence: string[];
  validationState: SetupState;
  provenance: {
    fact: string[];
    calculation: string[];
    modelOutput: string;
  };
  createdAt: string;
  validatedAt: string;
}

export interface PaperRiskConfig {
  riskPerTradePercent: number; // e.g. 1.0 = 1%
  maxOpenPositions: number; // default 3
  minimumRR: number; // default 2.0
  maximumDailyLossPercent: number; // default 3.0 = 3%
  maximumDrawdownPercent: number; // default 10.0 = 10%
  // Compatibility aliases
  minRiskReward: number;
  maxDailyLossPercent: number;
  maxAccountDrawdownPercent: number;
  commissionPerLot?: number | null; // null = NOT CONFIGURED
  commissionDisabled?: boolean; // true = Simulation OFF (0 fee)
  slippagePips?: number | null; // null = NOT CONFIGURED
  slippageDisabled?: boolean; // true = Simulation OFF (0 pips)
  spreadMarkupPips?: number | null; // null = NOT CONFIGURED
  spreadDisabled?: boolean; // true = Simulation OFF (0 pips)
  // Contract specifications: mapping of symbol -> units per contract (e.g. XAU/USD: 1 oz or 100 oz)
  // If null or undefined: NOT AVAILABLE
  contractSpecifications: Record<string, number | null>;
  // Mode flag: require contract specification or allow raw unit sizing
  requireContractSpec: boolean; // default: true
}

export interface PaperAccount {
  accountId: string; // e.g. "PAPER-ACT-001"
  accountCurrency: 'USD';
  mode: 'PAPER ONLY';
  paperTradingEnabled: boolean; // default false
  state: PaperAccountState; // 'PAPER_DISABLED' | 'PAPER_ENABLED' | 'RISK_BLOCKED'
  riskBlockReason: RiskBlockReason | null;
  initialCapital: number; // 1,000,000 USD
  currentEquity: number;
  availableBalance: number;
  usedMargin: number;
  realizedPnL: number;
  unrealizedPnL: number;
  dailyPnL: number;
  peakEquity: number;
  currentDrawdown: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  createdAt: string;
  updatedAt: string;
  // Compatibility aliases
  isTradingEnabled: boolean;
  dailyStartingEquity: number;
  dailyRealizedPnL?: number;
  drawdownPercent: number;
  dailyLossPercent: number;
  circuitBreakerTripped?: boolean;
  circuitBreakerReason?: string | null;
  lastResetAt?: string;
  lastUpdatedAt?: string;
}

export interface PaperOrder {
  paperOrderId: string;
  setupId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  setupFamily: SetupFamily;
  executionMode: PaperExecutionMode;
  status: PaperOrderStatus;
  createdAt: string;
  filledAt: string | null;
  closedAt: string | null;
  plannedEntryPrice: number;
  executedEntryPrice: number | null;
  slippagePips?: number;
  spreadPips?: number;
  commissionFee?: number;
  commissionMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  spreadMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  slippageMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  stopLoss: number;
  takeProfit: number;
  positionSize: number | null;
  lotSize?: number | null;
  positionSizeDisplay: string;
  remainingSize?: number | null;
  riskAmount: number;
  riskPercent: number;
  initialRisk: number;
  plannedReward: number;
  plannedRR: number;
  currentPrice: number | null;
  unrealizedPnL: number;
  realizedPnL: number | null;
  rMultiple: number | null;
  closeReason: PaperOrderCloseReason | null;
  rejectionReason: PaperRejectionReason | null;
  rejectionDetails: string | null;
  marketDataTimestamp: string | null;
  marketDataSource: string;
  isAmbiguousExit?: boolean;
  ambiguityNote?: string;
  partialExits?: Array<{
    timestamp: string;
    portionPercent: number;
    closedSize: number;
    exitPrice: number;
    realizedPnL: number;
    commissionFee: number;
    rMultiple: number;
  }>;
  setupSnapshot: SetupSnapshot;
  evidenceSnapshot: Record<string, unknown>;
}

export interface PaperPosition {
  positionId: string;
  paperOrderId: string;
  setupId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  setupFamily: SetupFamily;
  openedAt: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number | null;
  lotSize?: number | null;
  positionSizeDisplay: string;
  initialPositionSize?: number | null;
  initialRisk: number;
  slippagePips?: number;
  spreadPips?: number;
  accumulatedFees?: number;
  commissionMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  spreadMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  slippageMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  realizedPnL?: number;
  partialExits?: Array<{
    timestamp: string;
    portionPercent: number;
    closedSize: number;
    exitPrice: number;
    realizedPnL: number;
    commissionFee: number;
    rMultiple: number;
  }>;
  unrealizedPnL: number;
  unrealizedRMultiple: number;
  marketDataTimestamp: string | null;
  marketDataSource: string;
  status: 'OPEN';
}

export interface PaperTradeJournalEntry {
  journalId: string;
  tradeId?: string;
  positionId?: string;
  paperOrderId: string;
  setupId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  setupFamily: SetupFamily;
  timeframe: string;
  openedAt: string;
  closedAt: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  plannedRR: number;
  realizedPnL: number;
  grossPnL?: number;
  netPnL?: number;
  entryCommission?: number;
  exitCommission?: number;
  totalFees?: number;
  slippagePips?: number;
  rMultiple: number;
  rMultipleDisplay: string;
  positionSize: number | null;
  positionSizeDisplay: string;
  initialRisk: number;
  closeReason: PaperOrderCloseReason;
  isAmbiguousExit: boolean;
  ambiguityNote?: string;
  marketDataSource: string;
  marketDataTimestamp: string | null;
  partialExits?: Array<{
    timestamp: string;
    portionPercent: number;
    closedSize: number;
    exitPrice: number;
    realizedPnL: number;
    commissionFee: number;
    rMultiple: number;
  }>;
  // Three-tier audit provenance
  provenance: {
    fact: string[];
    calculation: string[];
    modelOutput: string;
  };
  setupSnapshot: SetupSnapshot;
}
