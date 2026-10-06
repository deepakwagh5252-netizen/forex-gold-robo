import { Candle } from '../../market-data/provider.interface';
import { ForwardCandle } from '../../types/forward-validation';

export interface CandleValidationResult {
  isValid: boolean;
  isConfirmedClosed: boolean;
  status: 'VALID' | 'MALFORMED' | 'OUT_OF_ORDER' | 'DUPLICATE' | 'INCOMPLETE';
  error: string | null;
  candle: ForwardCandle | null;
}

export class ForwardCandleValidator {
  public static readonly M15_INTERVAL_MS = 15 * 60 * 1000;
  public static readonly STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

  /**
   * Deterministically aligns any UTC millisecond timestamp to its M15 start boundary (:00, :15, :30, :45).
   */
  public static getUtcM15Start(timestamp: number): number {
    return Math.floor(timestamp / this.M15_INTERVAL_MS) * this.M15_INTERVAL_MS;
  }

  /**
   * Deterministically calculates the close time of an M15 candle in UTC.
   * An M15 bar starting at candleStartTs closes at candleStartTs + 15 minutes.
   */
  public static getUtcM15Close(candleStartTs: number): number {
    return candleStartTs + this.M15_INTERVAL_MS;
  }

  /**
   * Checks if a timestamp aligns exactly to a UTC M15 boundary.
   */
  public static isUtcM15Aligned(timestamp: number): boolean {
    return typeof timestamp === 'number' && timestamp > 0 && timestamp % this.M15_INTERVAL_MS === 0;
  }

  /**
   * Confirms whether a candle has finished and closed.
   * A candle is confirmed closed ONLY when current UTC time >= candle close time.
   */
  public static isCandleConfirmedClosed(candleStartTs: number, nowMs: number = Date.now()): boolean {
    const candleCloseTime = this.getUtcM15Close(candleStartTs);
    return nowMs >= candleCloseTime;
  }

