import { MarketSessionType } from '../types/phase-7e-validation';

/**
 * Deterministic UTC Timestamp Market Session Classifier
 * 
 * Classifies an exact millisecond timestamp or Date object into standard global FX/Gold sessions:
 * - ASIAN: 00:00 - 08:00 UTC (Tokyo/Sydney dominant)
 * - LONDON: 08:00 - 13:00 UTC (London exclusive morning)
 * - LONDON/NEW YORK OVERLAP: 13:00 - 17:00 UTC (Peak global liquidity)
 * - NEW YORK: 17:00 - 22:00 UTC (New York afternoon after London close)
 * - OTHER: 22:00 - 00:00 UTC (US-Asia transition / Rollover)
 */
export function classifyTimestampSession(timestampOrDate: number | string | Date): MarketSessionType {
  const date = typeof timestampOrDate === 'number' || typeof timestampOrDate === 'string'
    ? new Date(timestampOrDate)
    : timestampOrDate;
    
  if (isNaN(date.getTime())) {
    return 'OTHER';
  }

  const hour = date.getUTCHours();

  if (hour >= 0 && hour < 8) {
    return 'ASIAN';
  } else if (hour >= 8 && hour < 13) {
    return 'LONDON';
  } else if (hour >= 13 && hour < 17) {
    return 'LONDON/NEW YORK OVERLAP';
  } else if (hour >= 17 && hour < 22) {
    return 'NEW YORK';
  } else {
    return 'OTHER';
  }
}
