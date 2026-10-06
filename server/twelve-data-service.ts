import { NormalizedMarketQuote } from '../src/types/terminal';
import { twelveDataRequestManager, RateLimitTelemetry } from './twelve-data-request-manager';
import { 
  ACTIVE_INSTRUMENTS, 
  ACTIVE_SECONDARY_INSTRUMENTS, 
  AVAILABLE_INSTRUMENTS, 
  INSTRUMENT_PRIORITY 
} from '../src/config/watchlist-config';
import { normalizeAndSortCandles, TIMEFRAME_MAP } from '../src/utils/candle-integrity';
import { Candle } from '../src/market-data/provider.interface';

interface TwelveDataQuoteResponse {
  symbol?: string;
  name?: string;
  exchange?: string;
  datetime?: string;
  timestamp?: number;
  last_quote_at?: number;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  is_market_open?: boolean;
  code?: number;
  message?: string;
  status?: string;
}

export class TwelveDataService {
  private apiKey: string;
  private isUserConfiguredKey: boolean;
  private quotesCache: Record<string, NormalizedMarketQuote> = {};
  private candlesCache: Record<string, { candles: Candle[]; cachedAt: number; error: string | null }> = {};
  private lastFetchTime: number = 0;
  private inFlightQuotesPromise: Promise<Record<string, NormalizedMarketQuote>> | null = null;
  
  // Rotating pair index for controlled credit budgeting (XAU/USD is always #1 priority)
  private pairRotationIndex = 0;

  // Active instruments defined centrally: XAU/USD (Priority 1), EUR/USD, GBP/USD, USD/JPY (Priority 2)
  private readonly activeInstruments = ACTIVE_INSTRUMENTS;
  private readonly secondaryInstruments = ACTIVE_SECONDARY_INSTRUMENTS;
  // All supported instruments preserved for future expansion
  private readonly availableInstruments = AVAILABLE_INSTRUMENTS;

  constructor() {
    const envKey = process.env.TWELVE_DATA_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      this.apiKey = envKey.trim();
      this.isUserConfiguredKey = true;
    } else {
      this.apiKey = 'demo';
      this.isUserConfiguredKey = false;
    }

