import { Candle } from '../market-data/provider.interface';
import { MarketRegimeType } from '../types/signal-regime';
import { SetupRecord } from '../types/scanner';

/**
 * Deterministic Strategy Signal States
 */
export type StrategySignalState =
  | 'NO_SETUP'
  | 'BREAKOUT_PENDING'
  | 'BREAKOUT_CONFIRMED'
  | 'BREAKDOWN_PENDING'
  | 'BREAKDOWN_CONFIRMED'
  | 'RETEST_PENDING'
  | 'RETEST_CONFIRMED'
  | 'RETEST_FAILED'
  | 'REJECTION_DETECTED'
  | 'EXCESSIVE_EXTENSION'
  | 'WEAK_MOMENTUM'
  | 'REGIME_UNSUITABLE'
  | 'INSUFFICIENT_DATA'
  | 'NO_TRADE';

/**
 * Atomic Check Evaluation Status
 */
export type EvidenceStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';

/**
 * Explicit Evidence Sheet — No Black Box Scores
 */
export interface StrategyEvidenceSheet {
  resistanceOrSupportValid: EvidenceStatus;
  closeConfirmation: EvidenceStatus;
  displacement: EvidenceStatus;
  breakoutDistance: EvidenceStatus;
  volatility: EvidenceStatus;
  momentum: EvidenceStatus;
  structureAlignment: EvidenceStatus;
  regimeAlignment: EvidenceStatus;
  wickRejection: EvidenceStatus;
  retest: EvidenceStatus;
  retestReaction: EvidenceStatus;
  extension: EvidenceStatus;
}

/**
 * Trap Classification
 */
export type TrapClassification =
  | 'NONE'
  | 'FAKE_BREAKOUT_BULL_TRAP'
  | 'FAKE_BREAKDOWN_BEAR_TRAP';

/**
 * Final Strategy Decision
 */
export type StrategyDecision = 'TRADE_LONG' | 'TRADE_SHORT' | 'WAIT' | 'NO_TRADE';

/**
 * Full Structured Strategy Signal
 */
export interface StrategySignalOutput {
  signalId: string;
  timestamp: number;
  datetimeUtc: string;
  symbol: string;
  timeframe: string;
  state: StrategySignalState;
  decision: StrategyDecision;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  levelBroken: number | null;
  levelType: 'RESISTANCE' | 'SUPPORT' | null;
  trapState: TrapClassification;
  regime: MarketRegimeType;
  evidence: StrategyEvidenceSheet;
  reasonCodes: string[];
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  candidateSetup: SetupRecord | null;
  auditTrail: string[];
}

/**
 * Retest State Tracker Model
 */
export interface RetestTrackingState {
  level: number;
  levelType: 'RESISTANCE' | 'SUPPORT';
  direction: 'BULLISH' | 'BEARISH';
  breakoutTimestamp: number;
  breakoutIndex: number;
  breakoutPrice: number;
  status: 'PENDING' | 'TOUCHED' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  touchCandleIndex?: number;
  touchPrice?: number;
  reactionHeld?: boolean;
}
