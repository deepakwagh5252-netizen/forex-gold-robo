/**
 * Terminal value formatting utilities.
 * Strictly guarantees that missing or unverified metrics return standard em-dash ("—")
 * rather than fallback random numbers or zeroes.
 */

export function formatPrice(value: number | null | undefined, precision: number = 2): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }
  return value.toFixed(precision);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) {
    return '—';
  }
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  } catch {
    return '—';
  }
}

export function formatSystemClock(date: Date): { utcTime: string; localTime: string; utcDate: string } {
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const utcHours = pad(date.getUTCHours());
  const utcMins = pad(date.getUTCMinutes());
  const utcSecs = pad(date.getUTCSeconds());
  const utcTime = `${utcHours}:${utcMins}:${utcSecs} UTC`;

  const localHours = pad(date.getHours());
  const localMins = pad(date.getMinutes());
  const localSecs = pad(date.getSeconds());
  const localTime = `${localHours}:${localMins}:${localSecs} LOC`;

  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const utcDate = `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

  return { utcTime, localTime, utcDate };
}
