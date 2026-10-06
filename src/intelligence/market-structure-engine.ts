import { Candle } from '../market-data/provider.interface';
import { 
  MarketStructureState, 
  SwingPoint, 
  TrendState, 
  RangeState, 
  StructurePointType, 
  StructureEvent,
  StructureEventType
} from '../types/intelligence';

export interface SwingDetectionConfig {
  leftBars: number;   // default: 2 (2 bars before)
  rightBars: number;  // default: 2 (2 bars after)
}

/**
 * Deterministic Market Structure Engine
 * Rules:
 * - Minimum candles required for valid structural deduction
 * - Swing High: Candle high > high of leftBars before and rightBars after
 * - Swing Low: Candle low < low of leftBars before and rightBars after
 * - Structural points:
 *    - HH (Higher High): Swing High price > previous Swing High price
 *    - LH (Lower High): Swing High price < previous Swing High price
 *    - HL (Higher Low): Swing Low price > previous Swing Low price
 *    - LL (Lower Low): Swing Low price < previous Swing Low price
 * - Trend state determination (requires confirmed swings):
 *    - BULLISH: Latest swing points exhibit HH and HL structure
 *    - BEARISH: Latest swing points exhibit LH and LL structure
 *    - RANGING: Mixed or overlapping swing points without consecutive alignment
 *    - UNDEFINED: Fewer than 3 confirmed swing points
 * - BOS (Break of Structure):
 *    - Bullish BOS: Price closes above the most recent confirmed Swing High in a Bullish trend
 *    - Bearish BOS: Price closes below the most recent confirmed Swing Low in a Bearish trend
 * - CHOCH (Change of Character):
 *    - Bearish CHOCH: Price closes below the last confirmed Higher Low during a Bullish trend
 *    - Bullish CHOCH: Price closes above the last confirmed Lower High during a Bearish trend
 */
export class MarketStructureEngine {
  private config: SwingDetectionConfig;

  constructor(config: SwingDetectionConfig = { leftBars: 2, rightBars: 2 }) {
    this.config = config;
  }

  public detectSwings(candles: Candle[]): SwingPoint[] {
    if (!candles || candles.length < this.config.leftBars + this.config.rightBars + 1) {
      return [];
    }

    const swings: SwingPoint[] = [];
    const { leftBars, rightBars } = this.config;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      // Check left bars
      for (let j = i - leftBars; j < i; j++) {
        if (candles[j].high >= current.high) isHigh = false;
        if (candles[j].low <= current.low) isLow = false;
      }

      // Check right bars
      for (let j = i + 1; j <= i + rightBars; j++) {
        if (candles[j].high >= current.high) isHigh = false;
        if (candles[j].low <= current.low) isLow = false;
      }

      const datetime = (current as { datetime?: string }).datetime || new Date(current.timestamp).toISOString();

      if (isHigh) {
        swings.push({
          index: i,
          type: 'SWING_HIGH',
          price: current.high,
          timestamp: current.timestamp,
          datetime,
          isConfirmed: true,
        });
      }

      if (isLow) {
        swings.push({
          index: i,
          type: 'SWING_LOW',
          price: current.low,
          timestamp: current.timestamp,
          datetime,
          isConfirmed: true,
        });
      }
    }

