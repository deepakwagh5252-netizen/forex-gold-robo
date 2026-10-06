import { Candle } from '../market-data/provider.interface';

export interface CandleValidationResult {
  isValid: boolean;
  candle: Candle | null;
  rejectionReason: string | null;
}

export interface RawTwelveDataCandle {
  datetime: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume?: string | number;
}

/**
 * Supported timeframe mapping from UI identifiers to Twelve Data API interval strings.
 */
export const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1D': '1day',
  'M1': '1min',
  'M5': '5min',
  'M15': '15min',
  'M30': '30min',
  'H1': '1h',
  'H4': '4h',
  'D1': '1day',
  '1min': '1min',
  '5min': '5min',
  '15min': '15min',
  '30min': '30min',
  '1day': '1day',
};

export const TIMEFRAME_MINUTES_MAP: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1D': 1440,
  '1d': 1440,
  'M1': 1,
  'M5': 5,
  'M15': 15,
  'M30': 30,
  'H1': 60,
  'H4': 240,
  'D1': 1440,
  '1min': 1,
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '1day': 1440,
};

export const SUPPORTED_CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
export type SupportedChartTimeframe = typeof SUPPORTED_CHART_TIMEFRAMES[number];

export const SUPPORTED_TIMEZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York (EDT/EST)' },
  { id: 'Europe/London', label: 'London (BST/GMT)' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { id: 'LOCAL', label: 'Local System Time' },
] as const;

export type SupportedTimezone = typeof SUPPORTED_TIMEZONES[number]['id'];

export const M15_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Deterministically aligns any timestamp to its UTC M15 start boundary (:00, :15, :30, :45).
 */
export function getUtcM15Start(timestamp: number): number {
  return Math.floor(timestamp / M15_INTERVAL_MS) * M15_INTERVAL_MS;
}

/**
 * Deterministically calculates the close time of an M15 candle in UTC.
 */
export function getUtcM15Close(candleStartTs: number): number {
  return candleStartTs + M15_INTERVAL_MS;
}

/**
 * Checks if a timestamp aligns exactly to a UTC M15 boundary.
 */
export function isUtcM15Aligned(timestamp: number): boolean {
  return typeof timestamp === 'number' && timestamp > 0 && timestamp % M15_INTERVAL_MS === 0;
}

/**
 * Deterministically parses Twelve Data datetime string or timestamp to UTC millisecond timestamp.
 * Twelve Data default is UTC. Datetime strings like "2026-09-19 14:30:00" without timezone
 * must be explicitly treated as UTC to prevent browser/server local timezone drift.
 * Normalizes to UTC exactly once.
 */
