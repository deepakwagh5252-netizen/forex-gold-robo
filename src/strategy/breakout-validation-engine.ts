import { Candle } from '../market-data/provider.interface';
import { MarketStructureState } from '../types/intelligence';
import { MarketRegimeReport } from '../types/signal-regime';
import { 
  StrategyEvidenceSheet, 
  TrapClassification, 
  RetestTrackingState,
  StrategySignalState 
} from './strategy-signal-types';

export interface BreakoutValidationConfig {
  minDisplacementRatio: number;      // default 0.55 (body/range)
  maxExtensionAtrMultiplier: number; // default 2.2 * ATR away from broken level is extended
  minBreakoutDistanceAtr: number;    // default 0.15 * ATR minimum breakout distance beyond level
  maxRetestBars: number;             // default 8 bars maximum to wait for retest
  retestToleranceAtr: number;        // default 0.35 * ATR tolerance around retest level
  minAtrThreshold: number;           // minimum absolute volatility
}

export const DEFAULT_VALIDATION_CONFIG: BreakoutValidationConfig = {
  minDisplacementRatio: 0.55,
  maxExtensionAtrMultiplier: 2.2,
  minBreakoutDistanceAtr: 0.15,
  maxRetestBars: 8,
  retestToleranceAtr: 0.35,
  minAtrThreshold: 0.10,
};

export interface ValidationEvaluationResult {
  evidence: StrategyEvidenceSheet;
  trapState: TrapClassification;
  state: StrategySignalState;
  reasonCodes: string[];
  retestTracking: RetestTrackingState | null;
  isValidated: boolean;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  levelBroken: number | null;
  levelType: 'RESISTANCE' | 'SUPPORT' | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
}

/**
 * BreakoutValidationEngine
 * 
 * Deterministic engine providing mathematical breakout, retest, fakeout,
 * momentum, volatility, and extension validation for Long breakouts and Short breakdowns.
 */
export class BreakoutValidationEngine {
  private config: BreakoutValidationConfig;

  constructor(config: Partial<BreakoutValidationConfig> = {}) {
    this.config = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  }

