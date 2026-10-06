import { MarketDataProvider, Candle, CandleSeriesResponse } from '../market-data/provider.interface';
import { twelveDataMarketDataProvider, ProviderTelemetry } from '../market-data/twelve-data-provider';
import { 
  ConnectionStatus, 
  MarketDataStatus, 
  InstrumentQuote, 
  MarketSessionInfo, 
  MarketIntelligenceMetrics, 
  SetupStatusInfo 
} from '../types/terminal';
import { XauUsdMarketIntelligence } from '../types/intelligence';
import { ScannerSummary, ScannerConfig } from '../types/scanner';
import { setupScannerEngine } from '../intelligence/setup-scanner-engine';
import { paperTradingEngine } from './paper-trading/paper-trading-engine';
import { DEFAULT_MARKET_SESSIONS } from '../market-data/constants';
import { forwardPaperEngine } from './paper-trading/forward-paper-engine';

export class MarketService {
  private provider: MarketDataProvider;
  private isSyncingCandles = false;

  constructor(provider: MarketDataProvider = twelveDataMarketDataProvider) {
    this.provider = provider;
    // Automatically route verified market quotes to paper trading engine
    this.provider.onQuoteUpdate(async (quote) => {
      try {
        paperTradingEngine.onQuoteUpdate(quote);
        if (quote.symbol === 'XAU/USD' && !this.isSyncingCandles) {
          this.isSyncingCandles = true;
          try {
            await this.syncForwardXauUsdCandles();
          } finally {
            this.isSyncingCandles = false;
          }
        }
      } catch {
        // Safe simulation wrapper
      }
    });
  }

  getProvider(): MarketDataProvider {
    return this.provider;
  }

  async getXauUsdIntelligence(timeframe: string = '15min'): Promise<XauUsdMarketIntelligence | null> {
    try {
      const res = await fetch(`/api/market-data/intelligence?symbol=XAU/USD&interval=${encodeURIComponent(timeframe)}`);
      if (!res.ok) {
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  }

  async getXauUsdScannerResults(timeframe: string = '15min', minRR: number = 2.0): Promise<ScannerSummary | null> {
    try {
      const res = await fetch(`/api/scanner/xau-usd?interval=${encodeURIComponent(timeframe)}&minRR=${minRR}`);
      if (!res.ok) {
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  }

  scanXauUsdCandles(intel: XauUsdMarketIntelligence, candles: Candle[], config?: Partial<ScannerConfig>): ScannerSummary {
    return setupScannerEngine.scan(intel, candles, config);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.provider.getConnectionStatus();
  }

  getMarketDataStatus(): MarketDataStatus {
    return this.provider.getMarketDataStatus();
  }

  getAllQuotes(): Record<string, InstrumentQuote> {
    return this.provider.getAllQuotes();
  }

  getQuote(symbol: string): InstrumentQuote {
    return this.provider.getQuote(symbol) ?? {
      symbol,
      provider: 'Twelve Data',
      ltp: null,
      changePercent: null,
      bid: null,
      ask: null,
      spreadPips: null,
      timestamp: null,
      status: 'NOT CONNECTED',
      source: 'Twelve Data API',
      freshness: 'NONE',
    };
  }

  async connect(): Promise<void> {
    await this.provider.connect();
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect();
  }

  async refreshNow(): Promise<void> {
    if (this.provider instanceof twelveDataMarketDataProvider.constructor) {
      await (this.provider as typeof twelveDataMarketDataProvider).refreshNow();
    }
  }

  getTelemetry(): ProviderTelemetry | null {
    if ('getTelemetry' in this.provider && typeof (this.provider as typeof twelveDataMarketDataProvider).getTelemetry === 'function') {
      return (this.provider as typeof twelveDataMarketDataProvider).getTelemetry();
    }
    return null;
  }

  async getHistoricalCandles(symbol: string, timeframe: string): Promise<Candle[]> {
    return this.provider.getHistoricalCandles(symbol, timeframe);
  }

  async getCandleSeries(symbol: string, timeframe: string): Promise<CandleSeriesResponse> {
    if ('getCandleSeries' in this.provider && typeof (this.provider as any).getCandleSeries === 'function') {
      return (this.provider as any).getCandleSeries(symbol, timeframe);
    }
    const candles = await this.provider.getHistoricalCandles(symbol, timeframe);
    return {
      candles,
      isVerified: candles.length > 0,
      error: null,
      source: this.provider.name,
    };
  }

  async syncForwardXauUsdCandles(): Promise<void> {
    try {
      const res = await this.getCandleSeries('XAU/USD', '15min');
      if (res.isVerified && Array.isArray(res.candles) && res.candles.length > 0) {
        const nowMs = Date.now();
        // 1. Sort strictly ascending by timestamp (oldest first, newest last)
        const sortedCandles = [...res.candles].sort((a, b) => a.timestamp - b.timestamp);

        // 2. Identify the latest confirmed candle timestamp to prevent chronological regression
        const lastConfirmed = forwardPaperEngine.getStatus().lastCandle;
        const lastConfirmedTs = lastConfirmed ? lastConfirmed.timestamp : 0;

        for (const candle of sortedCandles) {
          // Never evaluate future-dated candles
          if (candle.timestamp > nowMs) continue;

          // Never regress chronologically or re-process confirmed candles:
          if (lastConfirmedTs > 0 && candle.timestamp <= lastConfirmedTs) {
            continue;
          }
          if (forwardPaperEngine.hasProcessedCandle(candle.timestamp)) {
            continue;
          }

          forwardPaperEngine.processCandle(candle, nowMs);
        }
      }
    } catch {
      // Safe simulation wrapper
    }
  }

  onQuoteUpdate(listener: (quote: InstrumentQuote) => void): () => void {
    return this.provider.onQuoteUpdate(listener);
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    return this.provider.onStatusChange(listener);
  }

  onTelemetryUpdate(listener: (telemetry: ProviderTelemetry) => void): () => void {
    if ('onTelemetryUpdate' in this.provider && typeof (this.provider as typeof twelveDataMarketDataProvider).onTelemetryUpdate === 'function') {
      return (this.provider as typeof twelveDataMarketDataProvider).onTelemetryUpdate(listener);
    }
    return () => {};
  }

  getMarketSessions(): MarketSessionInfo[] {
    return DEFAULT_MARKET_SESSIONS;
  }

  getMarketIntelligence(): MarketIntelligenceMetrics {
    return {
      regime: null,
      volatility: null,
      marketStructure: null,
      liquidityCondition: null,
      trendState: null,
      status: 'WAITING FOR VERIFIED DATA',
    };
  }

  getSetupStatus(): SetupStatusInfo {
    return {
      hasValidatedSetup: false,
      message: 'No validated setup.',
      lastEvaluatedAt: null,
      activeFiltersCount: 0,
      validationChecklist: [
        { label: 'Twelve Data Verified Feed', passed: this.provider.getConnectionStatus() === 'CONNECTED', statusText: this.provider.getConnectionStatus() },
        { label: 'Market Structure Alignment', passed: false, statusText: 'No Strategy Active' },
        { label: 'Session Liquidity Confluence', passed: false, statusText: 'Phase 2 Real-Data Only' },
        { label: 'Risk/Reward Boundary Check', passed: false, statusText: 'Standing By' },
      ],
    };
  }

  getProviderName(): string {
    return this.provider.name;
  }
}

export const marketService = new MarketService();

