import { Candle } from '../market-data/provider.interface';
import { FairValueGap, DisplacementCandle } from '../types/intelligence';

export interface DisplacementConfig {
  bodyToRangeMinRatio: number; // default: 0.65 (body is >= 65% of total high-low range)
  rangeToAtrMinRatio: number;  // default: 1.35 (candle range is >= 1.35x ATR)
}

export interface FVGConfig {
  minGapPips: number; // minimum gap in USD for XAU/USD (default: 0.25 USD)
}

/**
 * Deterministic Fair Value Gap (FVG) and Displacement Engine
 * 
 * Rules:
 * 1. Three-Candle FVG Rule:
 *    - Bullish FVG:
 *        Candle 1: Preceding bar
 *        Candle 2: Large expansion bar
 *        Candle 3: Following bar
 *        Condition: Candle 3 Low > Candle 1 High
 *        Upper Boundary = Candle 3 Low
 *        Lower Boundary = Candle 1 High
 *    - Bearish FVG:
 *        Condition: Candle 3 High < Candle 1 Low
 *        Upper Boundary = Candle 1 Low
 *        Lower Boundary = Candle 3 High
 * 
 * 2. FVG Fill Tracking:
 *    - Any subsequent candle that penetrates the gap recalculates `fillPercentage`.
 *    - If subsequent price completely traverses the gap, `isFilled = true`.
 * 
 * 3. Displacement:
 *    - Body size = abs(Close - Open)
 *    - Candle range = High - Low
 *    - Condition: body / range >= 0.65 AND range >= 1.35 * ATR
 */
export class FvgDisplacementEngine {
  private dispConfig: DisplacementConfig;
  private fvgConfig: FVGConfig;

  constructor(
    dispConfig: DisplacementConfig = { bodyToRangeMinRatio: 0.65, rangeToAtrMinRatio: 1.35 },
    fvgConfig: FVGConfig = { minGapPips: 0.25 }
  ) {
    this.dispConfig = dispConfig;
    this.fvgConfig = fvgConfig;
  }

  /**
   * Detects all 3-candle Fair Value Gaps
   */
  public detectFVGs(candles: Candle[], timeframe: string = 'M15'): FairValueGap[] {
    const fvgs: FairValueGap[] = [];
    if (!candles || candles.length < 3) {
      return fvgs;
    }

    const { minGapPips } = this.fvgConfig;

    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      // Bullish FVG: Candle 3 Low > Candle 1 High
      if (c3.low > c1.high) {
        const gapSize = c3.low - c1.high;
        if (gapSize >= minGapPips) {
          const upperBoundary = c3.low;
          const lowerBoundary = c1.high;

          // Check subsequent candles to evaluate fill state
          let maxPenetration = 0;
          for (let j = i + 1; j < candles.length; j++) {
            const subCandle = candles[j];
            if (subCandle.low < upperBoundary) {
              const penetration = upperBoundary - Math.max(subCandle.low, lowerBoundary);
              if (penetration > maxPenetration) {
                maxPenetration = penetration;
              }
            }
          }

          const fillPercentage = Math.min(100, Math.round((maxPenetration / gapSize) * 100));
          const isFilled = fillPercentage >= 100;
          const datetime = (c2 as { datetime?: string }).datetime || new Date(c2.timestamp).toISOString();

          fvgs.push({
            id: `fvg-bull-${c2.timestamp}`,
            direction: 'BULLISH',
            upperBoundary: parseFloat(upperBoundary.toFixed(2)),
            lowerBoundary: parseFloat(lowerBoundary.toFixed(2)),
            gapSize: parseFloat(gapSize.toFixed(2)),
            formationTimestamp: c2.timestamp,
            datetime,
            timeframe,
            isFilled,
            fillPercentage,
            candles: [c1, c2, c3],
          });
        }
      }

      // Bearish FVG: Candle 3 High < Candle 1 Low
      if (c3.high < c1.low) {
        const gapSize = c1.low - c3.high;
        if (gapSize >= minGapPips) {
          const upperBoundary = c1.low;
          const lowerBoundary = c3.high;

          let maxPenetration = 0;
          for (let j = i + 1; j < candles.length; j++) {
            const subCandle = candles[j];
            if (subCandle.high > lowerBoundary) {
              const penetration = Math.min(subCandle.high, upperBoundary) - lowerBoundary;
              if (penetration > maxPenetration) {
                maxPenetration = penetration;
              }
            }
          }

          const fillPercentage = Math.min(100, Math.round((maxPenetration / gapSize) * 100));
          const isFilled = fillPercentage >= 100;
          const datetime = (c2 as { datetime?: string }).datetime || new Date(c2.timestamp).toISOString();

          fvgs.push({
            id: `fvg-bear-${c2.timestamp}`,
            direction: 'BEARISH',
            upperBoundary: parseFloat(upperBoundary.toFixed(2)),
            lowerBoundary: parseFloat(lowerBoundary.toFixed(2)),
            gapSize: parseFloat(gapSize.toFixed(2)),
            formationTimestamp: c2.timestamp,
            datetime,
            timeframe,
            isFilled,
            fillPercentage,
            candles: [c1, c2, c3],
          });
        }
      }
    }

    return fvgs.sort((a, b) => b.formationTimestamp - a.formationTimestamp);
  }

  /**
   * Detects displacement candles based on ATR and body-to-range ratios
   */
  public detectDisplacement(candles: Candle[], atr: number | null): DisplacementCandle[] {
    const list: DisplacementCandle[] = [];
    if (!candles || candles.length === 0 || !atr || atr <= 0) {
      return list;
    }

    const { bodyToRangeMinRatio, rangeToAtrMinRatio } = this.dispConfig;

    for (const c of candles) {
      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      const bodyRatio = range > 0 ? body / range : 0;
      const atrRatio = range / atr;

      const isDisplaced = bodyRatio >= bodyToRangeMinRatio && atrRatio >= rangeToAtrMinRatio;
      if (isDisplaced) {
        const datetime = (c as { datetime?: string }).datetime || new Date(c.timestamp).toISOString();
        list.push({
          timestamp: c.timestamp,
          datetime,
          direction: c.close >= c.open ? 'BULLISH' : 'BEARISH',
          candleRange: parseFloat(range.toFixed(2)),
          bodySize: parseFloat(body.toFixed(2)),
          bodyToRangeRatio: parseFloat(bodyRatio.toFixed(2)),
          atrRatio: parseFloat(atrRatio.toFixed(2)),
          isDisplaced: true,
        });
      }
    }

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const fvgDisplacementEngine = new FvgDisplacementEngine();
