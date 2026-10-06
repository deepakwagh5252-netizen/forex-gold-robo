/**
 * Pure Phase 7F/7G Filter AB Evaluator
 * 
 * Harmonzied rules shared across Forward Paper Engine and Historical Replay Engine:
 * - Filter A: Reject BEARISH / SHORT only when MarketRegime === 'TRENDING_BEARISH'
 * - Filter B: Reject any breakout setup occurring during Asian Session (00:00:00 through 06:59:59 UTC)
 * - 07:00:00 UTC and later passes Filter B.
 * 
 * Strict Guarantees:
 * - Pure deterministic function with zero side effects.
 * - Does not alter candle data, strategy signals, or risk parameters.
 * - Preserves exact reason strings expected by audit logs and downstream consumers.
 */

export type FilterDirection = 'BULLISH' | 'BEARISH' | 'LONG' | 'SHORT' | 'FLAT' | string;

export interface FilterABInput {
  direction: FilterDirection;
  regime: string;
  timestamp: number | string | Date;
}

export interface FilterABResult {
  rejectA: boolean;
  rejectB: boolean;
  rejectAB: boolean;
  passed: boolean;
  reason: string;
  filterAResult: 'PASS' | 'REJECT';
  filterBResult: 'PASS' | 'REJECT';
  combinedFilterResult: 'PASS' | 'REJECT';
}

/**
 * Pure Filter AB evaluation function.
 * Accepts either an options object or positional arguments for flexibility.
 */
export function evaluateFilterAB(
  directionOrInput: FilterDirection | FilterABInput,
  regimeArg?: string,
  timestampArg?: number | string | Date
): FilterABResult {
  let direction: string;
  let regime: string;
  let timestamp: number | string | Date;

  if (typeof directionOrInput === 'object' && directionOrInput !== null) {
    direction = directionOrInput.direction;
    regime = directionOrInput.regime;
    timestamp = directionOrInput.timestamp;
  } else {
    direction = String(directionOrInput);
    regime = regimeArg || '';
    timestamp = timestampArg ?? 0;
  }

  // Filter A: Reject SHORT if MarketRegime === TRENDING_BEARISH
  const isShort = direction === 'BEARISH' || direction === 'SHORT';
  const isTrendingBearish = regime === 'TRENDING_BEARISH';
  const rejectA = isShort && isTrendingBearish;

  // Filter B: Reject if 00:00:00 UTC <= entryTime < 07:00:00 UTC (Asian Session)
  const date = typeof timestamp === 'number' || typeof timestamp === 'string'
    ? new Date(timestamp)
    : timestamp;
  const candleHourUTC = date.getUTCHours();
  const isAsianSessionTime = !isNaN(date.getTime()) && candleHourUTC >= 0 && candleHourUTC < 7;
  const rejectB = isAsianSessionTime;

  const rejectAB = rejectA || rejectB;
  const filterReason = rejectA && rejectB
    ? 'FILTER_AB_REJECTED: Short in Trending Bearish regime AND Asian Session (00:00-07:00 UTC)'
    : rejectA
    ? 'FILTER_A_REJECTED: Short breakdown during TRENDING_BEARISH regime'
    : rejectB
    ? 'FILTER_B_REJECTED: Breakout entry during Asian Session (00:00-07:00 UTC)'
    : 'FILTER_AB_PASSED';

  return {
    rejectA,
    rejectB,
    rejectAB,
    passed: !rejectAB,
    reason: filterReason,
    filterAResult: rejectA ? 'REJECT' : 'PASS',
    filterBResult: rejectB ? 'REJECT' : 'PASS',
    combinedFilterResult: rejectAB ? 'REJECT' : 'PASS',
  };
}