  /**
   * Validates a candidate live M15 candle for forward paper processing.
   * Strictly enforces:
   * - Positive numbers
   * - OHLC structural integrity (high >= max(open, close), low <= min(open, close))
   * - Chronological monotonicity
   * - Duplicate detection
   * - Incomplete candle protection (never trade on incomplete candle)
   * - Stale data detection
   */
  public static validate(
    rawCandle: Candle | null | undefined,
    lastCandle: ForwardCandle | null,
    nowMs: number = Date.now(),
    bypassTimeClosedCheck: boolean = false
  ): CandleValidationResult {
    const receivedAt = new Date(nowMs).toISOString();

    if (!rawCandle) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: 'CANDLE_NULL_OR_UNDEFINED: Ingested candle is null or undefined.',
        candle: null,
      };
    }

    // 1. Timestamp validation
    if (typeof rawCandle.timestamp !== 'number' || isNaN(rawCandle.timestamp) || rawCandle.timestamp <= 0) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `INVALID_TIMESTAMP: timestamp ${rawCandle.timestamp} must be a positive integer.`,
        candle: null,
      };
    }

    const candleTs = rawCandle.timestamp;
    // Normalize strictly to UTC ISO 8601 to prevent local timezone misinterpretation
    const datetime = new Date(candleTs).toISOString();

    // 2. Numerical positive price checks
    const { open, high, low, close } = rawCandle;
    if (
      typeof open !== 'number' || isNaN(open) || open <= 0 ||
      typeof high !== 'number' || isNaN(high) || high <= 0 ||
      typeof low !== 'number' || isNaN(low) || low <= 0 ||
      typeof close !== 'number' || isNaN(close) || close <= 0
    ) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `NON_POSITIVE_PRICE: OHLC values must be strictly positive numbers. [O:${open}, H:${high}, L:${low}, C:${close}]`,
        candle: null,
      };
    }

    // 3. OHLC Structural integrity
    const maxOC = Math.max(open, close);
    const minOC = Math.min(open, close);

    if (high < maxOC) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `OHLC_INTEGRITY_VIOLATION: High ($${high}) is strictly less than max(open, close) ($${maxOC}).`,
        candle: null,
      };
    }

    if (low > minOC) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `OHLC_INTEGRITY_VIOLATION: Low ($${low}) is strictly greater than min(open, close) ($${minOC}).`,
        candle: null,
      };
    }

    if (high < low) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `OHLC_INTEGRITY_VIOLATION: High ($${high}) is strictly less than low ($${low}).`,
        candle: null,
      };
    }

    // 4. Duplicate timestamp check
    if (lastCandle && candleTs === lastCandle.timestamp) {
      return {
        isValid: false,
        isConfirmedClosed: true,
        status: 'DUPLICATE',
        error: `DUPLICATE_CANDLE: Candle with timestamp ${candleTs} (${datetime}) has already been ingested.`,
        candle: null,
      };
    }

    // 5. Out-of-order timestamp check
    if (lastCandle && candleTs < lastCandle.timestamp) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'OUT_OF_ORDER',
        error: `OUT_OF_ORDER_TIMESTAMP: Ingested timestamp ${candleTs} (${datetime}) is earlier than previous confirmed timestamp ${lastCandle.timestamp} (${lastCandle.datetime}).`,
        candle: null,
      };
    }

    // 6. UTC M15 boundary alignment (must start on :00, :15, :30, :45)
    if (!this.isUtcM15Aligned(candleTs)) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `UNALIGNED_M15_BOUNDARY: Ingested candle timestamp ${candleTs} (${datetime}) does not align to UTC M15 boundary.`,
        candle: null,
      };
    }

    // 7. Future-dated candle protection (Never evaluate a future-dated candle)
    if (!bypassTimeClosedCheck && candleTs > nowMs) {
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'MALFORMED',
        error: `FUTURE_CANDLE_REJECTED: Candle start timestamp ${datetime} (${candleTs}) is in the future relative to current UTC time ${receivedAt} (${nowMs}). Future-dated candles must never be evaluated.`,
        candle: null,
      };
    }

    // 8. Incomplete candle protection
    // An M15 bar beginning at candleTs in UTC closes at candleTs + 15 minutes.
    // A candle is confirmed only when current UTC time >= candle_close_time.
    const candleCloseTime = this.getUtcM15Close(candleTs);
    const isClosed = bypassTimeClosedCheck || (nowMs >= candleCloseTime);
    if (!isClosed) {
      const remainingSec = Math.ceil((candleCloseTime - nowMs) / 1000);
      return {
        isValid: false,
        isConfirmedClosed: false,
        status: 'INCOMPLETE',
        error: `INCOMPLETE_CANDLE: Candle ${datetime} is still active. Closes in ${remainingSec}s at ${new Date(candleCloseTime).toISOString()}. Signal evaluation rejected until confirmed closed.`,
        candle: {
          candleId: `CANDLE-XAUUSD-15m-${candleTs}`,
          symbol: 'XAU/USD',
          timeframe: '15m',
          timestamp: candleTs,
          datetime,
          open,
          high,
          low,
          close,
          volume: rawCandle.volume || 0,
          isVerified: rawCandle.isVerified ?? true,
          isConfirmedClosed: false,
          receivedAt,
          validationStatus: 'INCOMPLETE',
          validationError: `Candle active; ${remainingSec}s to close.`,
        },
      };
    }

    // 9. Stale data detection
    const ageMs = nowMs - candleCloseTime;
    let staleWarning: string | null = null;
    if (!bypassTimeClosedCheck && ageMs > this.STALE_THRESHOLD_MS) {
      staleWarning = `STALE_DATA_WARNING: Candle timestamp ${datetime} is ${Math.round(ageMs / 60000)} minutes old.`;
    }

    const validatedForwardCandle: ForwardCandle = {
      candleId: `CANDLE-XAUUSD-15m-${candleTs}`,
      symbol: 'XAU/USD',
      timeframe: '15m',
      timestamp: candleTs,
      datetime,
      open,
      high,
      low,
      close,
      volume: rawCandle.volume || 0,
      isVerified: rawCandle.isVerified ?? true,
      isConfirmedClosed: true,
      receivedAt,
      validationStatus: 'VALID',
      validationError: staleWarning,
    };

    return {
      isValid: true,
      isConfirmedClosed: true,
      status: 'VALID',
      error: null,
      candle: validatedForwardCandle,
    };
  }
}