    // Initialize clean unverified quotes strictly for active instruments
    for (const sym of this.activeInstruments) {
      this.quotesCache[sym] = {
        symbol: sym,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'WAITING',
        error: 'Awaiting scheduled Twelve Data request slot',
        isMarketOpen: null,
      };
    }
  }

  public getRateLimitTelemetry(): RateLimitTelemetry {
    return twelveDataRequestManager.getTelemetry();
  }

  public getStatus() {
    const quotes = Object.values(this.quotesCache);
    const telemetry = twelveDataRequestManager.getTelemetry();

    const hasLive = quotes.some(q => q.status === 'LIVE');
    const hasStale = quotes.some(q => q.status === 'STALE');
    const anyRateLimited = telemetry.isRateLimited || quotes.some(q => q.status === 'RATE LIMITED');
    
    let aggregateStatus: 'LIVE' | 'STALE' | 'RATE LIMITED' | 'NOT CONNECTED' = 'NOT CONNECTED';
    if (anyRateLimited && !hasLive) {
      // RULE 6: When exhausted: RATE LIMITED — WAITING FOR RESET. Do not label this as NOT CONNECTED.
      aggregateStatus = 'RATE LIMITED';
    } else if (hasLive) {
      aggregateStatus = 'LIVE';
    } else if (hasStale) {
      aggregateStatus = 'STALE';
    }

    return {
      provider: 'Twelve Data',
      status: aggregateStatus,
      isConfigured: this.isUserConfiguredKey,
      hasDemoFallback: !this.isUserConfiguredKey,
      lastUpdated: this.lastFetchTime > 0 ? new Date(this.lastFetchTime).toISOString() : null,
      nextScheduledUpdateMs: telemetry.nextResetSeconds * 1000,
      supportedSymbolsCount: this.activeInstruments.length,
      cachedSymbolsCount: Object.keys(this.quotesCache).filter(k => this.quotesCache[k].price !== null).length,
      rateLimit: telemetry,
    };
  }

  /**
   * Strict Validator for Twelve Data quotes.
   * Zero-fabrication enforcement.
   */
  private validateAndNormalizeQuote(
    symbol: string, 
    data: TwelveDataQuoteResponse | null, 
    requestError: string | null,
    isRateLimited: boolean = false
  ): NormalizedMarketQuote {
    // 1. Rate Limited handling (RULE 7: If Twelve Data returns HTTP 429: status RATE LIMITED)
    if (isRateLimited || (data && (data.code === 429 || (data.message && data.message.includes('run out of API credits'))))) {
      // If we previously had a valid quote for this symbol, keep its price and mark RATE LIMITED with note
      const existing = this.quotesCache[symbol];
      if (existing && existing.price !== null) {
        return {
          ...existing,
          status: 'RATE LIMITED',
          rateLimited: true,
          error: requestError || data?.message || 'Rate limit budget exhausted (8 req/min ceiling). Waiting for provider reset.',
        };
      }

      return {
        symbol,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'RATE LIMITED',
        rateLimited: true,
        error: requestError || data?.message || 'Rate limit budget exhausted (8 req/min ceiling). Waiting for provider reset.',
        isMarketOpen: null,
      };
    }

    // 2. Connection / Request Error
    if (requestError || !data) {
      const existing = this.quotesCache[symbol];
      if (existing && existing.price !== null) {
        return {
          ...existing,
          status: 'STALE',
          error: requestError || 'Error updating quote; preserving last verified data',
        };
      }

      return {
        symbol,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'NOT CONNECTED',
        error: requestError || 'No response from Twelve Data',
        isMarketOpen: null,
      };
    }

    // 3. Twelve Data API error response (e.g. 401 unauthorized, invalid symbol)
    if (data.status === 'error' || data.code !== undefined) {
      return {
        symbol,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'NOT CONNECTED',
        error: data.message || `Twelve Data API Error (${data.code || 'UNKNOWN'})`,
        isMarketOpen: null,
      };
    }

    // 4. Structural validation
    const rawPrice = data.close ?? (data as Record<string, unknown>).price;
    const priceNum = typeof rawPrice === 'string' ? parseFloat(rawPrice) : (typeof rawPrice === 'number' ? rawPrice : null);
    
    // Price must exist and be strictly > 0
    if (priceNum === null || isNaN(priceNum) || priceNum <= 0) {
      return {
        symbol,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'INVALID',
        error: 'Price missing, corrupted, or non-positive',
        isMarketOpen: data.is_market_open ?? null,
      };
    }

    // Timestamp verification
    const rawSourceTimestamp = data.last_quote_at ?? data.timestamp;
    if (!rawSourceTimestamp || isNaN(rawSourceTimestamp)) {
      return {
        symbol,
        provider: 'Twelve Data',
        price: null,
        changePercent: null,
        bid: null,
        ask: null,
        spreadPips: null,
        timestamp: null,
        sourceTimestamp: null,
        status: 'INVALID',
        error: 'Quote timestamp missing from provider payload',
        isMarketOpen: data.is_market_open ?? null,
      };
    }

    // Freshness evaluation: Fresh within 15 minutes (900 seconds)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ageSeconds = Math.abs(nowSeconds - rawSourceTimestamp);
    const isFresh = ageSeconds <= 900;
    const isMarketOpen = data.is_market_open !== false;

    const dataStatus: 'LIVE' | 'STALE' = (isFresh && isMarketOpen) ? 'LIVE' : 'STALE';

    const changePercentNum = data.percent_change 
      ? parseFloat(data.percent_change) 
      : (data.change && data.previous_close ? (parseFloat(data.change) / parseFloat(data.previous_close)) * 100 : null);

    const dateObj = new Date(rawSourceTimestamp * 1000);
    const isoTimestamp = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : (data.datetime || new Date().toISOString());

    return {
      symbol,
      provider: 'Twelve Data',
      price: priceNum,
      changePercent: changePercentNum !== null && !isNaN(changePercentNum) ? changePercentNum : null,
      bid: null,
      ask: null,
      spreadPips: null,
      timestamp: isoTimestamp,
      sourceTimestamp: rawSourceTimestamp,
      status: dataStatus,
      error: null,
      isMarketOpen: data.is_market_open ?? null,
      open: data.open ? parseFloat(data.open) : null,
      high: data.high ? parseFloat(data.high) : null,
      low: data.low ? parseFloat(data.low) : null,
      previousClose: data.previous_close ? parseFloat(data.previous_close) : null,
    };
  }

  /**
   * Fetches real quote for a single symbol using TwelveDataRequestManager
   */
  public async fetchSingleQuote(
    symbol: string,
    priority: number = 2,
    maxCacheAgeMs: number = 30000
  ): Promise<NormalizedMarketQuote> {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&timezone=UTC&apikey=${this.apiKey}`;
    
    const result = await twelveDataRequestManager.execute<TwelveDataQuoteResponse>(
      url,
      priority,
      maxCacheAgeMs
    );

    if (result.rateLimited) {
      const quote = this.validateAndNormalizeQuote(symbol, result.data, result.error || null, true);
      this.quotesCache[symbol] = quote;
      return quote;
    }

    if (result.error && !result.data) {
      const quote = this.validateAndNormalizeQuote(symbol, null, result.error, false);
      this.quotesCache[symbol] = quote;
      return quote;
    }

    const quote = this.validateAndNormalizeQuote(symbol, result.data, null, false);
    this.quotesCache[symbol] = quote;
    return quote;
  }

  /**
   * Controlled Request Scheduler & Smart Rotation:
   * 
   * RULE 1: Never exceed 8 requests / minute.
   * RULE 4: Do NOT poll all 8 instruments every 45 seconds. Use controlled rotation.
   * RULE 5: XAU/USD is Priority #1. Always allocate an execution slot to XAU/USD if needed.
   * 
   * If budget remaining is <= 1, ONLY fetch XAU/USD.
   * If budget allows (e.g. 2 slots available), fetch XAU/USD (prio 1) + next rotated pair (prio 2).
   */
  public async getQuotes(forceRefresh: boolean = false): Promise<Record<string, NormalizedMarketQuote>> {
    // If in-flight, await existing promise
    if (this.inFlightQuotesPromise) {
      return this.inFlightQuotesPromise;
    }

    this.inFlightQuotesPromise = (async () => {
      try {
        const telemetry = twelveDataRequestManager.getTelemetry();

        // If rate limited and waiting for reset, immediately serve existing cache with updated rate-limit status
        if (telemetry.isRateLimited) {
          for (const sym of this.activeInstruments) {
            if (this.quotesCache[sym]) {
              const current = this.quotesCache[sym];
              this.quotesCache[sym] = {
                ...current,
                status: current.price !== null ? 'RATE LIMITED' : (current.status === 'WAITING' ? 'WAITING' : 'RATE LIMITED'),
                rateLimited: true,
                error: `Twelve Data rate limit budget exhausted (${telemetry.requestsThisMinute}/8 used). Reset in ${telemetry.nextResetSeconds}s. Previously verified data preserved.`,
              };
            }
          }
          return this.quotesCache;
        }

        // Determine how many requests we can safely execute in this cycle
        // We reserve at least 1 credit for XAU/USD, and never burst more than 2-3 requests at a time
        const availableCredits = telemetry.remainingCredits;
        if (availableCredits <= 0) {
          return this.quotesCache;
        }

        // 1. ALWAYS Refresh XAU/USD first (Priority #1)
        const xauCacheAge = forceRefresh ? 0 : 25000; // 25s cache for XAU/USD
        await this.fetchSingleQuote('XAU/USD', 1, xauCacheAge);

        // 2. Controlled fair rotation among the 3 active secondary pairs: EUR/USD, GBP/USD, USD/JPY
        const updatedTelemetry = twelveDataRequestManager.getTelemetry();
        if (updatedTelemetry.remainingCredits > 0) {
          const secondaryPairs = this.secondaryInstruments;
          const nextPair = secondaryPairs[this.pairRotationIndex % secondaryPairs.length];
          this.pairRotationIndex = (this.pairRotationIndex + 1) % secondaryPairs.length;

          const otherPairCacheAge = forceRefresh ? 0 : 45000; // 45s cache for secondary pairs
          await this.fetchSingleQuote(nextPair, 2, otherPairCacheAge);

          // Fast startup warming: If credits are abundant (>= 4) and an active secondary pair has never received data,
          // fetch that uninitialized pair to prevent prolonged WAITING states on boot
          const postFetchTelemetry = twelveDataRequestManager.getTelemetry();
          if (postFetchTelemetry.remainingCredits >= 4) {
            const uninitialized = secondaryPairs.find(p => this.quotesCache[p]?.price === null && p !== nextPair);
            if (uninitialized) {
              await this.fetchSingleQuote(uninitialized, 2, otherPairCacheAge);
            }
          }
        }

        this.lastFetchTime = Date.now();
        return this.quotesCache;
      } finally {
        this.inFlightQuotesPromise = null;
      }
    })();

    return this.inFlightQuotesPromise;
  }

  /**
   * Fetches real historical candles from Twelve Data time_series endpoint.
   * Uses TwelveDataRequestManager with Priority 1 for XAU/USD.
   */
  public async getCandles(
    symbol: string = 'XAU/USD', 
    interval: string = '15min'
  ): Promise<{
    candles: Candle[];
    error: string | null;
    isVerified: boolean;
    rateLimited?: boolean;
    source: string;
    meta?: {
      symbol: string;
      interval: string;
      timezone: string;
      candleCount: number;
      latestTimestamp: number | null;
      latestDatetime: string | null;
      dataStatus: 'LIVE' | 'CACHE' | 'HISTORICAL' | 'RATE LIMITED';
      lastFetchedAt: string;
      isCached: boolean;
    };
  }> {
    const tdInterval = TIMEFRAME_MAP[interval] || '15min';
    const cacheKey = `${symbol}_${tdInterval}`;
    const cached = this.candlesCache[cacheKey];
    
    // 60-second cache for fresh candles
    if (cached && (Date.now() - cached.cachedAt < 60000) && cached.candles && cached.candles.length > 0) {
      const latest = cached.candles[cached.candles.length - 1];
      // Never serve future-dated cached candles
      if (!latest || latest.timestamp <= Date.now()) {
        return {
          candles: cached.candles,
          error: cached.error,
          isVerified: true,
          rateLimited: false,
          source: 'Twelve Data API',
          meta: {
            symbol,
            interval: tdInterval,
            timezone: 'UTC',
            candleCount: cached.candles.length,
            latestTimestamp: latest ? latest.timestamp : null,
            latestDatetime: latest ? latest.datetime || null : null,
            dataStatus: 'CACHE',
            lastFetchedAt: new Date(cached.cachedAt).toISOString(),
            isCached: true,
          },
        };
      }
    }

    try {
      // 100 historical bars for rich chart depth & multi-session analysis in strict UTC
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${tdInterval}&outputsize=100&timezone=UTC&apikey=${this.apiKey}`;
      
      const priority = symbol === 'XAU/USD' ? 1 : 3;
      const res = await twelveDataRequestManager.execute<{
        status?: string;
        message?: string;
        code?: number;
        meta?: {
          symbol?: string;
          interval?: string;
          currency_base?: string;
          currency_quote?: string;
          exchange?: string;
          type?: string;
          timezone?: string;
        };
        values?: Array<{
          datetime: string;
          open: string;
          high: string;
          low: string;
          close: string;
          volume?: string;
        }>;
      }>(url, priority, 60000);

      // RATE LIMITED HANDLING:
      if (res.rateLimited) {
        const errorMsg = res.error || 'Rate limit budget exhausted (8/8). Real candle fetch deferred.';
        
        // Preserve previously verified cached candles
        if (cached && cached.candles && cached.candles.length > 0) {
          const latest = cached.candles[cached.candles.length - 1];
          return {
            candles: cached.candles,
            error: errorMsg,
            isVerified: true,
            rateLimited: true,
            source: 'Twelve Data API (Cache Preserved)',
            meta: {
              symbol,
              interval: tdInterval,
              timezone: 'UTC',
              candleCount: cached.candles.length,
              latestTimestamp: latest ? latest.timestamp : null,
              latestDatetime: latest ? latest.datetime || null : null,
              dataStatus: 'RATE LIMITED',
              lastFetchedAt: new Date(cached.cachedAt).toISOString(),
              isCached: true,
            },
          };
        }

        // If request manager returned cached raw data with values, parse it
        if (res.data?.values && Array.isArray(res.data.values)) {
          const { candles: parsedCandles } = normalizeAndSortCandles(res.data.values);

          if (parsedCandles.length > 0) {
            this.candlesCache[cacheKey] = { candles: parsedCandles, cachedAt: Date.now(), error: null };
            const latest = parsedCandles[parsedCandles.length - 1];
            return {
              candles: parsedCandles,
              error: errorMsg,
              isVerified: true,
              rateLimited: true,
              source: 'Twelve Data API (Rate Limited Cache)',
              meta: {
                symbol,
                interval: tdInterval,
                timezone: 'UTC',
                candleCount: parsedCandles.length,
                latestTimestamp: latest ? latest.timestamp : null,
                latestDatetime: latest ? latest.datetime || null : null,
                dataStatus: 'RATE LIMITED',
                lastFetchedAt: new Date().toISOString(),
                isCached: true,
              },
            };
          }
        }

        return {
          candles: [],
          error: errorMsg,
          isVerified: false,
          rateLimited: true,
          source: 'Twelve Data API',
          meta: {
            symbol,
            interval: tdInterval,
            timezone: 'UTC',
            candleCount: 0,
            latestTimestamp: null,
            latestDatetime: null,
            dataStatus: 'RATE LIMITED',
            lastFetchedAt: new Date().toISOString(),
            isCached: false,
          },
        };
      }

      const data = res.data;
      if (!data || data.status === 'error' || !data.values || !Array.isArray(data.values)) {
        const errorMsg = data?.message || res.error || `Twelve Data historical candles unavailable for ${symbol}`;
        if (cached && cached.candles && cached.candles.length > 0) {
          const latest = cached.candles[cached.candles.length - 1];
          return {
            candles: cached.candles,
            error: errorMsg,
            isVerified: true,
            source: 'Twelve Data API (Cache Fallback)',
            meta: {
              symbol,
              interval: tdInterval,
              timezone: 'UTC',
              candleCount: cached.candles.length,
              latestTimestamp: latest ? latest.timestamp : null,
              latestDatetime: latest ? latest.datetime || null : null,
              dataStatus: 'CACHE',
              lastFetchedAt: new Date(cached.cachedAt).toISOString(),
              isCached: true,
            },
          };
        }
        this.candlesCache[cacheKey] = { candles: [], cachedAt: Date.now(), error: errorMsg };
        return {
          candles: [],
          error: errorMsg,
          isVerified: false,
          source: 'Twelve Data API',
          meta: {
            symbol,
            interval: tdInterval,
            timezone: 'UTC',
            candleCount: 0,
            latestTimestamp: null,
            latestDatetime: null,
            dataStatus: 'HISTORICAL',
            lastFetchedAt: new Date().toISOString(),
            isCached: false,
          },
        };
      }

      // Step 3: Validate, deduplicate, and sort chronologically (oldest to newest)
      const { candles, rejectedCount, rejectionDetails } = normalizeAndSortCandles(data.values);

      if (rejectedCount > 0) {
        console.warn(`[TWELVE_DATA] Rejected ${rejectedCount} malformed candle(s) for ${symbol} ${tdInterval}:`, rejectionDetails);
      }

      this.candlesCache[cacheKey] = { candles, cachedAt: Date.now(), error: null };
      const latest = candles[candles.length - 1];

      return {
        candles,
        error: null,
        isVerified: candles.length > 0,
        rateLimited: false,
        source: 'Twelve Data API',
        meta: {
          symbol,
          interval: tdInterval,
          timezone: 'UTC',
          candleCount: candles.length,
          latestTimestamp: latest ? latest.timestamp : null,
          latestDatetime: latest ? latest.datetime || null : null,
          dataStatus: 'LIVE',
          lastFetchedAt: new Date().toISOString(),
          isCached: false,
        },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error fetching candles from Twelve Data';
      if (cached && cached.candles && cached.candles.length > 0) {
        const latest = cached.candles[cached.candles.length - 1];
        return {
          candles: cached.candles,
          error: errorMsg,
          isVerified: true,
          source: 'Twelve Data API (Cache Fallback)',
          meta: {
            symbol,
            interval: tdInterval,
            timezone: 'UTC',
            candleCount: cached.candles.length,
            latestTimestamp: latest ? latest.timestamp : null,
            latestDatetime: latest ? latest.datetime || null : null,
            dataStatus: 'CACHE',
            lastFetchedAt: new Date(cached.cachedAt).toISOString(),
            isCached: true,
          },
        };
      }
      return {
        candles: [],
        error: errorMsg,
        isVerified: false,
        source: 'Twelve Data API',
        meta: {
          symbol,
          interval: tdInterval,
          timezone: 'UTC',
          candleCount: 0,
          latestTimestamp: null,
          latestDatetime: null,
          dataStatus: 'HISTORICAL',
          lastFetchedAt: new Date().toISOString(),
          isCached: false,
        },
      };
    }
  }
}

export const twelveDataService = new TwelveDataService();
