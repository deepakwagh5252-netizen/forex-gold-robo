import { Candle } from '../market-data/provider.interface';
import { PaperTradeJournalEntry } from '../types/paper-trading';
import { 
  SetupFunnelMetrics, 
  FakeBreakoutAnalysis, 
  FilterAttributionMetrics, 
  RegimePerformanceRecord, 
  DirectionalPerformanceRecord, 
  CounterfactualDiagnostic 
} from './strategy-validation';

/**
 * PHASE 7D: Large-Scale Out-of-Sample Strategy Validation Types
 * 
 * Strict Objectives:
 * 1. Large historical multi-regime sample evaluation (100+ candles from Twelve Data cache & synthetic multi-regime sequences)
 * 2. Deterministic Train / Calibration / Out-of-Sample (OOS) data partitioning
 * 3. Counterfactual analysis comparing UNPROTECTED baseline vs PROTECTED architecture
 * 4. Statistical significance and quality metrics (Sample size thresholds, Confidence intervals)
 * 5. Multi-regime robustness verification across Trending, Ranging, Compression, Expansion
 * 6. Directional asymmetry testing (Long vs Short consistency)
 * 7. Strictly 100% deterministic, zero lookahead, zero Gemini calls, zero extra polling.
 */

export interface SamplePartitionMetrics {
  partitionName: 'TRAIN_REFERENCE' | 'CALIBRATION' | 'OUT_OF_SAMPLE_TEST';
  candleCount: number;
  dateStart: string;
  dateEnd: string;
  setupsObserved: number;
  tradesExecuted: number;
  winRatePercent: number;
  realizedPnL: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  trapsPrevented: number;
  preservationRatePercent: number;
}

export interface CounterfactualComparison {
  // Realized execution with full Phase 7A + 7B protection
  protectedArchitecture: {
    totalTrades: number;
    winRatePercent: number;
    realizedPnL: number;
    maxDrawdownAmount: number;
    maxDrawdownPercent: number;
    profitFactor: number;
  };
  // Counterfactual baseline if every raw breakout were naively executed without regime, displacement, or retest filters
  unprotectedBaseline: {
    totalTrades: number;
    winRatePercent: number;
    simulatedPnL: number;
    maxDrawdownAmount: number;
    simulatedLossAvoided: number;
    trapsFallenInto: number;
  };
  // Explicit value of the defense layers
  protectionBenefitSummary: {
    netPnLImprovement: number;
    frictionAndDrawdownPrevented: number;
    falsePositivesAverted: number;
    riskAdjustedAlpha: string;
  };
}

export interface StatisticalReliabilityMetrics {
  sampleSizeAdequate: boolean;
  totalCandlesEvaluated: number;
  totalSetupsEvaluated: number;
  statisticallySignificantSample: boolean; // >= 30 setups or >= 100 candles
  pnlStandardError: number;
  confidenceInterval95: [number, number]; // [lower, upper] PnL interval
  winRateConfidenceInterval95: [number, number]; // [lower%, upper%]
  regimeDiversityScore: number; // 0 to 100 based on distribution of regimes
}

export interface Phase7DValidationReport {
  timestamp: string;
  datasetSummary: {
    datasetName: string;
    totalCandles: number;
    timeframe: string;
    symbol: string;
    dateRangeStart: string;
    dateRangeEnd: string;
    source: string;
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
  partitioning: {
    trainReference: SamplePartitionMetrics;
    calibration: SamplePartitionMetrics;
    outOfSample: SamplePartitionMetrics;
    outOfSampleRobustnessPass: boolean;
  };
  counterfactual: CounterfactualComparison;
  statisticalReliability: StatisticalReliabilityMetrics;
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
    deterministicReproducibilityPassed: boolean;
  };
}
