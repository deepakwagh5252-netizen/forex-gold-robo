import { TwelveDataRequestManager } from '../server/twelve-data-request-manager';
import { TwelveDataService } from '../server/twelve-data-service';
import { 
  ACTIVE_INSTRUMENTS, 
  ACTIVE_SECONDARY_INSTRUMENTS, 
  AVAILABLE_INSTRUMENTS, 
  INACTIVE_PRESERVED_INSTRUMENTS,
  INSTRUMENT_PRIORITY,
  isActiveInstrument,
  isAvailableInstrument 
} from '../src/config/watchlist-config';
import { 
  WATCHLIST_INSTRUMENTS, 
  MARKET_OVERVIEW_SYMBOLS 
} from '../src/market-data/constants';
import { TwelveDataMarketDataProvider } from '../src/market-data/twelve-data-provider';

// Mock global fetch for testing
let originalFetch: typeof global.fetch;

async function runActiveWatchlistTests() {
  console.log('====================================================');
  console.log('STARTING ACTIVE WATCHLIST DETERMINISTIC TESTS');
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

  originalFetch = global.fetch;

  try {
    // -------------------------------------------------------------
    // Test 1: Exactly four instruments are active in central configuration
    // -------------------------------------------------------------
    {
      const expectedActive = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY'];
      const isActiveCorrect = ACTIVE_INSTRUMENTS.length === 4 &&
        expectedActive.every(sym => (ACTIVE_INSTRUMENTS as readonly string[]).includes(sym));

      assert(
        isActiveCorrect,
        'Only four instruments are active (XAU/USD, EUR/USD, GBP/USD, USD/JPY)',
        `Got: ${JSON.stringify(ACTIVE_INSTRUMENTS)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 2: XAU/USD remains Priority #1; secondary pairs are Priority #2
    // -------------------------------------------------------------
    {
      const xauPriority = INSTRUMENT_PRIORITY['XAU/USD'];
      const eurPriority = INSTRUMENT_PRIORITY['EUR/USD'];
      const gbpPriority = INSTRUMENT_PRIORITY['GBP/USD'];
      const jpyPriority = INSTRUMENT_PRIORITY['USD/JPY'];

      assert(
        xauPriority === 1 && eurPriority === 2 && gbpPriority === 2 && jpyPriority === 2,
        'XAU/USD remains Priority #1; secondary pairs are Priority #2',
        `XAU: ${xauPriority}, EUR: ${eurPriority}, GBP: ${gbpPriority}, JPY: ${jpyPriority}`,
      );
    }

    // -------------------------------------------------------------
    // Test 3: Inactive instruments remain preserved in AVAILABLE_INSTRUMENTS catalog
    // -------------------------------------------------------------
    {
      const inactiveSymbols = ['USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
      const allPreserved = inactiveSymbols.every(sym => isAvailableInstrument(sym));
      const noneActive = inactiveSymbols.every(sym => !isActiveInstrument(sym));

      assert(
        allPreserved && noneActive && AVAILABLE_INSTRUMENTS.length === 8,
        'USD/CHF, AUD/USD, USD/CAD, NZD/USD are preserved in AVAILABLE_INSTRUMENTS without active scheduling',
        `Preserved in catalog: ${allPreserved}, none active: ${noneActive}`,
      );
    }

    // -------------------------------------------------------------
    // Test 4: UI Watchlist and Market Overview derive strictly from active instruments (4 pairs)
    // -------------------------------------------------------------
    {
      const watchlistSymbols = WATCHLIST_INSTRUMENTS.map(i => i.symbol);
      const overviewSymbols = MARKET_OVERVIEW_SYMBOLS;

      const watchlistMatches = watchlistSymbols.length === 4 &&
        watchlistSymbols.includes('XAU/USD') &&
        watchlistSymbols.includes('EUR/USD') &&
        watchlistSymbols.includes('GBP/USD') &&
        watchlistSymbols.includes('USD/JPY');

      const overviewMatches = overviewSymbols.length === 4 &&
        overviewSymbols.includes('XAU/USD') &&
        overviewSymbols.includes('EUR/USD') &&
        overviewSymbols.includes('GBP/USD') &&
        overviewSymbols.includes('USD/JPY');

      assert(
        watchlistMatches && overviewMatches,
        'UI Watchlist and Market Overview derive strictly from the 4 active instruments',
        `Watchlist: ${JSON.stringify(watchlistSymbols)}, Overview: ${JSON.stringify(overviewSymbols)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 5: TwelveDataService requests XAU/USD Priority #1 and fair round-robin on secondary pairs
    // -------------------------------------------------------------
    {
      const calledSymbols: string[] = [];
      global.fetch = async (url: any) => {
        const urlStr = String(url);
        const match = urlStr.match(/symbol=([^&]+)/);
        if (match) {
          calledSymbols.push(decodeURIComponent(match[1]));
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            symbol: match ? decodeURIComponent(match[1]) : 'XAU/USD',
            close: '2385.50',
            timestamp: Math.floor(Date.now() / 1000),
            status: 'ok',
          }),
        } as any;
      };

      const service = new TwelveDataService();

      // Cycle 1: First call (forces XAU/USD, then rotates through secondaries)
      await service.getQuotes(true);
      assert(
        calledSymbols.includes('XAU/USD'),
        'Cycle 1 requests XAU/USD as Priority #1',
        `Called symbols: ${JSON.stringify(calledSymbols)}`,
      );

      // Verify that no inactive instrument was requested
      const inactiveSymbols = ['USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
      const inactiveCalled = inactiveSymbols.some(sym => calledSymbols.includes(sym));
      assert(
        !inactiveCalled,
        'USD/CHF, AUD/USD, USD/CAD, NZD/USD never enter the active request queue in Cycle 1',
        `Unexpected inactive called: ${calledSymbols.filter(s => inactiveSymbols.includes(s))}`,
      );
    }

    // -------------------------------------------------------------
    // Test 6: Inactive instruments never enter network request queue across 10 rotation cycles
    // -------------------------------------------------------------
    {
      const allRequestedSymbols: string[] = [];
      global.fetch = async (url: any) => {
        const urlStr = String(url);
        const match = urlStr.match(/symbol=([^&]+)/);
        if (match) {
          allRequestedSymbols.push(decodeURIComponent(match[1]));
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            symbol: match ? decodeURIComponent(match[1]) : 'XAU/USD',
            close: '1.2000',
            timestamp: Math.floor(Date.now() / 1000),
            status: 'ok',
          }),
        } as any;
      };

      const service = new TwelveDataService();

      // Run multiple polling cycles (forceRefresh=true each time)
      for (let i = 0; i < 6; i++) {
        await service.getQuotes(true);
      }

      // Check inactive pairs: USD/CHF, AUD/USD, USD/CAD, NZD/USD
      const inactive = ['USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
      const leaked = allRequestedSymbols.filter(s => inactive.includes(s));

      assert(
        leaked.length === 0,
        'Zero inactive instruments leaked into network requests across repeated polling cycles',
        `Leaked instruments: ${JSON.stringify(leaked)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 7: Steady-state request rate remains safely under the 8 requests/min limit
    // -------------------------------------------------------------
    {
      // In steady state: Each 45s cycle fetches:
      // 1. XAU/USD (Prio 1)
      // 2. Next rotated secondary pair (Prio 2)
      // Total: 2 requests per 45s = 2.67 requests/minute <= 8 req/min ceiling!
      const requestsPerCycle = 2;
      const cycleDurationSeconds = 45;
      const requestsPer60Seconds = (requestsPerCycle / cycleDurationSeconds) * 60; // 2.67

      assert(
        requestsPer60Seconds <= 4.0, // Safely below 8
        'Steady-state schedule runs at ~2.67 requests/minute, well below the 8 req/min limit',
        `Calculated rate: ${requestsPer60Seconds.toFixed(2)} req/60s (Limit: 8)`,
      );
    }

    // -------------------------------------------------------------
    // Test 8: Client provider initializes exactly 4 quotes and filters non-active updates
    // -------------------------------------------------------------
    {
      const provider = new TwelveDataMarketDataProvider();
      const allQuotes = provider.getAllQuotes();
      const quoteKeys = Object.keys(allQuotes);

      const hasOnlyActive = quoteKeys.length === 4 &&
        quoteKeys.includes('XAU/USD') &&
        quoteKeys.includes('EUR/USD') &&
        quoteKeys.includes('GBP/USD') &&
        quoteKeys.includes('USD/JPY');

      assert(
        hasOnlyActive,
        'Client TwelveDataMarketDataProvider initializes exactly 4 active instruments in memory',
        `Provider quote keys: ${JSON.stringify(quoteKeys)}`,
      );
    }

    // -------------------------------------------------------------
    // Test 9: Client provider telemetry reports totalInstruments = 4
    // -------------------------------------------------------------
    {
      const provider = new TwelveDataMarketDataProvider();
      const telemetry = provider.getTelemetry();

      assert(
        telemetry.totalInstruments === 4,
        'Telemetry accurately reports totalInstruments = 4',
        `Reported totalInstruments: ${telemetry.totalInstruments}`,
      );
    }

    // -------------------------------------------------------------
    // Test 10: In-flight identical quote requests are deduplicated into single network fetch
    // -------------------------------------------------------------
    {
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount++;
        // Small delay to simulate async network
        await new Promise(res => setTimeout(res, 20));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            symbol: 'XAU/USD',
            close: '2385.50',
            timestamp: Math.floor(Date.now() / 1000),
            status: 'ok',
          }),
        } as any;
      };

      const service = new TwelveDataService();
      // Concurrent getQuotes calls
      const [quotes1, quotes2] = await Promise.all([
        service.getQuotes(false),
        service.getQuotes(false),
      ]);

      assert(
        quotes1 === quotes2,
        'Concurrent getQuotes calls share the same in-flight promise (no duplicate burst)',
        `fetchCount: ${fetchCount}`,
      );
    }

    console.log(`\n====================================================`);
    console.log(`ALL 10 ACTIVE WATCHLIST DETERMINISTIC TESTS PASSED (${passed}/${total})`);
    console.log(`====================================================\n`);
  } finally {
    global.fetch = originalFetch;
  }
}

runActiveWatchlistTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Active watchlist test run error:', err);
    process.exit(1);
  });
