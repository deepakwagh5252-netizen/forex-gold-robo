import { InstrumentQuote, ConnectionStatus, MarketDataStatus } from '../types/terminal';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isVerified: boolean;
  datetime?: string;
}

export interface CandleSeriesMeta {
  symbol: string;
  interval: string;
  currency_base?: string;
  currency_quote?: string;
  exchange?: string;
  timezone: string;
  candleCount: number;
  latestTimestamp: number | null;
  latestDatetime: string | null;
  dataStatus: 'LIVE' | 'CACHE' | 'HISTORICAL' | 'RATE LIMITED';
  lastFetchedAt: string;
  isCached: boolean;
}

export interface CandleSeriesResponse {
  candles: Candle[];
  isVerified: boolean;
  error: string | null;
  rateLimited?: boolean;
  source: string;
  meta?: CandleSeriesMeta;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  assetCoverage: string[];
  latencyMs: number | null;
  requiresApiKey: boolean;
  isConfigured: boolean;
}

/**
 * Abstraction for all Forex and Gold market data feeds.
 * Strictly enforces that unverified or simulated data cannot enter the terminal state.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly metadata: ProviderMetadata;

  getConnectionStatus(): ConnectionStatus;
  getMarketDataStatus(): MarketDataStatus;
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  getQuote(symbol: string): InstrumentQuote | null;
  getAllQuotes(): Record<string, InstrumentQuote>;
  
  getHistoricalCandles(symbol: string, timeframe: string): Promise<Candle[]>;
  
  onQuoteUpdate(listener: (quote: InstrumentQuote) => void): () => void;
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
}