    // Sort chronologically by candle index / timestamp
    return swings.sort((a, b) => a.index - b.index);
  }

  public analyzeStructure(candles: Candle[], timeframe: string = 'M15'): MarketStructureState {
    if (!candles || candles.length < 10) {
      return {
        trendState: 'UNDEFINED',
        rangeState: 'UNDEFINED',
        swingHighs: [],
        swingLows: [],
        lastSwingHigh: null,
        lastSwingLow: null,
        higherHighsCount: 0,
        higherLowsCount: 0,
        lowerHighsCount: 0,
        lowerLowsCount: 0,
        lastStructurePoint: null,
        lastEvent: null,
      };
    }

    const allSwings = this.detectSwings(candles);
    const swingHighs = allSwings.filter(s => s.type === 'SWING_HIGH');
    const swingLows = allSwings.filter(s => s.type === 'SWING_LOW');

    // Label HH, LH, HL, LL
    let higherHighsCount = 0;
    let lowerHighsCount = 0;
    for (let i = 0; i < swingHighs.length; i++) {
      if (i > 0) {
        if (swingHighs[i].price > swingHighs[i - 1].price) {
          swingHighs[i].structureType = 'HH';
          higherHighsCount++;
        } else if (swingHighs[i].price < swingHighs[i - 1].price) {
          swingHighs[i].structureType = 'LH';
          lowerHighsCount++;
        }
      }
    }

    let higherLowsCount = 0;
    let lowerLowsCount = 0;
    for (let i = 0; i < swingLows.length; i++) {
      if (i > 0) {
        if (swingLows[i].price > swingLows[i - 1].price) {
          swingLows[i].structureType = 'HL';
          higherLowsCount++;
        } else if (swingLows[i].price < swingLows[i - 1].price) {
          swingLows[i].structureType = 'LL';
          lowerLowsCount++;
        }
      }
    }

    // Determine Trend State deterministically
    let trendState: TrendState = 'UNDEFINED';
    let rangeState: RangeState = 'UNDEFINED';

    const recentHighs = swingHighs.slice(-2);
    const recentLows = swingLows.slice(-2);

    if (recentHighs.length >= 2 && recentLows.length >= 2) {
      const isHigherHigh = recentHighs[1].price > recentHighs[0].price;
      const isHigherLow = recentLows[1].price > recentLows[0].price;
      const isLowerHigh = recentHighs[1].price < recentHighs[0].price;
      const isLowerLow = recentLows[1].price < recentLows[0].price;

      if (isHigherHigh && isHigherLow) {
        trendState = 'BULLISH';
        rangeState = 'TRENDING';
      } else if (isLowerHigh && isLowerLow) {
        trendState = 'BEARISH';
        rangeState = 'TRENDING';
      } else if (isHigherHigh && isLowerLow) {
        trendState = 'RANGING';
        rangeState = 'EXPANDING';
      } else if (isLowerHigh && isHigherLow) {
        trendState = 'RANGING';
        rangeState = 'COMPRESSING';
      } else {
        trendState = 'RANGING';
        rangeState = 'CONSOLIDATING';
      }
    } else if (swingHighs.length >= 1 && swingLows.length >= 1) {
      // With limited swings, infer preliminary direction if clear
      const lastHigh = swingHighs[swingHighs.length - 1];
      const lastLow = swingLows[swingLows.length - 1];
      const lastCandle = candles[candles.length - 1];
      if (lastCandle.close > lastHigh.price) {
        trendState = 'BULLISH';
      } else if (lastCandle.close < lastLow.price) {
        trendState = 'BEARISH';
      } else {
        trendState = 'RANGING';
      }
      rangeState = 'CONSOLIDATING';
    }

    // Determine latest structure point
    const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : null;
    const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : null;

    let lastStructurePoint: StructurePointType | null = null;
    if (allSwings.length > 0) {
      const lastSwing = allSwings[allSwings.length - 1];
      lastStructurePoint = lastSwing.structureType || null;
    }

    // Detect BOS / CHOCH events across the sequence
    const events = this.detectStructureEvents(candles, swingHighs, swingLows, timeframe);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;

    return {
      trendState,
      rangeState,
      swingHighs,
      swingLows,
      lastSwingHigh,
      lastSwingLow,
      higherHighsCount,
      higherLowsCount,
      lowerHighsCount,
      lowerLowsCount,
      lastStructurePoint,
      lastEvent,
    };
  }

  public detectStructureEvents(
    candles: Candle[], 
    swingHighs: SwingPoint[], 
    swingLows: SwingPoint[],
    timeframe: string = 'M15'
  ): StructureEvent[] {
    const events: StructureEvent[] = [];
    if (!candles || candles.length < 5 || (swingHighs.length === 0 && swingLows.length === 0)) {
      return events;
    }

    // Iterate through confirmed swings and inspect subsequent candle closes
    // Bullish BOS: Price closes above previous confirmed swing high
    for (let h = 0; h < swingHighs.length; h++) {
      const sh = swingHighs[h];
      for (let c = sh.index + 1; c < candles.length; c++) {
        const candle = candles[c];
        if (candle.close > sh.price) {
          const datetime = (candle as { datetime?: string }).datetime || new Date(candle.timestamp).toISOString();
          // Check if this is a continuation (BOS) or reversal (CHOCH)
          const isChoch = sh.structureType === 'LH';
          events.push({
            type: isChoch ? 'CHOCH' : 'BOS',
            direction: 'BULLISH',
            brokenLevel: sh.price,
            breakCandleTimestamp: candle.timestamp,
            datetime,
            timeframe,
          });
          break; // Record first break of this swing point
        }
      }
    }

    // Bearish BOS / CHOCH: Price closes below previous confirmed swing low
    for (let l = 0; l < swingLows.length; l++) {
      const sl = swingLows[l];
      for (let c = sl.index + 1; c < candles.length; c++) {
        const candle = candles[c];
        if (candle.close < sl.price) {
          const datetime = (candle as { datetime?: string }).datetime || new Date(candle.timestamp).toISOString();
          const isChoch = sl.structureType === 'HL';
          events.push({
            type: isChoch ? 'CHOCH' : 'BOS',
            direction: 'BEARISH',
            brokenLevel: sl.price,
            breakCandleTimestamp: candle.timestamp,
            datetime,
            timeframe,
          });
          break; // Record first break of this swing point
        }
      }
    }

    // Sort chronologically by break candle timestamp
    return events.sort((a, b) => a.breakCandleTimestamp - b.breakCandleTimestamp);
  }
}

export const marketStructureEngine = new MarketStructureEngine();
