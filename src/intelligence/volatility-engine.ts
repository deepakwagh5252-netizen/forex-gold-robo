import { Candle } from '../market-data/provider.interface';
import { ATRVolatility, VolatilityClassification } from '../types/intelligence';

export interface VolatilityConfig {
  period: number; // default 14
  lowMaxRatio: number;     // ratio of current candle range to ATR < 0.6 => LOW
  normalMaxRatio: number;  // 0.6 <= ratio <= 1.4 => NORMAL
  highMaxRatio: number;    // 1.4 < ratio <= 2.2 => HIGH, > 2.2 => EXTREME
}

/**
 * Standard Deterministic ATR & Volatility Calculator
 * 
 * True Range (TR) for candle i:
 *   TR = max(
 *     High[i] - Low[i],
 *     abs(High[i] - Close[i-1]),
 *     abs(Low[i] - Close[i-1])
 *   )
 * 
 * Standard Wilder's / Simple RMA ATR over period N (default 14):
 *   Initial ATR = SMA(TR, N)
 *   ATR[i] = (ATR[i-1] * (N - 1) + TR[i]) / N
 * 
 * Volatility Classification:
 *   Evaluates the ratio of the current candle's range to the calculated ATR:
 *   - LOW: ratio < 0.6
 *   - NORMAL: 0.6 <= ratio <= 1.4
 *   - HIGH: 1.4 < ratio <= 2.2
 *   - EXTREME: ratio > 2.2
 */
export class VolatilityEngine {
  private config: VolatilityConfig;

  constructor(config: VolatilityConfig = {
    period: 14,
    lowMaxRatio: 0.6,
    normalMaxRatio: 1.4,
    highMaxRatio: 2.2,
  }) {
    this.config = config;
  }

  public calculateATR(candles: Candle[]): ATRVolatility {
    const { period, lowMaxRatio, normalMaxRatio, highMaxRatio } = this.config;

    if (!candles || candles.length < period + 1) {
      return {
        atr: null,
        period,
        classification: 'UNDEFINED',
        currentCandleRange: null,
        averageRangeRatio: null,
        thresholds: { lowMaxRatio, normalMaxRatio, highMaxRatio },
      };
    }

    // 1. Calculate True Ranges
    const trValues: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];

      const hl = current.high - current.low;
      const hc = Math.abs(current.high - prev.close);
      const lc = Math.abs(current.low - prev.close);

      trValues.push(Math.max(hl, hc, lc));
    }

    if (trValues.length < period) {
      return {
        atr: null,
        period,
        classification: 'UNDEFINED',
        currentCandleRange: null,
        averageRangeRatio: null,
        thresholds: { lowMaxRatio, normalMaxRatio, highMaxRatio },
      };
    }

    // 2. Initial SMA of first `period` TRs
    let atr = trValues.slice(0, period).reduce((acc, v) => acc + v, 0) / period;

    // 3. Smoothed ATR for subsequent values
    for (let i = period; i < trValues.length; i++) {
      atr = (atr * (period - 1) + trValues[i]) / period;
    }

    // 4. Current candle range and ratio
    const latestCandle = candles[candles.length - 1];
    const currentRange = latestCandle.high - latestCandle.low;
    const ratio = atr > 0 ? currentRange / atr : 1.0;

    // 5. Deterministic classification
    let classification: VolatilityClassification = 'NORMAL';
    if (ratio < lowMaxRatio) {
      classification = 'LOW';
    } else if (ratio <= normalMaxRatio) {
      classification = 'NORMAL';
    } else if (ratio <= highMaxRatio) {
      classification = 'HIGH';
    } else {
      classification = 'EXTREME';
    }

    return {
      atr: parseFloat(atr.toFixed(4)),
      period,
      classification,
      currentCandleRange: parseFloat(currentRange.toFixed(4)),
      averageRangeRatio: parseFloat(ratio.toFixed(2)),
      thresholds: { lowMaxRatio, normalMaxRatio, highMaxRatio },
    };
  }
}

export const volatilityEngine = new VolatilityEngine();
