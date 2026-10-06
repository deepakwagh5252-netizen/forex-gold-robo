/**
 * Central Watchlist Configuration for FOREX & GOLD ROBO.
 * 
 * Rules strictly enforced:
 * 1. Single central source of truth for active instruments.
 * 2. Active watchlist: XAU/USD (Priority 1), EUR/USD, GBP/USD, USD/JPY (Priority 2).
 * 3. Inactive instruments (USD/CHF, AUD/USD, USD/CAD, NZD/USD) are preserved in
 *    AVAILABLE_INSTRUMENTS for future expansion without code deletion.
 * 4. All UI panels, scheduling, telemetry, and quotes derive from this configuration.
 */

export const ACTIVE_INSTRUMENTS = [
  'XAU/USD',
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
] as const;

export type ActiveInstrumentSymbol = typeof ACTIVE_INSTRUMENTS[number];

export const ACTIVE_SECONDARY_INSTRUMENTS = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
] as const;

export type ActiveSecondarySymbol = typeof ACTIVE_SECONDARY_INSTRUMENTS[number];

export const AVAILABLE_INSTRUMENTS = [
  'XAU/USD',
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'USD/CAD',
  'NZD/USD',
] as const;

export type AvailableInstrumentSymbol = typeof AVAILABLE_INSTRUMENTS[number];

export const INACTIVE_PRESERVED_INSTRUMENTS = [
  'USD/CHF',
  'AUD/USD',
  'USD/CAD',
  'NZD/USD',
] as const;

export type InactivePreservedSymbol = typeof INACTIVE_PRESERVED_INSTRUMENTS[number];

export const INSTRUMENT_PRIORITY: Record<string, number> = {
  'XAU/USD': 1, // Primary Gold instrument
  'EUR/USD': 2,
  'GBP/USD': 2,
  'USD/JPY': 2,
  'USD/CHF': 3,
  'AUD/USD': 3,
  'USD/CAD': 3,
  'NZD/USD': 3,
};

export function isActiveInstrument(symbol: string): boolean {
  return (ACTIVE_INSTRUMENTS as readonly string[]).includes(symbol);
}

export function isAvailableInstrument(symbol: string): boolean {
  return (AVAILABLE_INSTRUMENTS as readonly string[]).includes(symbol);
}
