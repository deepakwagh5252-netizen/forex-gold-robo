export type ConnectionStatus = 'NOT CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RATE LIMITED' | 'STALE' | 'ERROR' | 'DISCONNECTED';

export type MarketDataStatus = 'NOT CONNECTED' | 'LIVE' | 'STALE' | 'RATE LIMITED' | 'NO VERIFIED MARKET DATA' | 'ERROR';

export type VerificationStatus = 'LIVE' | 'STALE' | 'RATE LIMITED' | 'WAITING' | 'NOT CONNECTED' | 'INVALID' | 'NO VERIFIED DATA' | 'ERROR';

export interface NormalizedMarketQuote {
  symbol: string;
  provider: string;
  price: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  spreadPips: number | null;
  timestamp: string | null;
  sourceTimestamp: number | null;
  status: 'LIVE' | 'STALE' | 'RATE LIMITED' | 'WAITING' | 'NOT CONNECTED' | 'INVALID' | 'ERROR';
  error: string | null;
  isMarketOpen: boolean | null;
  rateLimited?: boolean;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  previousClose?: number | null;
}

export type NavigationPage = 
  | 'command_center'
  | 'forex_watchlist'
  | 'xau_usd'
  | 'market_sessions'
  | 'setup_scanner'
  | 'strategy_lab'
  | 'paper_trading'
  | 'trade_journal'
  | 'settings';

export type BottomTabType = 
  | 'positions'
  | 'orders'
  | 'history'
  | 'system_status';

export interface WatchlistInstrument {
  symbol: string;
  name: string;
  category: 'Metals' | 'Major Forex' | 'Minor Forex' | 'Exotic Forex';
  baseCurrency: string;
  quoteCurrency: string;
  pipPrecision: number;
}

export interface InstrumentQuote {
  symbol: string;
  ltp: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  spreadPips: number | null;
  timestamp: string | null;
  status: VerificationStatus;
  source: string | null;
  freshness: string;
  provider?: string;
  error?: string | null;
  sourceTimestamp?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
}

export interface MarketSessionInfo {
  id: 'ASIA' | 'LONDON' | 'NEW_YORK';
  name: string;
  cities: string;
  startUtc: string; // e.g., '00:00 UTC'
  endUtc: string;   // e.g., '09:00 UTC'
  status: 'UNKNOWN' | 'ACTIVE' | 'CLOSED';
  isOpen: boolean | null;
  timeframeNotes: string;
}

export interface MarketIntelligenceMetrics {
  regime: string | null;
  volatility: string | null;
  marketStructure: string | null;
  liquidityCondition: string | null;
  trendState: string | null;
  status: 'WAITING FOR VERIFIED DATA' | 'COMPUTED';
}

export interface SetupStatusInfo {
  hasValidatedSetup: boolean;
  message: string;
  lastEvaluatedAt: string | null;
  activeFiltersCount: number;
  validationChecklist: {
    label: string;
    passed: boolean;
    statusText: string;
  }[];
}
