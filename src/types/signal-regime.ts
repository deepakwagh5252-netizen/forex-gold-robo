import { Candle } from '../market-data/provider.interface';
import { SetupRecord } from './scanner';

/**
 * PHASE 7A: Market Regime Classifications
 */
export type MarketRegimeType = 
  | 'TRENDING_BULLISH'
  | 'TRENDING_BEARISH'
  | 'RANGING_CONSOLIDATION'
  | 'VOLATILITY_EXPANSION'
  | 'LOW_VOLATILITY_COMPRESSION'
  | 'UNDEFINED';

/**
 * Breakout & Breakdown Classification
 */
export type BreakoutType = 
  | 'VALID_BREAKOUT'
  | 'FAKE_BREAKOUT_BULL_TRAP'
  | 'VALID_BREAKDOWN'
  | 'FAKE_BREAKDOWN_BEAR_TRAP'
  | 'NONE';

/**
 * Signal State Machine States
 */
export type SignalLifecycleState =
  | 'NO_SIGNAL'
  | 'SETUP_DETECTED'
  | 'BREAKOUT_OBSERVED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'NO_TRADE_ZONE';

/**
 * Reasons why system is in a NO_TRADE_ZONE or signal was rejected
 */
export type NoTradeReason =
  | 'CHOPPY_REGIME'
  | 'COMPRESSION_WITHOUT_EXPANSION'
  | 'SPREAD_OR_VOLATILITY_ANOMALY'
  | 'CONFLICTING_HIGHER_TIMEFRAME'
  | 'INSUFFICIENT_RR'
  | 'INSUFFICIENT_DISPLACEMENT'
  | 'FAILED_RETEST'
  | 'SWEEP_REVERSAL_REJECTED'
  | 'EXCESSIVE_CHOP'
  | 'INSUFFICIENT_CANDLE_HISTORY';

/**
 * Objective Regime Assessment Report
 */
export interface MarketRegimeReport {
  regime: MarketRegimeType;
  trendStrengthScore: number; // 0 to 100
  rangeBound: boolean;
  compression: boolean;
  atrValue: number;
  keySupport: number | null;
  keyResistance: number | null;
  timestamp: number;
  datetimeUtc: string;
  provenance: {
    fact: string[];
    calculation: string[];
    modelOutput: string;
  };
}

/**
 * Breakout / Breakdown Evaluation Report
 */
export interface BreakoutEvaluation {
  type: BreakoutType;
  levelBroken: number;
  breakoutCandleTimestamp: number;
  displacementRatio: number;
  isConfirmed: boolean;
  isFakeoutTrap: boolean;
  retestObserved: boolean;
  retestHolds: boolean;
  notes: string;
}

/**
 * Phase 7A Signal Record Output
 */
export interface Phase7ASignal {
  signalId: string;
  timestamp: number;
  datetimeUtc: string;
  symbol: string;
  timeframe: string;
  state: SignalLifecycleState;
  regime: MarketRegimeType;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  breakoutType: BreakoutType;
  isTradable: boolean;
  noTradeReason: NoTradeReason | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  confluenceScore: number; // 0 to 100
  candidateSetup: SetupRecord | null;
  auditTrail: string[];
}
