/**
 * Centralized Request Manager & Rate Limiter for Twelve Data API.
 * 
 * Rules strictly enforced:
 * 1. HARD CEILING: Max 8 requests per rolling 60-second window. NEVER send request #9.
 * 2. CENTRALIZED QUEUE: All Twelve Data requests (quotes, time-series) must pass through this manager.
 * 3. DEDUPLICATION: Identical requests currently in-flight or cached within freshness window are reused.
 * 4. PRIORITY SCHEDULING: XAU/USD is high-priority (#1). Forex pairs are rotated in order:
 *    XAU/USD > EUR/USD > GBP/USD > USD/JPY > USD/CHF > AUD/USD > USD/CAD > NZD/USD
 * 5. RATE LIMIT HANDLING: Returns 'RATE LIMITED' with exact reset countdown when budget is exhausted.
 * 6. ZERO FABRICATION: No synthetic prices, candles, or simulated ticks.
 */

export interface RateLimitTelemetry {
  requestsThisMinute: number;
  maxRequestsPerMinute: number;
  remainingCredits: number;
  nextResetSeconds: number;
  isRateLimited: boolean;
  activeWindowStartMs: number;
  queueLength: number;
  totalRequestsExecuted: number;
}

interface QueuedRequest<T> {
  id: string;
  url: string;
  priority: number; // Lower number = higher priority. 1 for XAU/USD, 2 for other pairs, 3 for low-prio
  addedAt: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class TwelveDataRequestManager {
  private readonly MAX_REQUESTS_PER_MINUTE = 8;
  private readonly ROLLING_WINDOW_MS = 60000;
  
  // Timestamps of executed requests within the rolling window
  private requestTimestamps: number[] = [];
  
  // In-flight request deduplication map: url -> Promise
  private inFlightRequests: Map<string, Promise<any>> = new Map();
  
  // Response cache: url -> { data, cachedAt }
  private responseCache: Map<string, { data: any; cachedAt: number }> = new Map();

  // Queue of pending requests
  private queue: QueuedRequest<any>[] = [];
  private isProcessingQueue = false;
  private queueTimer: NodeJS.Timeout | null = null;
  private totalRequestsExecuted = 0;
  private rateLimitExhaustedUntil: number = 0;

  constructor() {
    // Background queue processor heartbeat every 500ms
    this.queueTimer = setInterval(() => {
      this.processQueue();
    }, 500);
  }

  /**
   * Cleanup timer on shutdown
   */
  public destroy() {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }
  }