export function parseTwelveDataTimestamp(datetimeInput: string | number): number {
  if (typeof datetimeInput === 'number') {
    return isNaN(datetimeInput) || datetimeInput <= 0 ? 0 : datetimeInput;
  }
  if (!datetimeInput || typeof datetimeInput !== 'string') return 0;
  const trimmed = datetimeInput.trim();

  // If string already specifies UTC Z
  if (trimmed.endsWith('Z')) {
    const t = new Date(trimmed).getTime();
    return isNaN(t) ? 0 : t;
  }

  // If string has explicit numeric offset like +00:00 or -05:00 after the date portion (index > 10)
  const hasExplicitOffset = trimmed.includes('+') || (trimmed.lastIndexOf('-') > 10 && trimmed.includes(':'));
  if (hasExplicitOffset) {
    const t = new Date(trimmed).getTime();
    return isNaN(t) ? 0 : t;
  }

  // Format "YYYY-MM-DD HH:mm:ss" -> append Z for strict UTC
  if (trimmed.length === 19 && trimmed[10] === ' ') {
    const iso = trimmed.replace(' ', 'T') + 'Z';
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  // Format "YYYY-MM-DDTHH:mm:ss" -> append Z for strict UTC
  if (trimmed.length === 19 && trimmed[10] === 'T') {
    const iso = trimmed + 'Z';
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  // Format "YYYY-MM-DD" -> append T00:00:00Z for daily bar
  if (trimmed.length === 10) {
    const iso = trimmed + 'T00:00:00Z';
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  // General fallback: replace space with T and ensure trailing Z for UTC
  const isoFallback = trimmed.replace(' ', 'T');
  const normalized = isoFallback.endsWith('Z') ? isoFallback : isoFallback + 'Z';
  const t = new Date(normalized).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Validates individual candle integrity per Step 3:
 * - high >= max(open, close)
 * - low <= min(open, close)
 * - open, high, low, close > 0
 * - valid deterministic timestamp
 */
export function validateCandle(raw: RawTwelveDataCandle): CandleValidationResult {
  if (!raw) {
    return { isValid: false, candle: null, rejectionReason: 'NULL_OR_UNDEFINED_CANDLE' };
  }

  const open = typeof raw.open === 'number' ? raw.open : parseFloat(String(raw.open));
  const high = typeof raw.high === 'number' ? raw.high : parseFloat(String(raw.high));
  const low = typeof raw.low === 'number' ? raw.low : parseFloat(String(raw.low));
  const close = typeof raw.close === 'number' ? raw.close : parseFloat(String(raw.close));
  const volume = raw.volume !== undefined ? (typeof raw.volume === 'number' ? raw.volume : parseFloat(String(raw.volume))) : 0;

  if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return { isValid: false, candle: null, rejectionReason: 'NON_POSITIVE_OR_NAN_OHLC' };
  }

  // STEP 3: high >= max(open, close) and low <= min(open, close)
  // Epsilon 1e-6 accounts for minor float representation noise without modifying data
  const maxOC = Math.max(open, close);
  const minOC = Math.min(open, close);

  if (high < maxOC - 1e-6) {
    return {
      isValid: false,
      candle: null,
      rejectionReason: `INVALID_HIGH: high (${high}) < max(open, close) (${maxOC})`,
    };
  }

  if (low > minOC + 1e-6) {
    return {
      isValid: false,
      candle: null,
      rejectionReason: `INVALID_LOW: low (${low}) > min(open, close) (${minOC})`,
    };
  }

  const timestamp = typeof (raw as any).timestamp === 'number' && !isNaN((raw as any).timestamp) && (raw as any).timestamp > 0
    ? (raw as any).timestamp
    : parseTwelveDataTimestamp(raw.datetime);
  if (!timestamp || timestamp <= 0) {
    return { isValid: false, candle: null, rejectionReason: `INVALID_TIMESTAMP: ${raw?.datetime ?? 'undefined'}` };
  }

  return {
    isValid: true,
    candle: {
      timestamp,
      datetime: raw.datetime || new Date(timestamp).toISOString(),
      open,
      high,
      low,
      close,
      volume: isNaN(volume) ? 0 : volume,
      isVerified: true,
    },
    rejectionReason: null,
  };
}

/**
 * Normalizes, verifies, deduplicates, and sorts candles chronologically (oldest to newest).
 */
export function normalizeAndSortCandles(rawCandles: RawTwelveDataCandle[]): {
  candles: Candle[];
  rejectedCount: number;
  rejectionDetails: string[];
} {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
    return { candles: [], rejectedCount: 0, rejectionDetails: [] };
  }

  const validMap = new Map<number, Candle>();
  const rejectionDetails: string[] = [];
  let rejectedCount = 0;

  for (const raw of rawCandles) {
    const res = validateCandle(raw);
    if (res.isValid && res.candle) {
      // Deduplicate by timestamp: overwrite if duplicate timestamp encountered
      validMap.set(res.candle.timestamp, res.candle);
    } else {
      rejectedCount++;
      if (res.rejectionReason) {
        rejectionDetails.push(`At ${raw?.datetime || 'unknown'}: ${res.rejectionReason}`);
      }
    }
  }

  // Sort strictly ascending by timestamp (oldest first, newest last)
  const sorted = Array.from(validMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  return {
    candles: sorted,
    rejectedCount,
    rejectionDetails,
  };
}

/**
 * Deterministic timeframe aggregation per Step 4:
 * Open = first candle open
 * High = maximum high
 * Low = minimum low
 * Close = last candle close
 * Volume = sum of volume
 * (Never averages OHLC values)
 */
export function aggregateCandles(
  baseCandles: Candle[],
  targetIntervalMinutes: number
): Candle[] {
  if (!baseCandles || baseCandles.length === 0 || !targetIntervalMinutes || targetIntervalMinutes <= 0) {
    return [];
  }

  const targetIntervalMs = targetIntervalMinutes * 60 * 1000;
  const buckets = new Map<number, Candle[]>();

  for (const c of baseCandles) {
    const bucketKey = Math.floor(c.timestamp / targetIntervalMs) * targetIntervalMs;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(c);
    buckets.set(bucketKey, bucket);
  }

  const aggregated: Candle[] = [];
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const bucketTimestamp of sortedKeys) {
    const group = buckets.get(bucketTimestamp)!;
    if (group.length === 0) continue;

    // Ensure sorted inside bucket
    group.sort((a, b) => a.timestamp - b.timestamp);

    const open = group[0].open;
    const close = group[group.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let totalVolume = 0;

    for (const item of group) {
      if (item.high > high) high = item.high;
      if (item.low < low) low = item.low;
      totalVolume += item.volume || 0;
    }

    const isoUtc = new Date(bucketTimestamp).toISOString().replace('T', ' ').substring(0, 19);

    aggregated.push({
      timestamp: bucketTimestamp,
      datetime: isoUtc,
      open,
      high,
      low,
      close,
      volume: totalVolume,
      isVerified: true,
    });
  }

  return aggregated;
}

/**
 * Formats a UTC millisecond timestamp according to the selected display timezone.
 */
export function formatCandleTimestamp(
  timestamp: number,
  timezone: string = 'UTC',
  timeframe: string = '15m'
): string {
  if (!timestamp || isNaN(timestamp)) return '—';

  const date = new Date(timestamp);
  const isDaily = timeframe === '1D' || timeframe === '1d' || timeframe === 'D1' || timeframe === '1day';

  try {
    const timeZoneOption = timezone === 'LOCAL' ? undefined : timezone;
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timeZoneOption,
      year: isDaily ? 'numeric' : undefined,
      month: 'short',
      day: 'numeric',
      hour: isDaily ? undefined : '2-digit',
      minute: isDaily ? undefined : '2-digit',
      hour12: false,
    };

    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    // Fallback if timezone not recognized
    return date.toISOString().replace('T', ' ').substring(0, isDaily ? 10 : 16);
  }
}

/**
 * Formats full timestamp with seconds and timezone indicator for tooltip and platform comparison.
 */
export function formatFullTimestampWithTz(
  timestamp: number,
  timezone: string = 'UTC'
): string {
  if (!timestamp || isNaN(timestamp)) return '—';
  const date = new Date(timestamp);

  try {
    const timeZoneOption = timezone === 'LOCAL' ? undefined : timezone;
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timeZoneOption,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };
    const formatted = new Intl.DateTimeFormat('en-US', options).format(date);
    return `${formatted} (${timezone === 'LOCAL' ? 'Local' : timezone})`;
  } catch {
    return `${date.toISOString().replace('T', ' ').substring(0, 19)} UTC`;
  }
}
