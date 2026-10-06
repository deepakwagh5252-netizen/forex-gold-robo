import { MarketDataProvider, ProviderMetadata, Candle, CandleSeriesResponse } from './provider.interface';
import { InstrumentQuote, ConnectionStatus, MarketDataStatus, NormalizedMarketQuote } from '../types/terminal';
import { WATCHLIST_INSTRUMENTS, ACTIVE_INSTRUMENTS, isActiveInstrument } from './constants';

export interface RateLimitBudgetTelemetry {
  requestsThisMinute: number;
  maxRequestsPerMinute: number;
  remainingCredits: number;
  nextResetSeconds: number;
  isRateLimited: boolean;
  queueLength: number;
  totalRequestsExecuted: number;
}

export interface ProviderTelemetry {
  lastUpdated: string | null;
  nextUpdateSeconds: number;
  isPolling: boolean;
  error: string | null;
  hasConfiguredKey: boolean;
  totalInstruments: number;
  liveInstrumentsCount: number;
  staleInstrumentsCount: number;
  rateLimitedCount: number;
  waitingCount: number;
  unconnectedCount: number;
  rateLimit: RateLimitBudgetTelemetry;
}

export class TwelveDataMarketDataProvider implements MarketDataProvider {
  readonly id = 'twelve_data';
  readonly name = 'Twelve Data';

  readonly metadata: ProviderMetadata = {
    id: 'twelve_data',
    name: 'Twelve Data',
    description: 'Real institutional Forex & Spot Gold market data feed accessed via secure server proxy.',
    assetCoverage: [...ACTIVE_INSTRUMENTS],
    latencyMs: null,
    requiresApiKey: true,
    isConfigured: false,
  };

  private quotes: Record<string, InstrumentQuote> = {};
  private connectionStatus: ConnectionStatus = 'NOT CONNECTED';
  private marketDataStatus: MarketDataStatus = 'NOT CONNECTED';
  private quoteListeners: ((quote: InstrumentQuote) => void)[] = [];
  private statusListeners: ((status: ConnectionStatus) => void)[] = [];
  private telemetryListeners: ((telemetry: ProviderTelemetry) => void)[] = [];
  
  private countdownIntervalId: number | null = null;
  private isFetching = false;
  private pollIntervalSeconds = 45;
  private nextPollCountdown = 45;
  private lastSuccessfulUpdate: string | null = null;
  private lastTechnicalError: string | null = null;
  private isUserConfiguredKey = false;

  // Session-aware connection tracking (Requirement 5)
  private hasEverConnected = false;
  private lastSuccessfulVerifiedAt: number | null = null;
  private lastVerifiedDataAt: number | null = null;
  private lastRateLimitedAt: number | null = null;
  private lastErrorAt: number | null = null;
  private freshnessThresholdMs = 90000;
  
  private rateLimitTelemetry: RateLimitBudgetTelemetry = {
    requestsThisMinute: 0,
    maxRequestsPerMinute: 8,
    remainingCredits: 8,
    nextResetSeconds: 0,
    isRateLimited: false,
    queueLength: 0,
    totalRequestsExecuted: 0,
  };