  /**
   * Evaluates historical candle context (0..N) against structural boundaries.
   * STRICT NO-LOOKAHEAD: Operates solely on candles up to active candle index N.
   */
  public evaluate(
    candles: Candle[],
    structure: MarketStructureState,
    regimeReport: MarketRegimeReport,
    activeRetestTracker: RetestTrackingState | null = null
  ): ValidationEvaluationResult {
    // 0. Default Evidence Sheet (all pending / not applicable until evaluated)
    const evidence: StrategyEvidenceSheet = {
      resistanceOrSupportValid: 'NOT_APPLICABLE',
      closeConfirmation: 'NOT_APPLICABLE',
      displacement: 'NOT_APPLICABLE',
      breakoutDistance: 'NOT_APPLICABLE',
      volatility: 'NOT_APPLICABLE',
      momentum: 'NOT_APPLICABLE',
      structureAlignment: 'NOT_APPLICABLE',
      regimeAlignment: 'NOT_APPLICABLE',
      wickRejection: 'NOT_APPLICABLE',
      retest: 'NOT_APPLICABLE',
      retestReaction: 'NOT_APPLICABLE',
      extension: 'NOT_APPLICABLE',
    };

    const reasonCodes: string[] = [];

    // Insufficient candle history (< 14 bars)
    if (!candles || candles.length < 14) {
      evidence.resistanceOrSupportValid = 'FAIL';
      reasonCodes.push('INSUFFICIENT_DATA');
      return {
        evidence,
        trapState: 'NONE',
        state: 'INSUFFICIENT_DATA',
        reasonCodes,
        retestTracking: null,
        isValidated: false,
        direction: 'FLAT',
        levelBroken: null,
        levelType: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        riskRewardRatio: null,
      };
    }

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const atr = Math.max(regimeReport.atrValue || 0, this.config.minAtrThreshold);
    const keyRes = regimeReport.keyResistance;
    const keySup = regimeReport.keySupport;

    // 1. Regime Suitability Check
    const regime = regimeReport.regime;
    if (regime === 'UNDEFINED' || regime === 'LOW_VOLATILITY_COMPRESSION' || regimeReport.compression) {
      evidence.regimeAlignment = 'FAIL';
      evidence.volatility = (regime === 'LOW_VOLATILITY_COMPRESSION' || regimeReport.compression) ? 'FAIL' : 'PASS';
      reasonCodes.push('REGIME_UNSUITABLE');
      return {
        evidence,
        trapState: 'NONE',
        state: 'REGIME_UNSUITABLE',
        reasonCodes,
        retestTracking: null,
        isValidated: false,
        direction: 'FLAT',
        levelBroken: null,
        levelType: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        riskRewardRatio: null,
      };
    } else {
      evidence.regimeAlignment = 'PASS';
      evidence.volatility = 'PASS';
    }

    // 2. RETEST TRACKING FOR ACTIVE SETUP (If previously awaiting retest)
    if (activeRetestTracker && activeRetestTracker.status === 'PENDING') {
      const updatedTracker = this.evaluateRetestProgress(
        candles,
        activeRetestTracker,
        atr,
        structure,
        regimeReport
      );

      if (updatedTracker.status === 'CONFIRMED') {
        // Retest confirmed!
        evidence.retest = 'PASS';
        evidence.retestReaction = 'PASS';
        evidence.closeConfirmation = 'PASS';
        evidence.structureAlignment = 'PASS';
        evidence.extension = 'PASS';
        reasonCodes.push('RETEST_CONFIRMED');

        const isLong = updatedTracker.direction === 'BULLISH';
        const entryPrice = current.close;
        const stopLoss = isLong
          ? updatedTracker.level - atr * 1.0
          : updatedTracker.level + atr * 1.0;
        const takeProfit = isLong
          ? entryPrice + Math.abs(entryPrice - stopLoss) * 2.0
          : entryPrice - Math.abs(entryPrice - stopLoss) * 2.0;
        const rr = Number((Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)).toFixed(2));

        return {
          evidence,
          trapState: 'NONE',
          state: 'RETEST_CONFIRMED',
          reasonCodes,
          retestTracking: updatedTracker,
          isValidated: true,
          direction: isLong ? 'LONG' : 'SHORT',
          levelBroken: updatedTracker.level,
          levelType: updatedTracker.levelType,
          entryPrice,
          stopLoss,
          takeProfit,
          riskRewardRatio: rr,
        };
      } else if (updatedTracker.status === 'FAILED' || updatedTracker.status === 'EXPIRED') {
        evidence.retest = 'FAIL';
        evidence.retestReaction = 'FAIL';
        reasonCodes.push(updatedTracker.status === 'FAILED' ? 'RETEST_FAILED' : 'RETEST_EXPIRED');
        return {
          evidence,
          trapState: 'NONE',
          state: 'RETEST_FAILED',
          reasonCodes,
          retestTracking: null,
          isValidated: false,
          direction: 'FLAT',
          levelBroken: updatedTracker.level,
          levelType: updatedTracker.levelType,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      } else {
        // Still pending retest
        evidence.retest = 'PENDING';
        evidence.retestReaction = 'PENDING';
        reasonCodes.push('RETEST_PENDING');
        return {
          evidence,
          trapState: 'NONE',
          state: 'RETEST_PENDING',
          reasonCodes,
          retestTracking: updatedTracker,
          isValidated: false,
          direction: updatedTracker.direction === 'BULLISH' ? 'LONG' : 'SHORT',
          levelBroken: updatedTracker.level,
          levelType: updatedTracker.levelType,
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      }
    }

    // 3. BULL TRAP & BEAR TRAP RECOGNITION (Fake-breakouts)
    // Check Resistance interactions for Bull Trap
    if (keyRes !== null) {
      const pushedAbove = current.high > keyRes || prev.high > keyRes;
      const closedBackInside = current.close < keyRes;
      const wickAbove = current.high > keyRes && current.close < keyRes;
      const prevBrokeFailed = prev.close > keyRes && current.close < keyRes;

      if (pushedAbove && closedBackInside && (wickAbove || prevBrokeFailed)) {
        evidence.resistanceOrSupportValid = 'PASS';
        evidence.closeConfirmation = 'FAIL';
        evidence.wickRejection = 'PASS'; // Wick rejection happened
        reasonCodes.push('FAKE_BREAKOUT_BULL_TRAP');
        reasonCodes.push('REJECTION_DETECTED');

        return {
          evidence,
          trapState: 'FAKE_BREAKOUT_BULL_TRAP',
          state: 'REJECTION_DETECTED',
          reasonCodes,
          retestTracking: null,
          isValidated: false, // Traps do not auto-execute
          direction: 'FLAT',
          levelBroken: keyRes,
          levelType: 'RESISTANCE',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      }
    }

    // Check Support interactions for Bear Trap
    if (keySup !== null) {
      const piercedBelow = current.low < keySup || prev.low < keySup;
      const closedBackAbove = current.close > keySup;
      const wickBelow = current.low < keySup && current.close > keySup;
      const prevBrokeFailed = prev.close < keySup && current.close > keySup;

      if (piercedBelow && closedBackAbove && (wickBelow || prevBrokeFailed)) {
        evidence.resistanceOrSupportValid = 'PASS';
        evidence.closeConfirmation = 'FAIL';
        evidence.wickRejection = 'PASS';
        reasonCodes.push('FAKE_BREAKDOWN_BEAR_TRAP');
        reasonCodes.push('REJECTION_DETECTED');

        return {
          evidence,
          trapState: 'FAKE_BREAKDOWN_BEAR_TRAP',
          state: 'REJECTION_DETECTED',
          reasonCodes,
          retestTracking: null,
          isValidated: false, // Traps do not auto-execute
          direction: 'FLAT',
          levelBroken: keySup,
          levelType: 'SUPPORT',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      }
    }

    // 4. LONG BREAKOUT EVALUATION
    if (keyRes !== null && current.close > keyRes) {
      evidence.resistanceOrSupportValid = 'PASS';
      evidence.closeConfirmation = 'PASS';

      // Displacement check
      const candleRange = current.high - current.low;
      const bodySize = Math.abs(current.close - current.open);
      const displacementRatio = candleRange > 0 ? bodySize / candleRange : 0;
      if (displacementRatio >= this.config.minDisplacementRatio && current.close > current.open) {
        evidence.displacement = 'PASS';
      } else {
        evidence.displacement = 'FAIL';
        reasonCodes.push('WEAK_DISPLACEMENT');
      }

      // Breakout distance check
      const breakoutDist = current.close - keyRes;
      if (breakoutDist >= this.config.minBreakoutDistanceAtr * atr) {
        evidence.breakoutDistance = 'PASS';
      } else {
        evidence.breakoutDistance = 'FAIL';
        reasonCodes.push('INSUFFICIENT_BREAKOUT_DISTANCE');
      }

      // Momentum check (Close near high, upper wick not excessive)
      const upperWick = current.high - Math.max(current.open, current.close);
      if (upperWick <= candleRange * 0.35) {
        evidence.momentum = 'PASS';
        evidence.wickRejection = 'PASS';
      } else {
        evidence.momentum = 'FAIL';
        evidence.wickRejection = 'FAIL';
        reasonCodes.push('WEAK_MOMENTUM');
      }

      // Market Structure Alignment
      if (structure.trendState === 'BULLISH' || structure.higherHighsCount >= 1) {
        evidence.structureAlignment = 'PASS';
      } else {
        evidence.structureAlignment = 'FAIL';
        reasonCodes.push('STRUCTURE_MISALIGNED');
      }

      // Extension / Exhaustion Check
      if (breakoutDist > this.config.maxExtensionAtrMultiplier * atr) {
        evidence.extension = 'FAIL';
        reasonCodes.push('EXCESSIVE_EXTENSION');
        return {
          evidence,
          trapState: 'NONE',
          state: 'EXCESSIVE_EXTENSION',
          reasonCodes,
          retestTracking: null,
          isValidated: false,
          direction: 'LONG',
          levelBroken: keyRes,
          levelType: 'RESISTANCE',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      } else {
        evidence.extension = 'PASS';
      }

      // Check if all breakout entry criteria passed
      const breakoutPass =
        evidence.resistanceOrSupportValid === 'PASS' &&
        evidence.closeConfirmation === 'PASS' &&
        evidence.displacement === 'PASS' &&
        evidence.breakoutDistance === 'PASS' &&
        evidence.momentum === 'PASS' &&
        evidence.regimeAlignment === 'PASS' &&
        evidence.extension === 'PASS';

      if (breakoutPass) {
        // Initialize retest tracking for this breakout!
        const tracker: RetestTrackingState = {
          level: keyRes,
          levelType: 'RESISTANCE',
          direction: 'BULLISH',
          breakoutTimestamp: current.timestamp,
          breakoutIndex: candles.length - 1,
          breakoutPrice: current.close,
          status: 'PENDING',
        };

        evidence.retest = 'PENDING';
        evidence.retestReaction = 'PENDING';
        reasonCodes.push('BREAKOUT_CONFIRMED');
        reasonCodes.push('RETEST_PENDING');

        return {
          evidence,
          trapState: 'NONE',
          state: 'BREAKOUT_CONFIRMED',
          reasonCodes,
          retestTracking: tracker,
          isValidated: false, // Awaiting retest before live execution
          direction: 'LONG',
          levelBroken: keyRes,
          levelType: 'RESISTANCE',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      } else {
        reasonCodes.push('BREAKOUT_PENDING');
        return {
          evidence,
          trapState: 'NONE',
          state: 'BREAKOUT_PENDING',
          reasonCodes,
          retestTracking: null,
          isValidated: false,
          direction: 'LONG',
          levelBroken: keyRes,
          levelType: 'RESISTANCE',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      }
    }

    // 5. SHORT BREAKDOWN EVALUATION (Exact Symmetric Logic)
    if (keySup !== null && current.close < keySup) {
      evidence.resistanceOrSupportValid = 'PASS';
      evidence.closeConfirmation = 'PASS';

      // Displacement check
      const candleRange = current.high - current.low;
      const bodySize = Math.abs(current.close - current.open);
      const displacementRatio = candleRange > 0 ? bodySize / candleRange : 0;
      if (displacementRatio >= this.config.minDisplacementRatio && current.close < current.open) {
        evidence.displacement = 'PASS';
      } else {
        evidence.displacement = 'FAIL';
        reasonCodes.push('WEAK_DISPLACEMENT');
      }

      // Breakdown distance check
      const breakdownDist = keySup - current.close;
      if (breakdownDist >= this.config.minBreakoutDistanceAtr * atr) {
        evidence.breakoutDistance = 'PASS';
      } else {
        evidence.breakoutDistance = 'FAIL';
        reasonCodes.push('INSUFFICIENT_BREAKDOWN_DISTANCE');
      }

      // Momentum check (Close near low, lower wick not excessive)
      const lowerWick = Math.min(current.open, current.close) - current.low;
      if (lowerWick <= candleRange * 0.35) {
        evidence.momentum = 'PASS';
        evidence.wickRejection = 'PASS';
      } else {
        evidence.momentum = 'FAIL';
        evidence.wickRejection = 'FAIL';
        reasonCodes.push('WEAK_MOMENTUM');
      }

      // Market Structure Alignment
      if (structure.trendState === 'BEARISH' || structure.lowerLowsCount >= 1) {
        evidence.structureAlignment = 'PASS';
      } else {
        evidence.structureAlignment = 'FAIL';
        reasonCodes.push('STRUCTURE_MISALIGNED');
      }

      // Extension / Exhaustion Check
      if (breakdownDist > this.config.maxExtensionAtrMultiplier * atr) {
        evidence.extension = 'FAIL';
        reasonCodes.push('EXCESSIVE_EXTENSION');
        return {
          evidence,
          trapState: 'NONE',
          state: 'EXCESSIVE_EXTENSION',
          reasonCodes,
          retestTracking: null,
          isValidated: false,
          direction: 'SHORT',
          levelBroken: keySup,
          levelType: 'SUPPORT',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      } else {
        evidence.extension = 'PASS';
      }

      // Check if all breakdown criteria passed
      const breakdownPass =
        evidence.resistanceOrSupportValid === 'PASS' &&
        evidence.closeConfirmation === 'PASS' &&
        evidence.displacement === 'PASS' &&
        evidence.breakoutDistance === 'PASS' &&
        evidence.momentum === 'PASS' &&
        evidence.regimeAlignment === 'PASS' &&
        evidence.extension === 'PASS';

      if (breakdownPass) {
        // Initialize retest tracking for this breakdown
        const tracker: RetestTrackingState = {
          level: keySup,
          levelType: 'SUPPORT',
          direction: 'BEARISH',
          breakoutTimestamp: current.timestamp,
          breakoutIndex: candles.length - 1,
          breakoutPrice: current.close,
          status: 'PENDING',
        };

        evidence.retest = 'PENDING';
        evidence.retestReaction = 'PENDING';
        reasonCodes.push('BREAKDOWN_CONFIRMED');
        reasonCodes.push('RETEST_PENDING');

        return {
          evidence,
          trapState: 'NONE',
          state: 'BREAKDOWN_CONFIRMED',
          reasonCodes,
          retestTracking: tracker,
          isValidated: false, // Awaiting retest before live execution
          direction: 'SHORT',
          levelBroken: keySup,
          levelType: 'SUPPORT',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      } else {
        reasonCodes.push('BREAKDOWN_PENDING');
        return {
          evidence,
          trapState: 'NONE',
          state: 'BREAKDOWN_PENDING',
          reasonCodes,
          retestTracking: null,
          isValidated: false,
          direction: 'SHORT',
          levelBroken: keySup,
          levelType: 'SUPPORT',
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          riskRewardRatio: null,
        };
      }
    }

    // 6. NO SETUP ACTIVE
    reasonCodes.push('NO_SETUP');
    return {
      evidence,
      trapState: 'NONE',
      state: 'NO_SETUP',
      reasonCodes,
      retestTracking: null,
      isValidated: false,
      direction: 'FLAT',
      levelBroken: null,
      levelType: null,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
    };
  }

  /**
   * Deterministic Retest Evaluation
   * Evaluates the active candle against the monitored level and its reaction.
   */
  private evaluateRetestProgress(
    candles: Candle[],
    tracker: RetestTrackingState,
    atr: number,
    structure: MarketStructureState,
    regimeReport: MarketRegimeReport
  ): RetestTrackingState {
    const current = candles[candles.length - 1];
    const currentIndex = candles.length - 1;
    const barsSinceBreakout = currentIndex - tracker.breakoutIndex;
    const tolerance = this.config.retestToleranceAtr * atr;

    if (barsSinceBreakout > this.config.maxRetestBars) {
      return { ...tracker, status: 'EXPIRED' };
    }

    if (tracker.direction === 'BULLISH') {
      // Former resistance is now candidate support
      // Check if price revisited the zone
      const touchedZone =
        current.low <= tracker.level + tolerance && current.low >= tracker.level - tolerance;
      const blewThrough = current.close < tracker.level - tolerance;

      if (touchedZone || tracker.status === 'TOUCHED' || blewThrough) {
        // Price touched the retest level or plunged straight through it
        if (blewThrough || current.close < tracker.level) {
          // Level decisively lost back into prior range
          return {
            ...tracker,
            status: 'FAILED',
            touchCandleIndex: currentIndex,
            touchPrice: current.close,
            reactionHeld: false,
          };
        } else if (current.close >= tracker.level) {
          const lowerWick = Math.min(current.open, current.close) - current.low;
          const hasSupportReaction = lowerWick > 0.2 * (current.high - current.low) || current.close > current.open;
          if (hasSupportReaction) {
            return {
              ...tracker,
              status: 'CONFIRMED',
              touchCandleIndex: currentIndex,
              touchPrice: current.low,
              reactionHeld: true,
            };
          }
        }
      }
    } else {
      // BEARISH: Former support is now candidate resistance
      const touchedZone =
        current.high >= tracker.level - tolerance && current.high <= tracker.level + tolerance;
      const blewThrough = current.close > tracker.level + tolerance;

      if (touchedZone || tracker.status === 'TOUCHED' || blewThrough) {
        if (blewThrough || current.close > tracker.level) {
          // Level decisively lost back above
          return {
            ...tracker,
            status: 'FAILED',
            touchCandleIndex: currentIndex,
            touchPrice: current.close,
            reactionHeld: false,
          };
        } else if (current.close <= tracker.level) {
          const upperWick = current.high - Math.max(current.open, current.close);
          const hasResistanceReaction = upperWick > 0.2 * (current.high - current.low) || current.close < current.open;
          if (hasResistanceReaction) {
            return {
              ...tracker,
              status: 'CONFIRMED',
              touchCandleIndex: currentIndex,
              touchPrice: current.high,
              reactionHeld: true,
            };
          }
        }
      }
    }

    return tracker;
  }
}

export const breakoutValidationEngine = new BreakoutValidationEngine();
