import { Candle } from '../market-data/provider.interface';
import { PaperTradeJournalEntry } from './paper-trading';
import { SamplePartitionMetrics, CounterfactualComparison } from './phase-7d-validation';
import { SetupFunnelMetrics, FilterAttributionMetrics, FakeBreakoutAnalysis } from './strategy-validation';

export type MarketSessionType = 'ASIAN' | 'LONDON' | 'LONDON/NEW YORK OVERLAP' | 'NEW YORK' | 'OTHER';

export interface PartitionDetailedMetrics {
  partitionName: 'TRAIN' | 'CALIBRATION' | 'OOS';
  candleCount: number;
  candidateSetups: number;
  executedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancyPerTrade: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdownAmount: number;
  maxDrawdownPercent: number;
  maxConsecutiveLosses: number;
  returnPercent: number;
  averageTradeDurationMinutes: number;
  sharpeRatio: number;
  profitToMaxDrawdownRatio: number;
}

export interface ComponentEdgeAttribution {
  componentName: string;
  category: 'SETUP' | 'FILTER' | 'TRAP_DETECTION';
  setupsObserved: number;
  tradesExecuted: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  expectancyPerTrade: number;
  realizedPnL: number;
  maxDrawdownAmount: number;
  rejectedSetups: number;
  counterfactualLossesAvoided: number;
  contributesPositiveValue: boolean;
  valueContributionType: 'TRADING_ALPHA' | 'DEFENSIVE_CAPITAL_PRESERVATION' | 'NEUTRAL' | 'NO_TRIGGER';
}

export interface DirectionalRobustnessMetrics {
  candidates: number;
  executions: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  expectancyPerTrade: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdownAmount: number;
  edgeStatus: 'PROVEN' | 'UNPROVEN' | 'NEGATIVE';
}

export interface RegimeRobustnessRecord {
  regime: string;
  candleCount: number;
  candidateSetups: number;
  executedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  expectancyPerTrade: number;
  netPnL: number;
  maxDrawdownAmount: number;
  percentageOfTotalPnL: number;
  sampleAdequacy: 'ADEQUATE' | 'UNDERPOWERED';
}

export interface SessionRobustnessRecord {
  session: MarketSessionType;
  candleCount: number;
  candidateSetups: number;
  executedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  expectancyPerTrade: number;
  netPnL: number;
  maxDrawdownAmount: number;
  percentageOfTotalPnL: number;
  sampleAdequacy: 'ADEQUATE' | 'UNDERPOWERED';
}

export interface CostSensitivityStep {
  frictionMultiplier: number;
  spreadPips: number;
  slippagePips: number;
  commissionPerLot: number;
  totalTrades: number;
  netPnL: number;
  expectancyPerTrade: number;
  profitFactor: number;
  maxDrawdownAmount: number;
  edgeStatus: 'POSITIVE_EDGE' | 'MARGINAL_EDGE' | 'EDGE_ELIMINATED';
}

export interface TradeOrderRobustnessMetrics {
  totalTrades: number;
  totalPnL: number;
  bestTradePnL: number;
  bestTradeContributionPercent: number;
  worstTradePnL: number;
  worstTradeContributionPercent: number;
  top1ConcentrationPercent: number;
  top2ConcentrationPercent: number;
  top3ConcentrationPercent: number;
  pnlExcludingBestTrade: number;
  pnlExcludingBest2Trades: number;
  pnlExcludingBest3Trades: number;
  maxConsecutiveLossesObserved: number;
  maxConsecutiveLossesStressScenarioPnL: number;
  shuffledDrawdownP50: number;
  shuffledDrawdownP95: number;
  shuffledDrawdownMax: number;
  concentrationRiskFlag: 'HIGH' | 'MODERATE' | 'LOW';
}

export interface SampleAdequacyAudit {
  totalCandles: number;
  totalExecutedTrades: number;
  oosExecutedTrades: number;
  tradesLong: number;
  tradesShort: number;
  tradesPerRegime: Record<string, number>;
  tradesPerSession: Record<string, number>;
  adequacyThreshold: number; // typically 30 trades
  isTotalSampleAdequate: boolean;
  isOosAdequate: boolean;
  isLongAdequate: boolean;
  isShortAdequate: boolean;
  underpoweredFlags: string[];
}

export interface Phase7EReport {
  timestamp: string;
  datasetName: string;
  totalCandles: number;
  initialBalance: number;
  
  // Part A
  partitioning: {
    train: PartitionDetailedMetrics;
    calibration: PartitionDetailedMetrics;
    oos: PartitionDetailedMetrics;
  };
  overallPerformance: PartitionDetailedMetrics;
  
  // Part B
  edgeDecomposition: ComponentEdgeAttribution[];
  
  // Part C
  directionalRobustness: {
    long: DirectionalRobustnessMetrics;
    short: DirectionalRobustnessMetrics;
    longEdgeStatus: 'UNPROVEN' | 'PROVEN' | 'NEGATIVE';
    shortEdgeStatus: 'UNPROVEN' | 'PROVEN' | 'NEGATIVE';
  };
  
  // Part D
  regimeRobustness: Record<string, RegimeRobustnessRecord>;
  performanceConcentratedInSingleRegime: boolean;
  primaryRegime: string;
  
  // Part E
  sessionRobustness: Record<MarketSessionType, SessionRobustnessRecord>;
  sessionConcentrationFlag: boolean;
  
  // Part F
  costSensitivity: {
    steps: CostSensitivityStep[];
    edgeBreakEvenFrictionMultiplier: number | null; // where edge disappears
    robustTo3xFriction: boolean;
  };
  
  // Part G
  tradeOrderRobustness: TradeOrderRobustnessMetrics;
  
  // Part H
  counterfactualDefense: CounterfactualComparison;
  
  // Part I
  sampleAdequacy: SampleAdequacyAudit;
  
  // Part J
  edgeStabilityClassification: 
    | 'POSITIVE AND ROBUST EDGE'
    | 'POSITIVE BUT INSUFFICIENT EVIDENCE'
    | 'REGIME-SPECIFIC EDGE'
    | 'DIRECTION-SPECIFIC EDGE'
    | 'NO EVIDENCE OF EDGE';
    
  weaknessesDiscovered: string[];
  unprovenMetrics: string[];
  
  // Summary tags
  machineReadableSummary: {
    EDGE_STATUS: string;
    ROBUSTNESS_STATUS: string;
    OOS_TRADES: number;
    TOTAL_TRADES: number;
    OOS_NET_PNL: number;
    OOS_EXPECTANCY: number;
    OOS_PROFIT_FACTOR: number;
    OOS_MAX_DRAWDOWN: number;
    LONG_EDGE_STATUS: string;
    SHORT_EDGE_STATUS: string;
    SESSION_EDGE_STATUS: string;
    REGIME_EDGE_STATUS: string;
    COST_ROBUSTNESS_STATUS: string;
    CONCENTRATION_RISK: string;
    SAMPLE_ADEQUACY: string;
    FINAL_PHASE_7E_STATUS: string;
  };
}
