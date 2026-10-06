import { FVGDirection, LiquidityLevelSource, StructureEventType } from './intelligence';

export type SetupState = 
  | 'NO_SETUP' 
  | 'WATCH' 
  | 'SETUP_FORMING' 
  | 'VALIDATED_CANDIDATE' 
  | 'INVALIDATED' 
  | 'EXPIRED';

export type SetupFamily = 
  | 'LIQUIDITY_SWEEP_REVERSAL' 
  | 'BREAKOUT_RETEST';

export type SetupDirection = 'BULLISH' | 'BEARISH';

export type ConfluenceResult = 'PASS' | 'FAIL' | 'NOT_AVAILABLE';

export type MultiTimeframeContext = 'aligned' | 'mixed' | 'conflicting' | 'insufficient_data';

export interface SetupConfluence {
  liquidity: ConfluenceResult;
  structure: ConfluenceResult;
  displacement: ConfluenceResult;
  fvg: ConfluenceResult;
  retest: ConfluenceResult;
  volatility: ConfluenceResult;
  multiTimeframe: ConfluenceResult;
  riskReward: ConfluenceResult;
}

export interface SetupEvidence {
  // 1. Liquidity evidence
  liquidityLevel: number | null;
  liquiditySource: LiquidityLevelSource | string | null;
  // 2. Sweep evidence
  sweepDetected: boolean;
  sweepTimestamp: number | null;
  sweepDatetime: string | null;
  sweepHighOrLow: number | null;
  // 3. Structure evidence
  structureEvent: StructureEventType | string | null;
  structureTimestamp: number | null;
  structureDatetime: string | null;
  brokenLevel: number | null;
  // 4. Displacement evidence
  displacementDetected: boolean;
  displacementTimestamp: number | null;
  displacementDatetime: string | null;
  displacementBodyRatio: number | null;
  // 5. FVG evidence
  fvgDetected: boolean;
  fvgUpper: number | null;
  fvgLower: number | null;
  fvgTimestamp: number | null;
  fvgDatetime: string | null;
  // 6. Retest evidence
  retestDetected: boolean;
  retestTimestamp: number | null;
  retestDatetime: string | null;
  retestPrice: number | null;
  retestHolds: boolean;
}

export interface SetupRisk {
  entryReference: number | null;
  entryType: 'CALCULATED' | 'MODEL_OUTPUT';
  entryMethod: string;
  stopLossReference: number | null;
  stopLossType: 'CALCULATED';
  stopLossMethod: string;
  targetReference: number | null;
  targetType: 'CALCULATED';
  targetSource: string | null;
  riskDistance: number | null;
  rewardDistance: number | null;
  riskRewardRatio: number | null;
  minimumRequiredRR: number;
}

export interface SetupProvenance {
  fact: string[];
  calculation: string[];
  modelOutput: string[];
}

export interface SetupValidation {
  dataVerified: boolean;
  marketRegime: string;
  volatilityState: string;
  multiTimeframeContext: MultiTimeframeContext;
  conditionsPassed: string[];
  conditionsFailed: string[];
  confluence: SetupConfluence;
  invalidationCondition: string;
  isInvalidated: boolean;
  invalidationTimestamp?: number | null;
  invalidationReason?: string | null;
  measuredValue?: number | null;
}

export interface SetupRecord {
  setupId: string;
  symbol: 'XAU/USD';
  timeframe: string;
  direction: SetupDirection;
  setupFamily: SetupFamily;
  createdAt: string;
  lastUpdated: string;
  status: SetupState;
  statusReason: string;
  lifecycleSequence: SetupState[];
  evidence: SetupEvidence;
  risk: SetupRisk;
  validation: SetupValidation;
  provenance: SetupProvenance;
  originatingCandleTimestamp: number;
  originatingEventKey: string;
  expirationReason?: string | null;
  expirationTimestamp?: number | null;
}

export interface ScannerConfig {
  minRiskReward: number;
  maxLookbackBars: number;
  maxRetestWaitBars: number;
  sweepTolerancePips: number;
  stopLossBufferUsd: number;
}

export type CurrentScannerState = 
  | 'NO_VALIDATED_SETUP' 
  | 'WATCH' 
  | 'SETUP_FORMING' 
  | 'VALIDATED_CANDIDATE' 
  | 'INVALIDATED' 
  | 'INSUFFICIENT VERIFIED DATA';

export interface CurrentSetupSnapshot {
  currentScannerState: CurrentScannerState;
  activeSetupId: string | null;
  setupFamily: SetupFamily | null;
  timeframe: string;
  direction: SetupDirection | null;
  entry: number | null;
  stopLoss: number | null;
  target: number | null;
  riskRewardRatio: number | null;
  confluenceComponents: SetupConfluence;
  lifecycleState: SetupState;
  lastEvidenceTimestamp: number | null;
  lastEvidenceDatetime: string | null;
  statusReason: string;
  dataVerified: boolean;
}

export interface ScannerSummary {
  symbol: 'XAU/USD';
  timeframe: string;
  status: 'NO_VALIDATED_SETUP' | 'VALIDATED_CANDIDATES_FOUND' | 'INSUFFICIENT_DATA';
  currentScannerState: CurrentScannerState;
  currentSetup: SetupRecord | null;
  candidates: SetupRecord[];
  validatedCount: number;
  formingCount: number;
  watchCount: number;
  invalidatedCount: number;
  expiredCount: number;
  scannedAt: string;
  minRiskRewardThreshold: number;
  dataVerified: boolean;
  paperTradeCreated: false;
  activeSetupId: string | null;
  lastEvidenceTimestamp: number | null;
  snapshot: CurrentSetupSnapshot;
}