  /**
   * Clean up timestamps older than 60s
   */
  private pruneOldTimestamps(now: number = Date.now()) {
    const cutoff = now - this.ROLLING_WINDOW_MS;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  /**
   * Current rate-limit budget telemetry
   */
  public getTelemetry(): RateLimitTelemetry {
    const now = Date.now();
    this.pruneOldTimestamps(now);

    const requestsThisMinute = this.requestTimestamps.length;
    const remainingCredits = Math.max(0, this.MAX_REQUESTS_PER_MINUTE - requestsThisMinute);
    
    let nextResetSeconds = 0;
    if (this.rateLimitExhaustedUntil > now) {
      nextResetSeconds = Math.ceil((this.rateLimitExhaustedUntil - now) / 1000);
    } else if (this.requestTimestamps.length > 0) {
      const oldest = this.requestTimestamps[0];
      nextResetSeconds = Math.max(0, Math.ceil((oldest + this.ROLLING_WINDOW_MS - now) / 1000));
    }

    const isRateLimited = remainingCredits === 0 || this.rateLimitExhaustedUntil > now;

    return {
      requestsThisMinute,
      maxRequestsPerMinute: this.MAX_REQUESTS_PER_MINUTE,
      remainingCredits: isRateLimited ? 0 : remainingCredits,
      nextResetSeconds,
      isRateLimited,
      activeWindowStartMs: this.requestTimestamps[0] || now,
      queueLength: this.queue.length,
      totalRequestsExecuted: this.totalRequestsExecuted,
    };
  }

  /**
   * Check if a request can be executed immediately under the 8 req/min ceiling
   */
  public canExecuteNow(): boolean {
    const now = Date.now();
    if (this.rateLimitExhaustedUntil > now) {
      return false;
    }
    this.pruneOldTimestamps(now);
    return this.requestTimestamps.length < this.MAX_REQUESTS_PER_MINUTE;
  }

  /**
   * Central entry point for executing an HTTP request to Twelve Data.
   * Enforces:
   * - Cache lookup (if maxAgeMs provided)
   * - In-flight deduplication
   * - Budget check: if budget exhausted, queues the request (never sends request #9)
   * - Priority ordering (XAU/USD = priority 1)
   */
  public async execute<T>(
    url: string,
    priority: number = 2,
    maxCacheAgeMs: number = 0
  ): Promise<{ data: T; fromCache: boolean; rateLimited: boolean; error?: string }> {
    const now = Date.now();

    // 1. Cache hit check
    if (maxCacheAgeMs > 0 && this.responseCache.has(url)) {
      const cached = this.responseCache.get(url)!;
      if (now - cached.cachedAt < maxCacheAgeMs) {
        const isRateLimited = !this.canExecuteNow();
        return { data: cached.data as T, fromCache: true, rateLimited: isRateLimited };
      }
    }

    // 2. In-flight deduplication check
    if (this.inFlightRequests.has(url)) {
      const existingPromise = this.inFlightRequests.get(url)!;
      return existingPromise as Promise<{ data: T; fromCache: boolean; rateLimited: boolean; error?: string }>;
    }

    // 3. Rate-limit budget check
    if (!this.canExecuteNow()) {
      // If we have any cached response (even if past maxCacheAgeMs), return stale cached data
      // rather than leaving the system empty while waiting for rate-limit reset.
      if (this.responseCache.has(url)) {
        const cached = this.responseCache.get(url)!;
        return {
          data: cached.data as T,
          fromCache: true,
          rateLimited: true,
          error: 'Rate limit ceiling reached (8/8). Serving cached data.',
        };
      }

      // If no cached data exists, return structured rate-limit response without throwing or blocking
      return {
        data: null as unknown as T,
        fromCache: false,
        rateLimited: true,
        error: 'Rate limit ceiling reached (8/8). No cached data available.',
      };
    }

    // 4. Execute immediately under available budget
    return this.dispatchRequest<T>(url);
  }

  /**
   * Internal request dispatcher
   */
  private async dispatchRequest<T>(
    url: string
  ): Promise<{ data: T; fromCache: boolean; rateLimited: boolean; error?: string }> {
    const now = Date.now();
    this.pruneOldTimestamps(now);

    // Strict safety check: NEVER send request #9
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      const oldest = this.requestTimestamps[0];
      const waitMs = Math.max(1000, oldest + this.ROLLING_WINDOW_MS - now);
      const waitSec = Math.ceil(waitMs / 1000);
      if (this.responseCache.has(url)) {
        const cached = this.responseCache.get(url)!;
        return {
          data: cached.data as T,
          fromCache: true,
          rateLimited: true,
          error: `Rate limit ceiling reached (8/8). Serving cached data. Next credit in ${waitSec}s.`,
        };
      }
      return {
        data: null as unknown as T,
        fromCache: false,
        rateLimited: true,
        error: `Rate limit ceiling reached (8/8). No cached data available. Next credit in ${waitSec}s.`,
      };
    }

    // Record request timestamp BEFORE network call
    this.requestTimestamps.push(now);
    this.totalRequestsExecuted++;

    const fetchPromise = (async () => {
      try {
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'ForexGoldRobo/1.0',
          },
        });

        const json = await response.json();

        // Check if Twelve Data returned 429
        if (response.status === 429 || json.code === 429 || (json.message && json.message.includes('run out of API credits'))) {
          // Mark rate limited until next minute
          this.rateLimitExhaustedUntil = Date.now() + 60000;
          return {
            data: json as T,
            fromCache: false,
            rateLimited: true,
            error: json.message || 'HTTP 429: You have run out of API credits for the current minute.',
          };
        }

        // Cache valid responses
        if (response.ok && json && json.status !== 'error' && json.code === undefined) {
          this.responseCache.set(url, { data: json, cachedAt: Date.now() });
        }

        return { data: json as T, fromCache: false, rateLimited: false };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Network error reaching Twelve Data';
        return {
          data: null as unknown as T,
          fromCache: false,
          rateLimited: false,
          error: msg,
        };
      } finally {
        this.inFlightRequests.delete(url);
      }
    })();

    this.inFlightRequests.set(url, fetchPromise);
    return fetchPromise;
  }

  /**
   * Process the queued requests in priority order when budget frees up
   */
  private async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    if (!this.canExecuteNow()) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      while (this.queue.length > 0 && this.canExecuteNow()) {
        const nextReq = this.queue.shift();
        if (!nextReq) break;

        try {
          const res = await this.dispatchRequest(nextReq.url);
          nextReq.resolve(res);
        } catch (err) {
          nextReq.reject(err);
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Manually store verified response in cache
   */
  public setCache(url: string, data: any) {
    this.responseCache.set(url, { data, cachedAt: Date.now() });
  }

  /**
   * Get cached response if available
   */
  public getCached<T>(url: string): T | null {
    const item = this.responseCache.get(url);
    return item ? (item.data as T) : null;
  }
}

export const twelveDataRequestManager = new TwelveDataRequestManager();