  constructor() {
    for (const inst of WATCHLIST_INSTRUMENTS) {
      this.quotes[inst.symbol] = {
        symbol: inst.symbol,
        provider: 'Twelve Data',
        ltp: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        status: 'WAITING',
        source: 'Twelve Data API',
        freshness: 'NONE',
        error: 'Awaiting scheduled Twelve Data request slot',
      };
    }
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  getMarketDataStatus(): MarketDataStatus {
    return this.marketDataStatus;
  }

  getTelemetry(): ProviderTelemetry {
    const quotesList = Object.values(this.quotes);
    const liveCount = quotesList.filter(q => q.status === 'LIVE').length;
    const staleCount = quotesList.filter(q => q.status === 'STALE').length;
    const rateLimitedCount = quotesList.filter(q => q.status === 'RATE LIMITED').length;
    const waitingCount = quotesList.filter(q => q.status === 'WAITING' || (q.error && q.error.includes('Awaiting scheduled'))).length;
    const unconnectedCount = quotesList.filter(q => (q.status === 'NOT CONNECTED' || q.status === 'NO VERIFIED DATA') && (!q.error || !q.error.includes('Awaiting scheduled'))).length;

    return {
      lastUpdated: this.lastSuccessfulUpdate,
      nextUpdateSeconds: this.nextPollCountdown,
      isPolling: this.isFetching,
      error: this.lastTechnicalError,
      hasConfiguredKey: this.isUserConfiguredKey,
      totalInstruments: WATCHLIST_INSTRUMENTS.length,
      liveInstrumentsCount: liveCount,
      staleInstrumentsCount: staleCount,
      rateLimitedCount: rateLimitedCount,
      waitingCount: waitingCount,
      unconnectedCount: unconnectedCount,
      rateLimit: { ...this.rateLimitTelemetry },
    };
  }

  async connect(): Promise<void> {
    this.updateConnectionStatus('CONNECTING');
    
    // Initial fetch
    await this.fetchQuotes(false);

    // Setup timer countdown and recurring controlled poll
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
    this.nextPollCountdown = this.pollIntervalSeconds;
    this.countdownIntervalId = window.setInterval(() => {
      this.nextPollCountdown = Math.max(0, this.nextPollCountdown - 1);
      
      // Also decrement local rate limit reset seconds if positive (DISPLAY INFORMATION ONLY)
      if (this.rateLimitTelemetry.nextResetSeconds > 0) {
        this.rateLimitTelemetry.nextResetSeconds = Math.max(0, this.rateLimitTelemetry.nextResetSeconds - 1);
      }
      // CRITICAL (Requirement 6): Countdown MUST NEVER independently transition connection state or clear isRateLimited.
      // Only real server responses may transition connection status.

      if (this.nextPollCountdown === 0) {
        this.nextPollCountdown = this.pollIntervalSeconds;
        this.fetchQuotes(false);
      }
      this.notifyTelemetry();
    }, 1000);
  }

  async disconnect(): Promise<void> {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
    this.updateConnectionStatus('DISCONNECTED');
    this.marketDataStatus = 'NOT CONNECTED';
  }

  async refreshNow(): Promise<void> {
    this.nextPollCountdown = this.pollIntervalSeconds;
    await this.fetchQuotes(true);
  }

  private async fetchQuotes(force: boolean = false): Promise<void> {
    if (this.isFetching) {
      return;
    }

    this.isFetching = true;
    this.notifyTelemetry();

    try {
      const url = `/api/market-data/quotes${force ? '?force=true' : ''}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Proxy HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        provider: string;
        quotes: Record<string, NormalizedMarketQuote>;
        timestamp: string;
        rateLimit?: RateLimitBudgetTelemetry;
      };

      if (!data.quotes) {
        throw new Error('Malformed quotes payload received from server');
      }

      // Sync rate-limit telemetry from server if attached
      if (data.rateLimit) {
        this.rateLimitTelemetry = data.rateLimit;
      }

      let hasLiveQuote = false;
      let hasStaleQuote = false;
      let hasRateLimitedQuote = false;
      let hasConnectedQuote = false;

      // Update in-memory quotes strictly from normalized server payload (active instruments only)
      for (const [sym, quoteData] of Object.entries(data.quotes)) {
        if (!isActiveInstrument(sym)) continue;

        const mappedQuote: InstrumentQuote = {
          symbol: sym,
          provider: 'Twelve Data',
          ltp: quoteData.price,
          changePercent: quoteData.changePercent,
          bid: quoteData.bid,
          ask: quoteData.ask,
          spreadPips: quoteData.spreadPips,
          timestamp: quoteData.timestamp,
          sourceTimestamp: quoteData.sourceTimestamp,
          status: quoteData.status,
          source: 'Twelve Data API',
          freshness: quoteData.status === 'LIVE' ? 'LIVE' : (quoteData.status === 'STALE' ? 'STALE' : (quoteData.status === 'RATE LIMITED' ? 'RATE LIMITED' : 'NONE')),
          error: quoteData.error,
          open: quoteData.open,
          high: quoteData.high,
          low: quoteData.low,
        };

        this.quotes[sym] = mappedQuote;
        this.notifyQuoteListeners(mappedQuote);

        if (quoteData.status === 'LIVE') {
          hasLiveQuote = true;
          hasConnectedQuote = true;
        } else if (quoteData.status === 'STALE') {
          hasStaleQuote = true;
          hasConnectedQuote = true;
        } else if (quoteData.status === 'RATE LIMITED') {
          hasRateLimitedQuote = true;
          if (quoteData.price !== null) {
            hasConnectedQuote = true;
          }
        }
      }

      // Query status endpoint for key configuration & detailed rate-limit state
      try {
        const statusRes = await fetch('/api/market-data/status');
        if (statusRes.ok) {
          const statusJson = await statusRes.json();
          this.isUserConfiguredKey = statusJson.isConfigured;
          this.metadata.isConfigured = statusJson.isConfigured;
          if (statusJson.rateLimit) {
            this.rateLimitTelemetry = statusJson.rateLimit;
          }
        }
      } catch {
        // Silently preserve local state
      }

      this.lastSuccessfulUpdate = new Date().toISOString();
      this.lastTechnicalError = null;

      // Session history update
      if (hasLiveQuote || (hasConnectedQuote && !this.rateLimitTelemetry.isRateLimited)) {
        this.hasEverConnected = true;
        this.lastSuccessfulVerifiedAt = Date.now();
        this.lastVerifiedDataAt = Date.now();
      }

      // Session-Aware Status Determination (Requirement 5)
      // CRITICAL: A rate-limited connection must NEVER be displayed as NOT CONNECTED.
      if (this.rateLimitTelemetry.isRateLimited || hasRateLimitedQuote) {
        this.lastRateLimitedAt = Date.now();
        this.hasEverConnected = true;
        this.updateConnectionStatus('RATE LIMITED');
        this.marketDataStatus = 'RATE LIMITED';
        this.lastTechnicalError = `Twelve Data rate limit budget exhausted (${this.rateLimitTelemetry.requestsThisMinute}/8 used). Reset in ${this.rateLimitTelemetry.nextResetSeconds}s. Previously verified data preserved.`;
      } else if (hasConnectedQuote) {
        this.hasEverConnected = true;
        this.lastSuccessfulVerifiedAt = Date.now();
        this.lastVerifiedDataAt = Date.now();
        this.updateConnectionStatus('CONNECTED');
        this.marketDataStatus = hasLiveQuote ? 'LIVE' : (hasStaleQuote ? 'STALE' : 'LIVE');
      } else if (this.hasEverConnected) {
        // Verified data exists but freshness threshold exceeded
        const now = Date.now();
        const isFresh = this.lastVerifiedDataAt && (now - this.lastVerifiedDataAt < this.freshnessThresholdMs);
        this.updateConnectionStatus(isFresh ? 'CONNECTED' : 'STALE');
        this.marketDataStatus = isFresh ? 'LIVE' : 'STALE';
      } else {
        this.updateConnectionStatus('NOT CONNECTED');
        this.marketDataStatus = 'NOT CONNECTED';
        const sampleError = Object.values(data.quotes).find(q => q.error)?.error;
        if (sampleError) {
          this.lastTechnicalError = sampleError;
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Network error reaching backend market-data proxy';
      this.lastTechnicalError = errorMsg;
      this.lastErrorAt = Date.now();

      if (this.rateLimitTelemetry.isRateLimited) {
        this.updateConnectionStatus('RATE LIMITED');
        this.marketDataStatus = 'RATE LIMITED';
      } else if (this.hasEverConnected) {
        this.updateConnectionStatus('ERROR');
        this.marketDataStatus = 'ERROR';
      } else {
        this.updateConnectionStatus('NOT CONNECTED');
        this.marketDataStatus = 'NOT CONNECTED';
      }
    } finally {
      this.isFetching = false;
      this.notifyTelemetry();
    }
  }

  getQuote(symbol: string): InstrumentQuote | null {
    return this.quotes[symbol] ?? null;
  }

  getAllQuotes(): Record<string, InstrumentQuote> {
    return { ...this.quotes };
  }

  async getCandleSeries(symbol: string, timeframe: string): Promise<CandleSeriesResponse> {
    try {
      const res = await fetch(`/api/market-data/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`);
      if (!res.ok) {
        return {
          candles: [],
          isVerified: false,
          error: `HTTP error ${res.status}: ${res.statusText}`,
          source: 'Twelve Data API',
        };
      }
      const data = await res.json() as CandleSeriesResponse;
      return {
        candles: data.isVerified && Array.isArray(data.candles) ? data.candles : [],
        isVerified: data.isVerified ?? false,
        error: data.error ?? null,
        rateLimited: data.rateLimited,
        source: data.source || 'Twelve Data API',
        meta: data.meta,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error retrieving candles';
      return {
        candles: [],
        isVerified: false,
        error: msg,
        source: 'Twelve Data API',
      };
    }
  }

  async getHistoricalCandles(symbol: string, timeframe: string): Promise<Candle[]> {
    const res = await this.getCandleSeries(symbol, timeframe);
    return res.candles;
  }

  onQuoteUpdate(listener: (quote: InstrumentQuote) => void): () => void {
    this.quoteListeners.push(listener);
    return () => {
      this.quoteListeners = this.quoteListeners.filter(l => l !== listener);
    };
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  onTelemetryUpdate(listener: (telemetry: ProviderTelemetry) => void): () => void {
    this.telemetryListeners.push(listener);
    listener(this.getTelemetry());
    return () => {
      this.telemetryListeners = this.telemetryListeners.filter(l => l !== listener);
    };
  }

  private updateConnectionStatus(status: ConnectionStatus) {
    this.connectionStatus = status;
    this.statusListeners.forEach(l => l(status));
  }

  private notifyQuoteListeners(quote: InstrumentQuote) {
    this.quoteListeners.forEach(l => l(quote));
  }

  private notifyTelemetry() {
    const t = this.getTelemetry();
    this.telemetryListeners.forEach(l => l(t));
  }
}

export const twelveDataProvider = new TwelveDataMarketDataProvider();
export const twelveDataMarketDataProvider = twelveDataProvider;
