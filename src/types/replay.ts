import { Candle } from '../market-data/provider.interface';
import { 
  PaperPosition, 
  PaperOrder, 
  PaperTradeJournalEntry, 
  PaperRiskConfig, 
  PaperAccount,
  PaperOrderCloseReason,
  PaperRejectionReason
} from './paper-trading';
import { SetupRecord } from './scanner';

export type ReplayState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'STEPPING' | 'COMPLETED' | 'ERROR';

export interface ReplayConfig {
  symbol: string;
  timeframe: string;
  initialBalance: number;
  riskConfig: Partial<PaperRiskConfig>;
  stepDelayMs: number; // For Play animation playback
  filterABEnabled?: boolean; // Controls whether Phase 7F/7G Filter AB is evaluated
}

export interface ReplayCandleContext {
  /** The current active candle (at index N) */
  currentCandle: Candle;
  /** Available historical candles from 0 up to N (Strictly NO-LOOKAHEAD: excludes N+1...) */
  history: Candle[];
  /** Current index in the dataset */
  currentIndex: number;
  /** Total candles in historical dataset */
  totalCandles: number;
  /** Replay simulation timestamp (UTC ms) */
  timestamp: number;
}

export type ReplayJournalEventType =
  | 'CANDLE_TICK'
  | 'SIGNAL_DETECTED'
  | 'ORDER_SUBMITTED'
  | 'ORDER_REJECTED'
  | 'ORDER_FILLED'
  | 'POSITION_OPENED'
  | 'POSITION_UPDATED'
  | 'POSITION_PARTIAL_CLOSE'
  | 'POSITION_CLOSED'
  | 'DRAWDOWN_UPDATED'
  | 'REPLAY_RESET'
  | 'REPLAY_COMPLETED';

export interface ReplayJournalRecord {
  id: string;
  eventId?: string;
  tradeId?: string;
  positionId?: string;
  paperOrderId?: string;
  timestamp: number;
  datetimeUtc: string;
  symbol: string;
  timeframe: string;
  candleIndex: number;
  eventType: ReplayJournalEventType;
  price: number;
  side?: 'LONG' | 'SHORT';
  positionState?: 'PENDING' | 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED';
  quantity?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  commission?: number;
  spread?: number;
  slippage?: number;
  realizedPnL?: number;
  grossPnL?: number;
  netPnL?: number;
  entryCommission?: number;
  exitCommission?: number;
  totalFees?: number;
  unrealizedPnL?: number;
  equity?: number;
  balance?: number;
  drawdownPercent?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ReplayMetrics {
  totalCandles: number;
  processedCandles: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalRealizedPnL: number;
  currentUnrealizedPnL: number;
  currentEquity: number;
  currentBalance: number;
  peakEquity: number;
  maxDrawdownAmount: number;
  maxDrawdownPercent: number;
  currentDrawdownPercent: number;
}

export interface ReplayStepResult {
  candleIndex: number;
  timestamp: number;
  datetimeUtc: string;
  currentCandle: Candle;
  events: ReplayJournalRecord[];
  openPositions: PaperPosition[];
  closedTrades: PaperTradeJournalEntry[];
  metrics: ReplayMetrics;
  isComplete: boolean;
}

/**
 * Interface that any strategy hook into the replay engine must implement.
 * CRITICAL RULE: receives ONLY the ReplayCandleContext which strictly encapsulates
 * candles 0..N without future data.
 */
export interface IReplayStrategy {
  id: string;
  name: string;
  /** Evaluates available context at candle N to produce zero or more candidate trade setups */
  evaluate(context: ReplayCandleContext): SetupRecord[];
}
