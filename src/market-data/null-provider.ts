import { MarketDataProvider, ProviderMetadata, Candle } from './provider.interface';
import { InstrumentQuote, ConnectionStatus, MarketDataStatus } from '../types/terminal';
import { WATCHLIST_INSTRUMENTS } from './constants';

/**
 * NullMarketDataProvider
 * 
 * Default uninitialized provider for Phase 1.
 * Guaranteed zero-fabrication compliance:
 * - Does not invent prices, ticks, candles, or spreads.
 * - Explicitly reports connection state as 'NOT CONNECTED'.
 * - Explicitly reports data state as 'NO VERIFIED MARKET DATA'.
 */
export class NullMarketDataProvider implements MarketDataProvider {
  readonly id = 'unconnected_feed';
  readonly name = 'Unconnected Institutional Feed';

  readonly metadata: ProviderMetadata = {
    id: 'unconnected_feed',
    name: 'Unconnected Institutional Feed',
    description: 'Awaiting verified Forex & Gold institutional feed integration in Phase 2.',
    assetCoverage: ['XAU/USD', 'Major Forex', 'Minor Forex', 'Exotic Forex'],
    latencyMs: null,
    requiresApiKey: true,
    isConfigured: false,
  };

  private listeners: ((quote: InstrumentQuote) => void)[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];

  getConnectionStatus(): ConnectionStatus {
    return 'NOT CONNECTED';
  }

  getMarketDataStatus(): MarketDataStatus {
    return 'NO VERIFIED MARKET DATA';
  }

  async connect(): Promise<void> {
    // In Phase 1, real data source is deliberately unconnected.
    // We strictly do NOT fabricate connection or invent ticks.
    console.info('[DataSafety] NullMarketDataProvider: Connection deferred to Phase 2 verified feed.');
  }

  async disconnect(): Promise<void> {
    // No-op for null provider
  }

  getQuote(symbol: string): InstrumentQuote {
    return {
      symbol,
      ltp: null,
      changePercent: null,
      bid: null,
      ask: null,
      spreadPips: null,
      timestamp: null,
      status: 'NO VERIFIED DATA',
      source: null,
      freshness: 'NONE',
    };
  }

  getAllQuotes(): Record<string, InstrumentQuote> {
    const quotes: Record<string, InstrumentQuote> = {};
    for (const inst of WATCHLIST_INSTRUMENTS) {
      quotes[inst.symbol] = this.getQuote(inst.symbol);
    }
    return quotes;
  }

  async getHistoricalCandles(_symbol: string, _timeframe: string): Promise<Candle[]> {
    // Strictly return empty list - no fake candles
    return [];
  }

  onQuoteUpdate(listener: (quote: InstrumentQuote) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }
}

export const defaultMarketDataProvider = new NullMarketDataProvider();
