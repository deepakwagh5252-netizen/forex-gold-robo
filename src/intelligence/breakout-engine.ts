import { Candle } from '../market-data/provider.interface';
import { MarketStructureState, StructureEvent } from '../types/intelligence';
import { BreakoutEvaluation, BreakoutType } from '../types/signal-regime';

export interface BreakoutEngineConfig {
  minDisplacementRatio: number; // default 0.60 (60% body)
  retestTolerancePips: number; // default 1.0 ($1.00 on gold)
  maxRetestBars: number; // default 6 bars
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutEngineConfig = {
  minDisplacementRatio: 0.60,
  retestTolerancePips: 1.0,
  maxRetestBars: 6,
};

/**
 * Phase 7A: Deterministic Breakout & Breakdown Engine
 * 
 * Classifies structural breakout events into:
 * 1. VALID_BREAKOUT: Bullish breakout above resistance with strong displacement and retest hold.
 * 2. FAKE_BREAKOUT_BULL_TRAP: Wicks or closes momentarily above resistance, but immediately closes back inside the range.
 * 3. VALID_BREAKDOWN: Bearish breakdown below support with strong displacement and retest rejection.
 * 4. FAKE_BREAKDOWN_BEAR_TRAP: Wicks or closes momentarily below support, but immediately reverses back inside the range.
 * 5. NONE: No structural level challenged.
 */
export class BreakoutEngine {
  private config: BreakoutEngineConfig;

  constructor(config: Partial<BreakoutEngineConfig> = {}) {
    this.config = { ...DEFAULT_BREAKOUT_CONFIG, ...config };
  }

  /**
   * Evaluates the latest candle(s) against confirmed structure and support/resistance levels.
   */
  public evaluateBreakouts(
    candles: Candle[],
    structure: MarketStructureState,
    keyResistance: number | null,
    keySupport: number | null
  ): BreakoutEvaluation {
    if (!candles || candles.length < 5 || (!keyResistance && !keySupport)) {
      return {
        type: 'NONE',
        levelBroken: 0,
        breakoutCandleTimestamp: 0,
        displacementRatio: 0,
        isConfirmed: false,
        isFakeoutTrap: false,
        retestObserved: false,
        retestHolds: false,
        notes: 'Insufficient candles or key levels undefined',
      };
    }

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const cRange = current.high - current.low;
    const bodySize = Math.abs(current.close - current.open);
    const displacementRatio = cRange > 0 ? bodySize / cRange : 0;

    // 1. Check Bullish Breakout / Fakeout against Resistance
    if (keyResistance !== null && (current.high > keyResistance || prev.high > keyResistance)) {
      const brokeAbove = current.close > keyResistance;
      const sweptAboveThenReturned = current.high > keyResistance && current.close < keyResistance;
      const prevBrokeNowFailed = prev.close > keyResistance && current.close < keyResistance;

      if (sweptAboveThenReturned || prevBrokeNowFailed) {
        return {
          type: 'FAKE_BREAKOUT_BULL_TRAP',
          levelBroken: keyResistance,
          breakoutCandleTimestamp: current.timestamp,
          displacementRatio: Number(displacementRatio.toFixed(2)),
          isConfirmed: false,
          isFakeoutTrap: true,
          retestObserved: true,
          retestHolds: false,
          notes: `Price pushed above resistance $${keyResistance.toFixed(2)} but closed back inside. Bull trap confirmed.`,
        };
      }

      if (brokeAbove && displacementRatio >= this.config.minDisplacementRatio) {
        // Valid breakout candidate: check if subsequent retest holds
        const retestCandle = this.findRetest(candles, keyResistance, 'BULLISH');
        return {
          type: 'VALID_BREAKOUT',
          levelBroken: keyResistance,
          breakoutCandleTimestamp: current.timestamp,
          displacementRatio: Number(displacementRatio.toFixed(2)),
          isConfirmed: retestCandle ? retestCandle.holds : true, // confirmed on close or retest
          isFakeoutTrap: false,
          retestObserved: !!retestCandle,
          retestHolds: retestCandle ? retestCandle.holds : true,
          notes: `Valid breakout above resistance $${keyResistance.toFixed(2)} with ${(displacementRatio * 100).toFixed(0)}% body displacement.`,
        };
      }
    }

    // 2. Check Bearish Breakdown / Fakeout against Support
    if (keySupport !== null && (current.low < keySupport || prev.low < keySupport)) {
      const brokeBelow = current.close < keySupport;
      const sweptBelowThenReturned = current.low < keySupport && current.close > keySupport;
      const prevBrokeNowFailed = prev.close < keySupport && current.close > keySupport;

      if (sweptBelowThenReturned || prevBrokeNowFailed) {
        return {
          type: 'FAKE_BREAKDOWN_BEAR_TRAP',
          levelBroken: keySupport,
          breakoutCandleTimestamp: current.timestamp,
          displacementRatio: Number(displacementRatio.toFixed(2)),
          isConfirmed: false,
          isFakeoutTrap: true,
          retestObserved: true,
          retestHolds: false,
          notes: `Price pierced below support $${keySupport.toFixed(2)} but closed back above. Bear trap confirmed.`,
        };
      }

      if (brokeBelow && displacementRatio >= this.config.minDisplacementRatio) {
        const retestCandle = this.findRetest(candles, keySupport, 'BEARISH');
        return {
          type: 'VALID_BREAKDOWN',
          levelBroken: keySupport,
          breakoutCandleTimestamp: current.timestamp,
          displacementRatio: Number(displacementRatio.toFixed(2)),
          isConfirmed: retestCandle ? retestCandle.holds : true,
          isFakeoutTrap: false,
          retestObserved: !!retestCandle,
          retestHolds: retestCandle ? retestCandle.holds : true,
          notes: `Valid breakdown below support $${keySupport.toFixed(2)} with ${(displacementRatio * 100).toFixed(0)}% body displacement.`,
        };
      }
    }

    return {
      type: 'NONE',
      levelBroken: 0,
      breakoutCandleTimestamp: current.timestamp,
      displacementRatio: Number(displacementRatio.toFixed(2)),
      isConfirmed: false,
      isFakeoutTrap: false,
      retestObserved: false,
      retestHolds: false,
      notes: 'No structural breakout or breakdown currently active.',
    };
  }

  private findRetest(
    candles: Candle[],
    level: number,
    direction: 'BULLISH' | 'BEARISH'
  ): { holds: boolean; price: number } | null {
    if (candles.length < 3) return null;
    const recent = candles.slice(-this.config.maxRetestBars);
    for (let i = 1; i < recent.length; i++) {
      const bar = recent[i];
      if (direction === 'BULLISH') {
        const touched = bar.low <= level + this.config.retestTolerancePips && bar.low >= level - this.config.retestTolerancePips;
        if (touched) {
          return { holds: bar.close >= level, price: bar.low };
        }
      } else {
        const touched = bar.high >= level - this.config.retestTolerancePips && bar.high <= level + this.config.retestTolerancePips;
        if (touched) {
          return { holds: bar.close <= level, price: bar.high };
        }
      }
    }
    return null;
  }
}

export const breakoutEngine = new BreakoutEngine();
