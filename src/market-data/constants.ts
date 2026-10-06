import { WatchlistInstrument, MarketSessionInfo } from '../types/terminal';
import { 
  ACTIVE_INSTRUMENTS, 
  ACTIVE_SECONDARY_INSTRUMENTS, 
  AVAILABLE_INSTRUMENTS, 
  INACTIVE_PRESERVED_INSTRUMENTS,
  INSTRUMENT_PRIORITY,
  isActiveInstrument, 
  isAvailableInstrument 
} from '../config/watchlist-config';

export { 
  ACTIVE_INSTRUMENTS, 
  ACTIVE_SECONDARY_INSTRUMENTS, 
  AVAILABLE_INSTRUMENTS, 
  INACTIVE_PRESERVED_INSTRUMENTS,
  INSTRUMENT_PRIORITY,
  isActiveInstrument, 
  isAvailableInstrument 
};

/**
 * Complete catalog of supported instruments preserved in the codebase.
 * Any instrument can be activated simply by adding it to ACTIVE_INSTRUMENTS in watchlist-config.ts.
 */
export const ALL_WATCHLIST_INSTRUMENTS: WatchlistInstrument[] = [
  {
    symbol: 'XAU/USD',
    name: 'Gold (Ounce) / US Dollar',
    category: 'Metals',
    baseCurrency: 'XAU',
    quoteCurrency: 'USD',
    pipPrecision: 2,
  },
  {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'Major Forex',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    pipPrecision: 4,
  },
  {
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'Major Forex',
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    pipPrecision: 4,
  },
  {
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'Major Forex',
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    pipPrecision: 2,
  },
  {
    symbol: 'USD/CHF',
    name: 'US Dollar / Swiss Franc',
    category: 'Major Forex',
    baseCurrency: 'USD',
    quoteCurrency: 'CHF',
    pipPrecision: 4,
  },
  {
    symbol: 'AUD/USD',
    name: 'Australian Dollar / US Dollar',
    category: 'Major Forex',
    baseCurrency: 'AUD',
    quoteCurrency: 'USD',
    pipPrecision: 4,
  },
  {
    symbol: 'USD/CAD',
    name: 'US Dollar / Canadian Dollar',
    category: 'Major Forex',
    baseCurrency: 'USD',
    quoteCurrency: 'CAD',
    pipPrecision: 4,
  },
  {
    symbol: 'NZD/USD',
    name: 'New Zealand Dollar / US Dollar',
    category: 'Major Forex',
    baseCurrency: 'NZD',
    quoteCurrency: 'USD',
    pipPrecision: 4,
  },
  {
    symbol: 'USD/INR',
    name: 'US Dollar / Indian Rupee',
    category: 'Exotic Forex',
    baseCurrency: 'USD',
    quoteCurrency: 'INR',
    pipPrecision: 4,
  },
];

/**
 * Active Watchlist: strictly filtered by ACTIVE_INSTRUMENTS (XAU/USD, EUR/USD, GBP/USD, USD/JPY).
 * All UI tables, cards, and live monitoring use this single source of truth.
 */
export const WATCHLIST_INSTRUMENTS: WatchlistInstrument[] = ALL_WATCHLIST_INSTRUMENTS.filter(
  (item) => isActiveInstrument(item.symbol)
);

/**
 * Symbols for Command Center Panel 1 Market Overview (derived directly from central ACTIVE_INSTRUMENTS).
 */
export const MARKET_OVERVIEW_SYMBOLS = [...ACTIVE_INSTRUMENTS];

export const DEFAULT_MARKET_SESSIONS: MarketSessionInfo[] = [
  {
    id: 'ASIA',
    name: 'ASIA',
    cities: 'Tokyo / Sydney / Singapore',
    startUtc: '00:00 UTC',
    endUtc: '09:00 UTC',
    status: 'UNKNOWN',
    isOpen: null,
    timeframeNotes: 'Awaiting verified session feed synchronization',
  },
  {
    id: 'LONDON',
    name: 'LONDON',
    cities: 'London / Frankfurt',
    startUtc: '08:00 UTC',
    endUtc: '17:00 UTC',
    status: 'UNKNOWN',
    isOpen: null,
    timeframeNotes: 'Awaiting verified session feed synchronization',
  },
  {
    id: 'NEW_YORK',
    name: 'NEW YORK',
    cities: 'New York / Chicago',
    startUtc: '13:00 UTC',
    endUtc: '22:00 UTC',
    status: 'UNKNOWN',
    isOpen: null,
    timeframeNotes: 'Awaiting verified session feed synchronization',
  },
];
