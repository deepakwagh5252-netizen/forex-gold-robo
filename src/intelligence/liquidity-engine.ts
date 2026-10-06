import { Candle } from '../market-data/provider.interface';
import { 
  LiquidityLevel, 
  LiquiditySweep, 
  PreviousPeriodLevels, 
  SessionBoundary,
  LiquidityLevelSource
} from '../types/intelligence';

export interface EqualLevelConfig {
  pipTolerance: number; // for XAU/USD: e.g. 0.35 USD or 3.5 pips
  minBarsApart: number; // minimum bars between swing highs to be considered equal
}

/**
 * Liquidity Engine
 * Detects:
 * - Previous Day High / Low / Open / Close (PDH, PDL, PDO, PDC)
 * - Previous Week High / Low / Open / Close (PWH, PWL, PWO, PWC)
 * - Equal Highs (EQH) and Equal Lows (EQL)
 * - Session Highs & Lows (Asia, London, New York)
 * - Liquidity Sweeps
 */
export class LiquidityEngine {
  private eqConfig: EqualLevelConfig;

  constructor(eqConfig: EqualLevelConfig = { pipTolerance: 0.40, minBarsApart: 3 }) {
    this.eqConfig = eqConfig;
  }

  /**
   * Calculates Previous Day and Previous Week OHLC from candles
   */
  public calculatePeriodLevels(candles: Candle[]): PreviousPeriodLevels {
    if (!candles || candles.length === 0) {
      return {
        pdh: null,
        pdl: null,
        pdo: null,
        pdc: null,
        pwh: null,
        pwl: null,
        pwo: null,
        pwc: null,
        timestamp: null,
        datetime: null,
      };
    }

    // Group candles by UTC calendar day (YYYY-MM-DD)
    const dayGroups = new Map<string, Candle[]>();
    for (const c of candles) {
      const dateStr = new Date(c.timestamp).toISOString().split('T')[0];
      if (!dayGroups.has(dateStr)) {
        dayGroups.set(dateStr, []);
      }
      dayGroups.get(dateStr)!.push(c);
    }

    const sortedDays = Array.from(dayGroups.keys()).sort();
    let pdh: number | null = null;
    let pdl: number | null = null;
    let pdo: number | null = null;
    let pdc: number | null = null;

    if (sortedDays.length >= 2) {
      // Prior day is the second to last day in sorted list
      const prevDayStr = sortedDays[sortedDays.length - 2];
      const prevDayCandles = dayGroups.get(prevDayStr)!;
      pdo = prevDayCandles[0].open;
      pdc = prevDayCandles[prevDayCandles.length - 1].close;
      pdh = Math.max(...prevDayCandles.map(c => c.high));
      pdl = Math.min(...prevDayCandles.map(c => c.low));
    } else if (sortedDays.length === 1) {
      // If only 1 day is returned in output window, derive day OHLC up to previous bar
      const dayCandles = dayGroups.get(sortedDays[0])!;
      if (dayCandles.length >= 2) {
        pdo = dayCandles[0].open;
        pdc = dayCandles[dayCandles.length - 2].close;
        pdh = Math.max(...dayCandles.slice(0, -1).map(c => c.high));
        pdl = Math.min(...dayCandles.slice(0, -1).map(c => c.low));
      }
    }

    // Group candles by UTC calendar week (Year + Week Number)
    const weekGroups = new Map<string, Candle[]>();
    for (const c of candles) {
      const d = new Date(c.timestamp);
      // Week key: ISO year and week approximate
      const startOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d.getTime() - startOfYear.getTime()) / 86400000) + startOfYear.getUTCDay() + 1) / 7);
      const weekKey = `${d.getUTCFullYear()}-W${weekNo}`;
      if (!weekGroups.has(weekKey)) {
        weekGroups.set(weekKey, []);
      }
      weekGroups.get(weekKey)!.push(c);
    }

    const sortedWeeks = Array.from(weekGroups.keys()).sort();
    let pwh: number | null = null;
    let pwl: number | null = null;
    let pwo: number | null = null;
    let pwc: number | null = null;

    if (sortedWeeks.length >= 2) {
      const prevWeekCandles = weekGroups.get(sortedWeeks[sortedWeeks.length - 2])!;
      pwo = prevWeekCandles[0].open;
      pwc = prevWeekCandles[prevWeekCandles.length - 1].close;
      pwh = Math.max(...prevWeekCandles.map(c => c.high));
      pwl = Math.min(...prevWeekCandles.map(c => c.low));
    }

    const latestCandle = candles[candles.length - 1];
    return {
      pdh,
      pdl,
      pdo,
      pdc,
      pwh,
      pwl,
      pwo,
      pwc,
      timestamp: latestCandle.timestamp,
      datetime: (latestCandle as { datetime?: string }).datetime || new Date(latestCandle.timestamp).toISOString(),
    };
  }

  /**
   * Calculates UTC session ranges:
   * ASIA: 00:00 - 08:00 UTC
   * LONDON: 07:00 - 15:30 UTC
   * NEW YORK: 12:00 - 20:30 UTC
   */
  public calculateSessions(candles: Candle[]): SessionBoundary[] {
    const definitions: Array<{ name: 'ASIA' | 'LONDON' | 'NEW_YORK'; start: number; end: number }> = [
      { name: 'ASIA', start: 0, end: 8 },
      { name: 'LONDON', start: 7, end: 15.5 },
      { name: 'NEW_YORK', start: 12, end: 20.5 },
    ];

    const currentUtcTime = new Date();
    const currentUtcHourDecimal = currentUtcTime.getUTCHours() + currentUtcTime.getUTCMinutes() / 60;

    return definitions.map(def => {
      const isActive = currentUtcHourDecimal >= def.start && currentUtcHourDecimal < def.end;

      // Filter candles belonging to this session on the current/most recent day
      const sessionCandles = (candles || []).filter(c => {
        const d = new Date(c.timestamp);
        const hourDec = d.getUTCHours() + d.getUTCMinutes() / 60;
        return hourDec >= def.start && hourDec <= def.end;
      });

      if (sessionCandles.length === 0) {
        return {
          name: def.name,
          utcStartHour: def.start,
          utcEndHour: Math.floor(def.end),
          isActive,
          sessionHigh: null,
          sessionLow: null,
          sessionOpen: null,
          sessionClose: null,
          sessionRange: null,
        };
      }

      const high = Math.max(...sessionCandles.map(c => c.high));
      const low = Math.min(...sessionCandles.map(c => c.low));
      const open = sessionCandles[0].open;
      const close = sessionCandles[sessionCandles.length - 1].close;

      return {
        name: def.name,
        utcStartHour: def.start,
        utcEndHour: Math.floor(def.end),
        isActive,
        sessionHigh: parseFloat(high.toFixed(2)),
        sessionLow: parseFloat(low.toFixed(2)),
        sessionOpen: parseFloat(open.toFixed(2)),
        sessionClose: parseFloat(close.toFixed(2)),
        sessionRange: parseFloat((high - low).toFixed(2)),
      };
    });
  }

  /**
   * Detects Equal Highs and Equal Lows across candles
   */
  public detectEqualHighsLows(candles: Candle[]): LiquidityLevel[] {
    const levels: LiquidityLevel[] = [];
    if (!candles || candles.length < 10) {
      return levels;
    }

    const { pipTolerance, minBarsApart } = this.eqConfig;
    const latestPrice = candles[candles.length - 1].close;

    // Detect swing peaks for high comparisons
    for (let i = 2; i < candles.length - 2; i++) {
      const isPeak = candles[i].high > candles[i - 1].high &&
                     candles[i].high > candles[i - 2].high &&
                     candles[i].high > candles[i + 1].high &&
                     candles[i].high > candles[i + 2].high;

      if (isPeak) {
        // Compare with subsequent peaks
        for (let j = i + minBarsApart; j < candles.length - 1; j++) {
          const isSecondPeak = candles[j].high > candles[j - 1].high &&
                               candles[j].high > candles[j + 1].high;
          if (isSecondPeak && Math.abs(candles[i].high - candles[j].high) <= pipTolerance) {
            const level = parseFloat(((candles[i].high + candles[j].high) / 2).toFixed(2));
            levels.push({
              id: `eqh-${candles[j].timestamp}`,
              level,
              source: 'EQUAL_HIGHS',
              timestamp: candles[j].timestamp,
              datetime: (candles[j] as { datetime?: string }).datetime || new Date(candles[j].timestamp).toISOString(),
              distanceFromCurrentPrice: parseFloat((level - latestPrice).toFixed(2)),
              validationStatus: 'CONFIRMED',
              isSwept: candles.slice(j + 1).some(c => c.high > level),
            });
            break;
          }
        }
      }

      const isTrough = candles[i].low < candles[i - 1].low &&
                       candles[i].low < candles[i - 2].low &&
                       candles[i].low < candles[i + 1].low &&
                       candles[i].low < candles[i + 2].low;

      if (isTrough) {
        for (let j = i + minBarsApart; j < candles.length - 1; j++) {
          const isSecondTrough = candles[j].low < candles[j - 1].low &&
                                 candles[j].low < candles[j + 1].low;
          if (isSecondTrough && Math.abs(candles[i].low - candles[j].low) <= pipTolerance) {
            const level = parseFloat(((candles[i].low + candles[j].low) / 2).toFixed(2));
            levels.push({
              id: `eql-${candles[j].timestamp}`,
              level,
              source: 'EQUAL_LOWS',
              timestamp: candles[j].timestamp,
              datetime: (candles[j] as { datetime?: string }).datetime || new Date(candles[j].timestamp).toISOString(),
              distanceFromCurrentPrice: parseFloat((latestPrice - level).toFixed(2)),
              validationStatus: 'CONFIRMED',
              isSwept: candles.slice(j + 1).some(c => c.low < level),
            });
            break;
          }
        }
      }
    }

    return levels;
  }

  /**
   * Assembles complete Liquidity Map
   */
  public generateLiquidityMap(
    candles: Candle[], 
    periodLevels: PreviousPeriodLevels, 
    sessions: SessionBoundary[]
  ): LiquidityLevel[] {
    const list: LiquidityLevel[] = [];
    if (!candles || candles.length === 0) return list;

    const currentPrice = candles[candles.length - 1].close;

    const addLevel = (source: LiquidityLevelSource, price: number | null, timestamp: number | null, dt: string | null) => {
      if (price !== null && !isNaN(price) && price > 0) {
        list.push({
          id: `${source}-${price}`,
          level: parseFloat(price.toFixed(2)),
          source,
          timestamp,
          datetime: dt,
          distanceFromCurrentPrice: parseFloat((price - currentPrice).toFixed(2)),
          validationStatus: 'CONFIRMED',
          isSwept: false,
        });
      }
    };

    // 1. PDH / PDL
    addLevel('PREVIOUS_DAY_HIGH', periodLevels.pdh, periodLevels.timestamp, periodLevels.datetime);
    addLevel('PREVIOUS_DAY_LOW', periodLevels.pdl, periodLevels.timestamp, periodLevels.datetime);

    // 2. PWH / PWL
    addLevel('PREVIOUS_WEEK_HIGH', periodLevels.pwh, periodLevels.timestamp, periodLevels.datetime);
    addLevel('PREVIOUS_WEEK_LOW', periodLevels.pwl, periodLevels.timestamp, periodLevels.datetime);

    // 3. Session Highs & Lows
    sessions.forEach(s => {
      if (s.sessionHigh !== null) {
        addLevel('SESSION_HIGH', s.sessionHigh, null, `${s.name} High`);
      }
      if (s.sessionLow !== null) {
        addLevel('SESSION_LOW', s.sessionLow, null, `${s.name} Low`);
      }
    });

    // 4. Equal Highs & Equal Lows
    const eqLevels = this.detectEqualHighsLows(candles);
    list.push(...eqLevels);

    // Deduplicate by price within 0.15 tolerance
    const unique: LiquidityLevel[] = [];
    for (const lvl of list) {
      if (!unique.some(u => Math.abs(u.level - lvl.level) < 0.15 && u.source === lvl.source)) {
        unique.push(lvl);
      }
    }

    return unique.sort((a, b) => b.level - a.level);
  }

  /**
   * Deterministic Liquidity Sweep Detection
   * Rule:
   * 1. Price penetrates beyond a known liquidity level (candle high > level or candle low < level).
   * 2. The sweep candle or subsequent confirmation candle (within window of 2 bars) closes BACK INSIDE the level.
   * 3. This distinguishes true liquidity sweeps from genuine structural breakouts.
   */
  public detectSweeps(
    candles: Candle[], 
    levels: LiquidityLevel[], 
    timeframe: string = 'M15'
  ): LiquiditySweep[] {
    const sweeps: LiquiditySweep[] = [];
    if (!candles || candles.length < 4 || !levels || levels.length === 0) {
      return sweeps;
    }

    for (const lvl of levels) {
      const isHighSide = lvl.source.includes('HIGH');
      const isLowSide = lvl.source.includes('LOW');

      for (let i = 2; i < candles.length; i++) {
        const sweepCandle = candles[i];
        const datetime = (sweepCandle as { datetime?: string }).datetime || new Date(sweepCandle.timestamp).toISOString();

        if (isHighSide) {
          // Breached above level
          if (sweepCandle.high > lvl.level) {
            // Case A: Breached and closed back below in the same candle
            if (sweepCandle.close < lvl.level) {
              sweeps.push({
                levelSwept: lvl.level,
                source: lvl.source,
                sweepCandleTimestamp: sweepCandle.timestamp,
                sweepHighOrLow: sweepCandle.high,
                sweepClose: sweepCandle.close,
                confirmationCandleTimestamp: sweepCandle.timestamp,
                timestamp: sweepCandle.timestamp,
                datetime,
                direction: 'BEARISH_SWEEP_OF_HIGHS',
                timeframe,
              });
              break;
            } 
            // Case B: Breached, and immediate next candle closed back below
            else if (i + 1 < candles.length && candles[i + 1].close < lvl.level) {
              sweeps.push({
                levelSwept: lvl.level,
                source: lvl.source,
                sweepCandleTimestamp: sweepCandle.timestamp,
                sweepHighOrLow: sweepCandle.high,
                sweepClose: sweepCandle.close,
                confirmationCandleTimestamp: candles[i + 1].timestamp,
                timestamp: candles[i + 1].timestamp,
                datetime: (candles[i + 1] as { datetime?: string }).datetime || new Date(candles[i + 1].timestamp).toISOString(),
                direction: 'BEARISH_SWEEP_OF_HIGHS',
                timeframe,
              });
              break;
            }
          }
        }

        if (isLowSide) {
          // Breached below level
          if (sweepCandle.low < lvl.level) {
            // Closed back above in the same candle
            if (sweepCandle.close > lvl.level) {
              sweeps.push({
                levelSwept: lvl.level,
                source: lvl.source,
                sweepCandleTimestamp: sweepCandle.timestamp,
                sweepHighOrLow: sweepCandle.low,
                sweepClose: sweepCandle.close,
                confirmationCandleTimestamp: sweepCandle.timestamp,
                timestamp: sweepCandle.timestamp,
                datetime,
                direction: 'BULLISH_SWEEP_OF_LOWS',
                timeframe,
              });
              break;
            }
            // Closed back above on the next candle
            else if (i + 1 < candles.length && candles[i + 1].close > lvl.level) {
              sweeps.push({
                levelSwept: lvl.level,
                source: lvl.source,
                sweepCandleTimestamp: sweepCandle.timestamp,
                sweepHighOrLow: sweepCandle.low,
                sweepClose: sweepCandle.close,
                confirmationCandleTimestamp: candles[i + 1].timestamp,
                timestamp: candles[i + 1].timestamp,
                datetime: (candles[i + 1] as { datetime?: string }).datetime || new Date(candles[i + 1].timestamp).toISOString(),
                direction: 'BULLISH_SWEEP_OF_LOWS',
                timeframe,
              });
              break;
            }
          }
        }
      }
    }

    return sweeps.sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const liquidityEngine = new LiquidityEngine();
