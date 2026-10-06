/**
 * Step 5 Golden Forward <-> Replay Equivalence Types
 * 
 * Strict type definitions for side-by-side lifecycle, execution, accounting,
 * identity, friction, and event-ordering parity reporting.
 */

export type ComparisonCategory =
  | 'IDENTITY'
  | 'PRICING'
  | 'SIZING'
  | 'RISK_SL_TP'
  | 'FRICTION'
  | 'ACCOUNTING'
  | 'TIMESTAMPS'
  | 'EVENT_ORDERING'
  | 'SUMMARY_METRICS';

export type ComparisonStatus = 'MATCH' | 'MISMATCH';

export interface ComparisonFieldResult {
  id: string;
  field: string;
  category: ComparisonCategory;
  forwardValue: string | number | boolean | null;
  replayValue: string | number | boolean | null;
  status: ComparisonStatus;
  candleTimestamp: number;
  candleTimeUtc: string;
  description: string;
  diagnosticNotes?: string;
}

export interface LifecycleComparisonRecord {
  stage: 'SETUP_SIGNAL' | 'ORDER_SUBMITTED' | 'POSITION_OPENED' | 'POSITION_UPDATED' | 'POSITION_CLOSED';
  candleTimestamp: number;
  candleTimeUtc: string;
  stageLabel: string;
  fields: ComparisonFieldResult[];
  matchCount: number;
  mismatchCount: number;
  hasMismatch: boolean;
}

export interface TradeComparisonRecord {
  tradeIndex: number;
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  fields: ComparisonFieldResult[];
  matchCount: number;
  mismatchCount: number;
  forwardTradeSummary: {
    tradeId: string;
    paperOrderId: string;
    positionId: string;
    signalId: string;
    entryPrice: number;
    exitPrice: number;
    grossPnL: number;
    netPnL: number;
    totalFees: number;
    closeReason: string;
    openedAt: string;
    closedAt: string;
  };
  replayTradeSummary: {
    tradeId: string;
    paperOrderId: string;
    positionId: string;
    setupId: string;
    entryPrice: number;
    exitPrice: number;
    grossPnL: number;
    netPnL: number;
    totalFees: number;
    closeReason: string;
    openedAt: string;
    closedAt: string;
  };
}

export interface EventOrderingItem {
  stepIndex: number;
  candleTimestamp: number;
  candleTimeUtc: string;
  forwardEvents: Array<{
    eventId: string;
    eventType: string;
    timestamp: string;
    message?: string;
  }>;
  replayEvents: Array<{
    eventId?: string;
    id: string;
    eventType: string;
    datetimeUtc: string;
    reason?: string;
  }>;
  orderEquivalence: 'MATCH' | 'MISMATCH';
  notes?: string;
}

export interface Step5EquivalenceReport {
  generatedAtUtc: string;
  overallStatus: 'PARITY_VERIFIED' | 'DISCREPANCIES_DETECTED';
  totalComparisons: number;
  totalMatches: number;
  totalMismatches: number;
  matchPercentage: number;

  datasetMetadata: {
    candleCount: number;
    startTimeUtc: string;
    endTimeUtc: string;
    symbol: string;
    timeframe: string;
    description: string;
  };

  tradeCount: {
    forward: number;
    replay: number;
    match: boolean;
  };

  summaryMetrics: {
    forward: {
      startingBalance: number;
      endingBalance: number;
      endingEquity: number;
      netPnL: number;
      totalFees: number;
      wins: number;
      losses: number;
      winRate: number;
    };
    replay: {
      startingBalance: number;
      endingBalance: number;
      endingEquity: number;
      netPnL: number;
      totalFees: number;
      wins: number;
      losses: number;
      winRate: number;
    };
    metricsComparison: ComparisonFieldResult[];
  };

  lifecycleComparisons: LifecycleComparisonRecord[];
  tradeComparisons: TradeComparisonRecord[];
  eventOrdering: EventOrderingItem[];
  mismatchesList: ComparisonFieldResult[];
  rawPlainTextReport: string;
}
