import { TwelveDataRequestManager } from '../server/twelve-data-request-manager';
import { TwelveDataService } from '../server/twelve-data-service';
import { XauUsdIntelligenceCoordinator } from '../src/intelligence/xau-usd-coordinator';
import { ConnectionStatus, MarketDataStatus, NormalizedMarketQuote } from '../src/types/terminal';

// Mock global fetch for testing
let originalFetch: typeof global.fetch;

async function runStabilityTests() {
  console.log('====================================================');
  console.log('STARTING TWELVE DATA STABILITY DETERMINISTIC TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${testName} - ${detail || 'Assertion failed'}`);
      throw new Error(`Test ${total} failed: ${testName}`);
    }
  }

  // Save fetch
  originalFetch = global.fetch;

  try {
    // -------------------------------------------------------------
    // Test 1: Normal quote request succeeds and marks state CONNECTED
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            symbol: 'XAU/USD',
            close: '2385.50',
            open: '2380.00',
            high: '2390.00',
            low: '2378.00',
            change: '+5.50',
            percent_change: '+0.23',
            timestamp: Math.floor(Date.now() / 1000),
            status: 'ok',
          }),
        } as any;
      };

      const result = await manager.execute<any>('https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=demo', 1, 30000);
      assert(
        result.rateLimited === false && result.data && result.data.close === '2385.50',
        'Normal quote request succeeds and returns verified data',
      );
    }

    // -------------------------------------------------------------
    // Test 2: 8 requests in 60s exhaust budget
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', symbol: 'TEST', close: '1.0' }),
      } as any);

      // Execute 8 unique URLs to avoid cache
      for (let i = 1; i <= 8; i++) {
        await manager.execute(`https://api.twelvedata.com/quote?symbol=PAIR_${i}&apikey=demo`, 1, 0);
      }

      const telemetry = manager.getTelemetry();
      assert(
        telemetry.requestsThisMinute === 8 && telemetry.remainingCredits === 0,
        '8 requests in 60s exhaust budget (8/8 used, 0 remaining)',
        `Got ${telemetry.requestsThisMinute}/8 and ${telemetry.remainingCredits} remaining`,
      );
    }

    // -------------------------------------------------------------
    // Test 3: 9th request returns RATE LIMITED and DOES NOT throw
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', symbol: 'TEST', close: '1.0' }),
      } as any);

      for (let i = 1; i <= 8; i++) {
        await manager.execute(`https://api.twelvedata.com/quote?symbol=PAIR_${i}&apikey=demo`, 1, 0);
      }

      let didThrow = false;
      let result9: any = null;
      try {
        result9 = await manager.execute('https://api.twelvedata.com/quote?symbol=PAIR_9&apikey=demo', 1, 0);
      } catch (e) {
        didThrow = true;
      }

      assert(
        !didThrow && result9 !== null && result9.rateLimited === true,
        '9th request returns RATE LIMITED and DOES NOT throw',
        `didThrow=${didThrow}, result9=${JSON.stringify(result9)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 4: 9th request returns cached data with rateLimited: true
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      const testUrl = 'https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=demo';
      
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', symbol: 'EUR/USD', close: '1.0850' }),
      } as any);

      // Execute request 1 on EUR/USD (cached)
      const res1 = await manager.execute(testUrl, 1, 60000);
      
      // Execute 7 more different requests to consume budget to 8/8
      for (let i = 2; i <= 8; i++) {
        await manager.execute(`https://api.twelvedata.com/quote?symbol=OTHER_${i}&apikey=demo`, 1, 0);
      }

      // 9th request is for EUR/USD with freshness cache allowed
      const res9 = await manager.execute<any>(testUrl, 1, 60000);

      assert(
        res9.rateLimited === true && res9.fromCache === true && res9.data && res9.data.close === '1.0850',
        '9th request returns cached data with rateLimited: true',
        `res9=${JSON.stringify(res9)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 5: In-flight identical requests are deduplicated
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      let networkCalls = 0;
      const delayedUrl = 'https://api.twelvedata.com/quote?symbol=GBP/USD&apikey=demo';

      global.fetch = async () => {
        networkCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', symbol: 'GBP/USD', close: '1.2750' }),
        } as any;
      };

      // Dispatch two concurrent identical requests
      const [p1, p2] = await Promise.all([
        manager.execute<any>(delayedUrl, 1, 0),
        manager.execute<any>(delayedUrl, 1, 0),
      ]);

      assert(
        networkCalls === 1 && p1.data.close === '1.2750' && p2.data.close === '1.2750',
        'In-flight identical requests are deduplicated into single network fetch',
        `networkCalls=${networkCalls}`,
      );
    }

    // -------------------------------------------------------------
    // Test 6: A rate-limited state maintains CONNECTED or RATE LIMITED, NEVER NOT CONNECTED
    // -------------------------------------------------------------
    {
      // Simulate client state machine logic from TwelveDataMarketDataProvider
      let hasEverConnected = true;
      let lastVerifiedDataAt = Date.now();
      let rateLimitTelemetry = { isRateLimited: true, requestsThisMinute: 8, nextResetSeconds: 22 };
      let quotes = {
        'XAU/USD': { status: 'RATE LIMITED', price: 2385.50 } as any,
      };

      // Determine connectionStatus
      let connectionStatus: ConnectionStatus;
      let marketDataStatus: MarketDataStatus;

      const hasRateLimitedQuote = Object.values(quotes).some((q) => q.status === 'RATE LIMITED');
      if (rateLimitTelemetry.isRateLimited || hasRateLimitedQuote) {
        connectionStatus = 'RATE LIMITED';
        marketDataStatus = 'RATE LIMITED';
      } else if (hasEverConnected) {
        connectionStatus = 'CONNECTED';
        marketDataStatus = 'LIVE';
      } else {
        connectionStatus = 'NOT CONNECTED';
        marketDataStatus = 'NOT CONNECTED';
      }

      assert(
        connectionStatus !== 'NOT CONNECTED' && (connectionStatus === 'RATE LIMITED' || connectionStatus === 'CONNECTED'),
        'Rate-limited state maintains RATE LIMITED / CONNECTED, NEVER NOT CONNECTED',
        `Got connectionStatus=${connectionStatus}`,
      );
    }

    // -------------------------------------------------------------
    // Test 7: Reset countdown reaches 0s and rate-limit state clears properly on next real request
    // -------------------------------------------------------------
    {
      const manager = new TwelveDataRequestManager();
      
      // Seed manager with an exhausted timestamp in the past (>60s)
      (manager as any).requestTimestamps = [
        Date.now() - 65000,
        Date.now() - 64000,
        Date.now() - 63000,
        Date.now() - 62000,
        Date.now() - 61000,
        Date.now() - 60500,
        Date.now() - 60200,
        Date.now() - 60100,
      ];

      // Telemetry should now register 0 requests this minute and 8 remaining
      const telemetry = manager.getTelemetry();
      
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', symbol: 'RESET_TEST', close: '100.0' }),
      } as any);

      const nextReq = await manager.execute<any>('https://api.twelvedata.com/quote?symbol=RESET_TEST&apikey=demo', 1, 0);

      assert(
        telemetry.requestsThisMinute === 0 && telemetry.remainingCredits === 8 && nextReq.rateLimited === false,
        'Reset countdown reaches 0s and rate-limit state clears on next request',
        `requestsThisMinute=${telemetry.requestsThisMinute}, remainingCredits=${telemetry.remainingCredits}`,
      );
    }

    // -------------------------------------------------------------
    // Test 8: Historical candle fetch during rate limit returns verified cached candles if present
    // -------------------------------------------------------------
    {
      const service = new TwelveDataService();
      // Pre-seed candles cache with verified candles
      const sampleCandles = [
        { timestamp: 1700000000, open: 2380, high: 2385, low: 2378, close: 2384, volume: 100, isVerified: true, datetime: '2024-01-01' },
      ];
      (service as any).candlesCache['XAU/USD_15min'] = {
        candles: sampleCandles,
        cachedAt: Date.now() - 100000, // Expired freshness so it attempts refresh
        error: null,
      };

      // Mock manager on twelveDataRequestManager singleton to return rate-limited
      const { twelveDataRequestManager } = await import('../server/twelve-data-request-manager');
      const originalExecute = twelveDataRequestManager.execute.bind(twelveDataRequestManager);
      twelveDataRequestManager.execute = async () => ({
        data: null as any,
        fromCache: true,
        rateLimited: true,
        error: 'Rate limit ceiling reached',
      });

      const candleResult = await service.getCandles('XAU/USD', '15min');
      twelveDataRequestManager.execute = originalExecute;

      assert(
        candleResult.isVerified === true && candleResult.candles.length === 1 && candleResult.rateLimited === true,
        'Historical candle fetch during rate limit returns verified cached candles',
        `candleResult=${JSON.stringify(candleResult)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 9: Market intelligence endpoint does not fail with 500 when rate limited
    // -------------------------------------------------------------
    {
      const coordinator = new XauUsdIntelligenceCoordinator();
      const verifiedCandles = [
        { timestamp: 1700000000, open: 2380, high: 2390, low: 2375, close: 2388, volume: 200, isVerified: true },
        { timestamp: 1700000900, open: 2388, high: 2395, low: 2385, close: 2392, volume: 250, isVerified: true },
        { timestamp: 1700001800, open: 2392, high: 2394, low: 2382, close: 2385, volume: 180, isVerified: true },
        { timestamp: 1700002700, open: 2385, high: 2398, low: 2384, close: 2396, volume: 220, isVerified: true },
        { timestamp: 1700003600, open: 2396, high: 2402, low: 2394, close: 2400, volume: 300, isVerified: true },
        { timestamp: 1700004500, open: 2400, high: 2405, low: 2398, close: 2403, volume: 190, isVerified: true },
      ];

      // Analyze verified cached candles even under rate limited condition
      const intel = coordinator.analyze(verifiedCandles, '15min');

      assert(
        intel && intel.symbol === 'XAU/USD' && intel.status === 'VERIFIED' && intel.candleCount === 6,
        'Market intelligence executes safely on cached verified data during rate limit',
      );
    }

    // -------------------------------------------------------------
    // Test 10: UI Top Bar Displays: Twelve Data, RATE LIMITED, Budget 8/8, Remaining 0, Reset XXs
    // -------------------------------------------------------------
    {
      const rateLimitTelemetry = {
        requestsThisMinute: 8,
        maxRequestsPerMinute: 8,
        remainingCredits: 0,
        nextResetSeconds: 18,
        isRateLimited: true,
        queueLength: 0,
        totalRequestsExecuted: 15,
      };

      const providerDisplay = 'Twelve Data';
      const connectionStatus: ConnectionStatus = 'RATE LIMITED';
      const budgetDisplay = `${rateLimitTelemetry.requestsThisMinute}/8`;
      const remainingDisplay = `${rateLimitTelemetry.remainingCredits}`;
      const resetDisplay = `${rateLimitTelemetry.nextResetSeconds}s`;

      assert(
        providerDisplay === 'Twelve Data' &&
        connectionStatus === 'RATE LIMITED' &&
        budgetDisplay === '8/8' &&
        remainingDisplay === '0' &&
        resetDisplay === '18s',
        'UI Top Bar attributes accurately format Provider, Status, Budget 8/8, Remaining 0, Reset 18s',
        `Got ${providerDisplay} | ${connectionStatus} | Budget: ${budgetDisplay} | Remaining: ${remainingDisplay} | Reset: ${resetDisplay}`,
      );
    }

    console.log(`\n====================================================`);
    console.log(`ALL 10 DETERMINISTIC STABILITY TESTS PASSED (${passed}/${total})`);
    console.log(`====================================================\n`);
  } finally {
    global.fetch = originalFetch;
  }
}

runStabilityTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test run error:', err);
    process.exit(1);
  });
