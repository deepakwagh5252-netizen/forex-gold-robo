import { 
  parseTwelveDataTimestamp, 
  validateCandle, 
  normalizeAndSortCandles, 
  aggregateCandles,
  formatCandleTimestamp,
  TIMEFRAME_MAP,
  RawTwelveDataCandle
} from '../src/utils/candle-integrity';
import { Candle } from '../src/market-data/provider.interface';

console.log('=== PHASE 5: MARKET CHART INTEGRITY AUDIT & TEST SUITE ===');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
    testsFailed++;
  }
}

// -------------------------------------------------------------
// STEP 1 & 2: Deterministic UTC Timestamp Parsing
// -------------------------------------------------------------
console.log('\n--- 1. Deterministic UTC Timestamp Parsing ---');

const utcExpected = Date.UTC(2026, 8, 19, 14, 30, 0); // 2026-09-19 14:30:00 UTC
const parsedUtc = parseTwelveDataTimestamp('2026-09-19 14:30:00');
assert(
  parsedUtc === utcExpected,
  'Twelve Data datetime "YYYY-MM-DD HH:mm:ss" parses strictly as UTC without local tz drift',
  `Expected ${utcExpected}, got ${parsedUtc}`
);

const dailyUtcExpected = Date.UTC(2026, 8, 19, 0, 0, 0);
const parsedDaily = parseTwelveDataTimestamp('2026-09-19');
assert(
  parsedDaily === dailyUtcExpected,
  'Daily datetime "YYYY-MM-DD" parses strictly as UTC midnight',
  `Expected ${dailyUtcExpected}, got ${parsedDaily}`
);

const isoWithZ = parseTwelveDataTimestamp('2026-09-19T14:30:00Z');
assert(isoWithZ === utcExpected, 'ISO string with Z parses accurately');

const invalidTs = parseTwelveDataTimestamp('not-a-date');
assert(invalidTs === 0, 'Invalid timestamp string safely returns 0');

// -------------------------------------------------------------
// STEP 3: Individual Candle Integrity Validation
// -------------------------------------------------------------
console.log('\n--- 2. Candle Integrity Validation (Step 3) ---');

const validRaw: RawTwelveDataCandle = {
  datetime: '2026-09-19 14:30:00',
  open: '2410.50',
  high: '2418.00',
  low: '2408.20',
  close: '2415.30',
  volume: '1540',
};
const validResult = validateCandle(validRaw);
assert(validResult.isValid === true && validResult.candle !== null, 'Valid candle passes integrity check');
assert(validResult.candle?.open === 2410.5 && validResult.candle?.close === 2415.3, 'OHLC values parsed as numbers');

// Invalid High: high < max(open, close)
const invalidHighRaw: RawTwelveDataCandle = {
  datetime: '2026-09-19 14:30:00',
  open: '2410.50',
  high: '2412.00',
  low: '2408.20',
  close: '2415.30', // close 2415.3 > high 2412.0!
  volume: '100',
};
const resInvalidHigh = validateCandle(invalidHighRaw);
assert(
  resInvalidHigh.isValid === false && (resInvalidHigh.rejectionReason?.includes('INVALID_HIGH') ?? false),
  'Rejects candle where high < max(open, close)'
);

// Invalid Low: low > min(open, close)
const invalidLowRaw: RawTwelveDataCandle = {
  datetime: '2026-09-19 14:30:00',
  open: '2410.50',
  high: '2418.00',
  low: '2412.00', // low 2412.0 > open 2410.5!
  close: '2415.30',
  volume: '100',
};
const resInvalidLow = validateCandle(invalidLowRaw);
assert(
  resInvalidLow.isValid === false && (resInvalidLow.rejectionReason?.includes('INVALID_LOW') ?? false),
  'Rejects candle where low > min(open, close)'
);

// Non-positive or NaN
const nanRaw: RawTwelveDataCandle = {
  datetime: '2026-09-19 14:30:00',
  open: 'NaN',
  high: '2418.00',
  low: '2408.20',
  close: '2415.30',
};
assert(validateCandle(nanRaw).isValid === false, 'Rejects candle with NaN OHLC');

const negativeRaw: RawTwelveDataCandle = {
  datetime: '2026-09-19 14:30:00',
  open: '-10.5',
  high: '2418.00',
  low: '2408.20',
  close: '2415.30',
};
assert(validateCandle(negativeRaw).isValid === false, 'Rejects candle with non-positive price');

