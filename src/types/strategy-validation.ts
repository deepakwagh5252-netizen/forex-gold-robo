import { Candle } from '../market-data/provider.interface';
import { PaperTradeJournalEntry } from '../types/paper-trading';

/**
 * PHASE 7C: Historical Strategy Validation & Performance Attribution Types
 * 
 * Strict Objectives:
 * 1. Setup Funnel Metrics
 * 2. Fake-Breakout & False Breakdown Analysis
 * 3. Protection Layer Attribution (Filter Rejections)
 * 4. Market Regime Breakdown
 * 5. Directional Attribution (Long vs Short)
 * 6. Counterfactual Diagnostic (Safety & Protection Value)
 * 7. 100% Deterministic, strictly No-Lookahead
 */

export interface SetupFunnelMetrics {
  totalCandlesEvaluated: number;
  totalBreakoutBreakdownObserved: number;
  breakoutCandidateSetups: number; // Long
  breakdownCandidateSetups: number; // Short
  setupsReachingRetestPending: number;
  setupsReachingRetestConfirmed: number;
  setupsRejectedFailedRetest: number;
  ordersSubmittedToRiskManager: number;
  ordersApprovedAndExecuted: number;
  conversionRatePercent: number; // (executed / observed) * 100
}

export interface FakeBreakoutAnalysis {
  fakeBreakoutsDetected: number; // Bull traps
  fakeBreakdownsDetected: number; // Bear traps
  totalTrapsIdentified: number;
  trapsPreventedFromTrading: number; // Traps with decision = NO_TRADE
  trapPreventionEfficiencyPercent: number; // (trapsPrevented / totalTraps) * 100
}

export interface FilterAttributionMetrics {
  regimeUnsuitable: number; // Volatility compression / undefined
  excessiveExtension: number; // Extended beyond ATR threshold
  failedRetest: number; // Violated breakout level back into range
  rejectionDetected: number; // Wicked above/below and closed inside
  insufficientDisplacement: number; // Small body ratio (< 55%)
  insufficientData: number; // History < 14 bars
  totalFiltersTriggered: number;
}

export interface RegimePerformanceRecord {
  regime: string;
  candleCount: number;
  setupsObserved: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  realizedPnL: number;
  profitFactor: number;
}

export interface DirectionalPerformanceRecord {
  direction: 'LONG' | 'SHORT';
  breakoutBreakdownObserved: number;
  retestsConfirmed: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  realizedPnL: number;
  profitFactor: number;
  averageRMultiple: number;
  maxDrawdownAmount: number;
}

export interface CounterfactualDiagnostic {
  trapSetupsCount: number;
  simulatedUnprotectedLossAvoided: number;
  failedRetestSetupsCount: number;
  simulatedChasingLossAvoided: number;
  totalUnfilteredRiskAvoided: number;
  conclusion: string;
}

export interface Phase7CValidationReport {
  timestamp: string;
  datasetSummary: {
    datasetName: string;
    totalCandles: number;
    timeframe: string;
    symbol: string;
    dateRangeStart: string;
    dateRangeEnd: string;
    initialBalance: number;
    finalBalance: number;
    finalEquity: number;
  };
  funnel: SetupFunnelMetrics;
  fakeoutAnalysis: FakeBreakoutAnalysis;
  filterAttribution: FilterAttributionMetrics;
  regimeAttribution: Record<string, RegimePerformanceRecord>;
  directionalAttribution: {
    long: DirectionalPerformanceRecord;
    short: DirectionalPerformanceRecord;
  };
  tradePerformance: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRatePercent: number;
    totalRealizedPnL: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number;
    maxDrawdownAmount: number;
    maxDrawdownPercent: number;
    trades: PaperTradeJournalEntry[];
  };
  counterfactualDiagnostic: CounterfactualDiagnostic;
  architecturalCompliance: {
    noLookaheadVerified: boolean;
    zeroNewMarketDataCalls: boolean;
    zeroGeminiCalls: boolean;
    riskManagerPreserved: boolean;
    executionIntegrityPreserved: boolean;
    parametersUnmodified: boolean;
  };
}
