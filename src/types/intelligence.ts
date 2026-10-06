import { Candle } from '../market-data/provider.interface';

export type IntelligenceClassification = 'FACT' | 'CALCULATION' | 'MODEL_OUTPUT';

export type TrendState = 'BULLISH' | 'BEARISH' | 'RANGING' | 'UNDEFINED';
export type RangeState = 'TRENDING' | 'EXPANDING' | 'COMPRESSING' | 'CONSOLIDATING' | 'UNDEFINED';
export type VolatilityClassification = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'UNDEFINED';
export type SwingType = 'SWING_HIGH' | 'SWING_LOW';
export type StructurePointType = 'HH' | 'HL' | 'LH' | 'LL';
export type StructureEventType = 'BOS' | 'CHOCH';
export type FVGDirection = 'BULLISH' | 'BEARISH';
export type LiquidityLevelSource = 
  | 'PREVIOUS_DAY_HIGH'
  | 'PREVIOUS_DAY_LOW'
  | 'PREVIOUS_WEEK_HIGH'
  | 'PREVIOUS_WEEK_LOW'
  | 'EQUAL_HIGHS'
  | 'EQUAL_LOWS'
  | 'SESSION_HIGH'
  | 'SESSION_LOW';

export interface IntelligenceItem<T> {
  value: T;
  classification: IntelligenceClassification;
  source: string;
  timestamp: string | null;
  candleTimestamp: number | null;
  symbol: string;
  timeframe: string;
  isVerified: boolean;
  notes?: string;
}

export interface SwingPoint {
  index: number;
  type: SwingType;
  price: number;
  timestamp: number;
  datetime: string;
  structureType?: StructurePointType;
  isConfirmed: boolean;
}

export interface MarketStructureState {
  trendState: TrendState;
  rangeState: RangeState;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  higherHighsCount: number;
  higherLowsCount: number;
  lowerHighsCount: number;
  lowerLowsCount: number;
  lastStructurePoint: StructurePointType | null;
  lastEvent: {
    type: StructureEventType;
    direction: 'BULLISH' | 'BEARISH';
    brokenLevel: number;
    breakCandleTimestamp: number;
    datetime: string;
    timeframe: string;
  } | null;
}

export interface PreviousPeriodLevels {
  pdh: number | null;
  pdl: number | null;
  pdo: number | null;
  pdc: number | null;
  pwh: number | null;
  pwl: number | null;
  pwo: number | null;
  pwc: number | null;
  timestamp: number | null;
  datetime: string | null;
}

export interface ATRVolatility {
  atr: number | null;
  period: number;
  classification: VolatilityClassification;
  currentCandleRange: number | null;
  averageRangeRatio: number | null;
  thresholds: {
    lowMaxRatio: number;
    normalMaxRatio: number;
    highMaxRatio: number;
  };
}

export interface SessionBoundary {
  name: 'ASIA' | 'LONDON' | 'NEW_YORK';
  utcStartHour: number;
  utcEndHour: number;
  isActive: boolean;
  sessionHigh: number | null;
  sessionLow: number | null;
  sessionOpen: number | null;
  sessionClose: number | null;
  sessionRange: number | null;
}

export interface LiquidityLevel {
  id: string;
  level: number;
  source: LiquidityLevelSource;
  timestamp: number | null;
  datetime: string | null;
  distanceFromCurrentPrice: number | null;
  validationStatus: 'CONFIRMED' | 'PENDING' | 'INVALID';
  isSwept: boolean;
}

export interface LiquiditySweep {
  levelSwept: number;
  source: LiquidityLevelSource;
  sweepCandleTimestamp: number;
  sweepHighOrLow: number;
  sweepClose: number;
  confirmationCandleTimestamp: number;
  timestamp: number;
  datetime: string;
  direction: 'BEARISH_SWEEP_OF_HIGHS' | 'BULLISH_SWEEP_OF_LOWS';
  timeframe: string;
}

export interface DisplacementCandle {
  timestamp: number;
  datetime: string;
  direction: 'BULLISH' | 'BEARISH';
  candleRange: number;
  bodySize: number;
  bodyToRangeRatio: number;
  atrRatio: number;
  isDisplaced: boolean;
}

export interface FairValueGap {
  id: string;
  direction: FVGDirection;
  upperBoundary: number;
  lowerBoundary: number;
  gapSize: number;
  formationTimestamp: number;
  datetime: string;
  timeframe: string;
  isFilled: boolean;
  fillPercentage: number;
  candles: [Candle, Candle, Candle];
}

export interface StructureEvent {
  type: StructureEventType;
  direction: 'BULLISH' | 'BEARISH';
  brokenLevel: number;
  breakCandleTimestamp: number;
  datetime: string;
  timeframe: string;
}

export interface MultiTimeframeFact {
  timeframe: 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
  hasData: boolean;
  candleCount: number;
  trend: TrendState;
  structure: string;
  volatility: VolatilityClassification;
  atr: number | null;
  liquidityState: string;
  latestCandleTimestamp: number | null;
}

export interface XauUsdMarketIntelligence {
  symbol: 'XAU/USD';
  timeframe: string;
  status: 'VERIFIED' | 'INSUFFICIENT VERIFIED DATA';
  candleCount: number;
  latestCandle: Candle | null;
  marketStructure: MarketStructureState | null;
  previousPeriodLevels: PreviousPeriodLevels | null;
  volatility: ATRVolatility | null;
  sessions: SessionBoundary[];
  liquidityLevels: LiquidityLevel[];
  liquiditySweeps: LiquiditySweep[];
  displacements: DisplacementCandle[];
  fairValueGaps: FairValueGap[];
  structureEvents: StructureEvent[];
  multiTimeframeFacts: MultiTimeframeFact[];
  calculatedAt: string;
}