// -------------------------------------------------------------
// STEP 4: Chronological Sorting, Normalization & Deduplication
// -------------------------------------------------------------
console.log('\n--- 3. Chronological Sorting & Deduplication ---');

// Twelve Data API returns newest first (descending). We require ascending (oldest first).
const rawList: RawTwelveDataCandle[] = [
  { datetime: '2026-09-19 14:45:00', open: '2415', high: '2420', low: '2414', close: '2418', volume: '100' }, // t3
  { datetime: '2026-09-19 14:30:00', open: '2410', high: '2416', low: '2409', close: '2415', volume: '120' }, // t2
  { datetime: '2026-09-19 14:30:00', open: '2410', high: '2416', low: '2409', close: '2415', volume: '120' }, // duplicate t2
  { datetime: '2026-09-19 14:15:00', open: '2405', high: '2411', low: '2404', close: '2410', volume: '110' }, // t1
  { datetime: '2026-09-19 14:00:00', open: '2400', high: '2390', low: '2400', close: '2400' }, // malformed high < open
];

const normalized = normalizeAndSortCandles(rawList);
assert(normalized.candles.length === 3, 'Correctly filtered 1 duplicate and 1 malformed bar');
assert(normalized.rejectedCount === 1, 'Reported 1 rejected malformed bar');
assert(
  normalized.candles[0].timestamp < normalized.candles[1].timestamp &&
  normalized.candles[1].timestamp < normalized.candles[2].timestamp,
  'Candles are strictly sorted ascending by timestamp (oldest first, newest last)'
);
assert(normalized.candles[0].datetime === '2026-09-19 14:15:00', 'Oldest candle is first in series');
assert(normalized.candles[2].datetime === '2026-09-19 14:45:00', 'Newest candle is last in series');

// -------------------------------------------------------------
// STEP 5: Timeframe Aggregation
// -------------------------------------------------------------
console.log('\n--- 4. Deterministic Timeframe Aggregation ---');

const base5mCandles: Candle[] = [
  {
    timestamp: Date.UTC(2026, 8, 19, 14, 0, 0),
    open: 2400.0,
    high: 2405.0,
    low: 2398.0,
    close: 2403.0,
    volume: 50,
    isVerified: true,
  },
  {
    timestamp: Date.UTC(2026, 8, 19, 14, 5, 0),
    open: 2403.0,
    high: 2412.0, // overall high
    low: 2402.0,
    close: 2408.0,
    volume: 75,
    isVerified: true,
  },
  {
    timestamp: Date.UTC(2026, 8, 19, 14, 10, 0),
    open: 2408.0,
    high: 2410.0,
    low: 2395.0, // overall low
    close: 2406.0,
    volume: 80,
    isVerified: true,
  },
];

const aggregated15m = aggregateCandles(base5mCandles, 15);
assert(aggregated15m.length === 1, 'Aggregated three 5m candles into single 15m candle');
const agg = aggregated15m[0];
assert(agg.open === 2400.0, 'Aggregated open equals first candle open (2400.0)');
assert(agg.high === 2412.0, 'Aggregated high equals maximum high (2412.0)');
assert(agg.low === 2395.0, 'Aggregated low equals minimum low (2395.0)');
assert(agg.close === 2406.0, 'Aggregated close equals last candle close (2406.0)');
assert(agg.volume === 205, 'Aggregated volume equals sum of volumes (50 + 75 + 80 = 205)');

// -------------------------------------------------------------
// STEP 6: Timezone Conversion Formatting
// -------------------------------------------------------------
console.log('\n--- 5. Timezone Formatting ---');

const testTs = Date.UTC(2026, 8, 19, 14, 30, 0); // 14:30 UTC
const utcFormatted = formatCandleTimestamp(testTs, 'UTC', '15m');
assert(utcFormatted.includes('14:30'), 'UTC formatted time contains 14:30');

const nyFormatted = formatCandleTimestamp(testTs, 'America/New_York', '15m');
// 14:30 UTC in September (EDT = UTC-4) is 10:30
assert(nyFormatted.includes('10:30'), 'New York EDT formatted time contains 10:30');

const tokyoFormatted = formatCandleTimestamp(testTs, 'Asia/Tokyo', '15m');
// 14:30 UTC in Tokyo (JST = UTC+9) is 23:30
assert(tokyoFormatted.includes('23:30'), 'Tokyo JST formatted time contains 23:30');

// -------------------------------------------------------------
// STEP 7: Timeframe Mapping Completeness
// -------------------------------------------------------------
console.log('\n--- 6. Timeframe Mapping Completeness ---');
assert(TIMEFRAME_MAP['1m'] === '1min', 'Maps 1m to 1min');
assert(TIMEFRAME_MAP['5m'] === '5min', 'Maps 5m to 5min');
assert(TIMEFRAME_MAP['15m'] === '15min', 'Maps 15m to 15min');
assert(TIMEFRAME_MAP['1h'] === '1h', 'Maps 1h to 1h');
assert(TIMEFRAME_MAP['4h'] === '4h', 'Maps 4h to 4h');
assert(TIMEFRAME_MAP['1D'] === '1day', 'Maps 1D to 1day');

// -------------------------------------------------------------
// STEP 8: Phase 8 Forward Trade Chart Journal Persistence
// -------------------------------------------------------------
console.log('\n--- 7. Phase 8 Forward Trade Chart Journal Persistence ---');
const { ForwardPersistence } = await import('../src/services/paper-trading/forward-persistence');
const sampleForwardTrade: any = {
  tradeId: 'TRD-P7F-XAUUSD-15M-1790752500000-LONG',
  positionId: 'POS-P7F-XAUUSD-15M-1790752500000-LONG',
  signalId: 'SIG-P7F-XAUUSD-15M-1790752500000-LONG',
  paperOrderId: 'ORD-P7F-XAUUSD-15M-1790752500000-LONG',
  symbol: 'XAU/USD',
  timeframe: '15m',
  direction: 'LONG',
  signalCandleTimeUtc: '2026-09-30T07:15:00.000Z',
  entryRequestedAtUtc: '2026-09-30T07:30:00.020Z',
  entryExecutedAtUtc: '2026-09-30T07:30:00.020Z',
  exitRequestedAtUtc: '2026-09-30T08:00:00.020Z',
  exitExecutedAtUtc: '2026-09-30T08:00:00.020Z',
  openedAt: '2026-09-30T07:30:00.020Z',
  closedAt: '2026-09-30T08:00:00.020Z',
  entryPrice: 2650.00,
  exitPrice: 2670.00,
  stopLoss: 2640.00,
  initialStopLoss: 2640.00,
  takeProfit: 2670.00,
  initialTakeProfit: 2670.00,
  positionSize: 10,
  quantity: 10,
  lotSize: 0.1,
  grossPnL: 200.00,
  netPnL: 198.60,
  commission: 0.70,
  fees: 1.40,
  spreadCost: 1.00,
  slippageCost: 0.50,
  slippage: 0.50,
  totalFees: 1.40,
  rMultiple: 2.0,
  closeReason: 'TAKE_PROFIT',
  exitReason: 'TAKE_PROFIT',
  isWin: true,
  strategyVersion: 'Phase 7F/7G Frozen Breakout-Retest',
  filterVersion: 'Filter AB Frozen',
  riskConfigurationVersion: 'Phase 8 Frozen 1% Risk / 3 Max Pos',
  createdAtUtc: '2026-09-30T07:30:00.020Z',
  updatedAtUtc: '2026-09-30T08:00:00.020Z',
};

ForwardPersistence.saveTrades([sampleForwardTrade]);
const restoredTrades = ForwardPersistence.loadTrades();
assert(restoredTrades.length === 1, 'Restored exactly 1 forward trade from persistent journal');
assert(restoredTrades[0].tradeId === sampleForwardTrade.tradeId, 'Trade ID preserved across persistence');
assert(restoredTrades[0].netPnL === 198.60, 'Net PnL preserved');
assert(restoredTrades[0].exitReason === 'TAKE_PROFIT', 'Exit reason preserved');
assert(restoredTrades[0].entryExecutedAtUtc === '2026-09-30T07:30:00.020Z', 'Entry execution UTC preserved');
assert(restoredTrades[0].exitExecutedAtUtc === '2026-09-30T08:00:00.020Z', 'Exit execution UTC preserved');

// Summary
console.log(`\n======================================================`);
console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
console.log(`======================================================\n`);

if (testsFailed > 0) {
  process.exit(1);
}
