import * as assert from 'assert';
import { 
  parseTwelveDataTimestamp, 
  validateCandle, 
  getUtcM15Start, 
  getUtcM15Close, 
  isUtcM15Aligned, 
  M15_INTERVAL_MS 
} from '../src/utils/candle-integrity';
import { ForwardCandleValidator } from '../src/services/paper-trading/forward-candle-validator';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { Candle } from '../src/market-data/provider.interface';

console.log('================================================================');
console.log('XAU/USD M15 FORWARD DATA TIMING & CONFIRMATION TEST SUITE');
console.log('Testing deterministic UTC timestamp, boundary, and confirmation');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// TEST 1: NORMALIZATION OF TWELVE DATA TIMESTAMPS TO UTC EXACTLY ONCE
// -----------------------------------------------------------------------------
runTest('UTC NORMALIZATION - Parses Twelve Data datetime strings strictly into UTC', () => {
  // Twelve Data standard format: "YYYY-MM-DD HH:mm:ss"
  const raw1 = '2026-09-29 10:15:00';
  const ts1 = parseTwelveDataTimestamp(raw1);
  const iso1 = new Date(ts1).toISOString();

  assert.strictEqual(iso1, '2026-09-29T10:15:00.000Z', 'Must produce exact UTC ISO string ending in Z');
  assert.strictEqual(ts1 % (15 * 60 * 1000), 0, 'Must align to M15 boundary in UTC');

  // ISO string with Z: "YYYY-MM-DDTHH:mm:ss.000Z"
  const raw2 = '2026-09-29T10:15:00.000Z';
  const ts2 = parseTwelveDataTimestamp(raw2);
  assert.strictEqual(ts2, ts1, 'Identical timestamps regardless of ISO vs Twelve Data format');

  // Format with T but no Z
  const raw3 = '2026-09-29T10:15:00';
  const ts3 = parseTwelveDataTimestamp(raw3);
  assert.strictEqual(ts3, ts1, 'Must treat string without timezone strictly as UTC, never local time');

  // Numeric timestamp passthrough
  const ts4 = parseTwelveDataTimestamp(ts1);
  assert.strictEqual(ts4, ts1, 'Numeric timestamp passes through without double-conversion');
});

runTest('TIMEZONE INDEPENDENCE - Never reinterprets UTC as local time across different TZ configs', () => {
  const originalTZ = process.env.TZ;
  try {
    const testTimezones = ['UTC', 'America/New_York', 'Australia/Sydney', 'Asia/Tokyo', 'America/Los_Angeles'];
    const expectedTs = parseTwelveDataTimestamp('2026-09-29 10:15:00');

    for (const tz of testTimezones) {
      process.env.TZ = tz;
      const parsed = parseTwelveDataTimestamp('2026-09-29 10:15:00');
      assert.strictEqual(
        parsed,
        expectedTs,
        `parseTwelveDataTimestamp must produce same UTC timestamp under TZ=${tz}`
      );
    }
  } finally {
    process.env.TZ = originalTZ;
  }
});

// -----------------------------------------------------------------------------
// TEST 2: UTC M15 CANDLE BOUNDARY CALCULATIONS
// -----------------------------------------------------------------------------
runTest('UTC M15 BOUNDARIES - Computes start, close, and alignment strictly in UTC', () => {
  const baseTs = parseTwelveDataTimestamp('2026-09-29 10:00:00'); // 10:00:00 UTC
  
  // Boundary calculations
  assert.strictEqual(isUtcM15Aligned(baseTs), true, '10:00:00 is aligned to M15');
  assert.strictEqual(isUtcM15Aligned(baseTs + 15 * 60 * 1000), true, '10:15:00 is aligned to M15');
  assert.strictEqual(isUtcM15Aligned(baseTs + 30 * 60 * 1000), true, '10:30:00 is aligned to M15');
  assert.strictEqual(isUtcM15Aligned(baseTs + 45 * 60 * 1000), true, '10:45:00 is aligned to M15');

  // Unaligned timestamps
  assert.strictEqual(isUtcM15Aligned(baseTs + 1000), false, '10:00:01 is not aligned');
  assert.strictEqual(isUtcM15Aligned(baseTs + 7 * 60 * 1000), false, '10:07:00 is not aligned');
  assert.strictEqual(isUtcM15Aligned(baseTs + 14 * 60 * 1000 + 59000), false, '10:14:59 is not aligned');

  // Helper methods
  assert.strictEqual(getUtcM15Start(baseTs + 7 * 60 * 1000), baseTs, 'getUtcM15Start rounds down to 10:00:00');
  assert.strictEqual(getUtcM15Close(baseTs), baseTs + 15 * 60 * 1000, 'getUtcM15Close adds 15 minutes');

  // Validator boundary checks
  const unalignedCandle: Candle = {
    timestamp: baseTs + 7 * 60 * 1000,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };
  const valRes = ForwardCandleValidator.validate(unalignedCandle, null, baseTs + 30 * 60 * 1000, false);
  assert.strictEqual(valRes.isValid, false);
  assert.strictEqual(valRes.status, 'MALFORMED');
  assert.ok(valRes.error?.includes('UNALIGNED_M15_BOUNDARY'));
});

// -----------------------------------------------------------------------------
// TEST 3: FUTURE-DATED CANDLE REJECTION (Diagnoses & prevents 36182s bug)
// -----------------------------------------------------------------------------
runTest('FUTURE CANDLE REJECTION - Rejects any candle starting in the future relative to UTC now', () => {
  const nowMs = parseTwelveDataTimestamp('2026-09-29 10:15:00'); // Current simulated time: 10:15:00 UTC

  // Scenario matching user bug: Candle is dated 20:30:00 UTC (+10h 15m ahead)
  const futureCandle10h: Candle = {
    timestamp: parseTwelveDataTimestamp('2026-09-29 20:30:00'),
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  const res10h = ForwardCandleValidator.validate(futureCandle10h, null, nowMs, false);
  assert.strictEqual(res10h.isValid, false);
  assert.strictEqual(res10h.status, 'MALFORMED');
  assert.ok(
    res10h.error?.includes('FUTURE_CANDLE_REJECTED'),
    'Must be categorized as FUTURE_CANDLE_REJECTED, NOT INCOMPLETE_CANDLE with 36182s'
  );

  // Even 1 millisecond into the future must be rejected
  const futureCandle1ms: Candle = {
    timestamp: nowMs + 15 * 60 * 1000, // 10:30:00 UTC (15m in future)
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };
  const res1ms = ForwardCandleValidator.validate(futureCandle1ms, null, nowMs, false);
  assert.strictEqual(res1ms.isValid, false);
  assert.strictEqual(res1ms.status, 'MALFORMED');
  assert.ok(res1ms.error?.includes('FUTURE_CANDLE_REJECTED'));
});

// -----------------------------------------------------------------------------
// TEST 4: GENUINELY ACTIVE / INCOMPLETE CANDLE REJECTION
// -----------------------------------------------------------------------------
runTest('INCOMPLETE CANDLE REJECTION - Rejects trading decision while candle is actively forming', () => {
  const candleStartTs = parseTwelveDataTimestamp('2026-09-29 10:00:00');
  const candleCloseTs = candleStartTs + 15 * 60 * 1000; // 10:15:00 UTC

  const activeCandle: Candle = {
    timestamp: candleStartTs,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  // Sub-case A: Tested at exact candle open (10:00:00 UTC) -> 900s remaining
  const resOpen = ForwardCandleValidator.validate(activeCandle, null, candleStartTs, false);
  assert.strictEqual(resOpen.isValid, false);
  assert.strictEqual(resOpen.status, 'INCOMPLETE');
  assert.strictEqual(resOpen.isConfirmedClosed, false);
  assert.ok(resOpen.error?.includes('Closes in 900s'));

  // Sub-case B: Tested mid-candle at 10:07:30 UTC -> 450s remaining
  const resMid = ForwardCandleValidator.validate(activeCandle, null, candleStartTs + 7.5 * 60 * 1000, false);
  assert.strictEqual(resMid.isValid, false);
  assert.strictEqual(resMid.status, 'INCOMPLETE');
  assert.strictEqual(resMid.isConfirmedClosed, false);
  assert.ok(resMid.error?.includes('Closes in 450s'));

  // Sub-case C: Tested 1ms before close (10:14:59.999 UTC) -> 1s remaining
  const resJustBefore = ForwardCandleValidator.validate(activeCandle, null, candleCloseTs - 1, false);
  assert.strictEqual(resJustBefore.isValid, false);
  assert.strictEqual(resJustBefore.status, 'INCOMPLETE');
  assert.strictEqual(resJustBefore.isConfirmedClosed, false);
  assert.ok(resJustBefore.error?.includes('Closes in 1s'));
});

// -----------------------------------------------------------------------------
// TEST 5: CONFIRMED CLOSED-CANDLE ACCEPTANCE
// -----------------------------------------------------------------------------
runTest('CONFIRMED CANDLE ACCEPTANCE - Confirms candle only when UTC now >= candle close time', () => {
  const candleStartTs = parseTwelveDataTimestamp('2026-09-29 10:00:00');
  const candleCloseTs = candleStartTs + 15 * 60 * 1000; // 10:15:00 UTC

  const closedCandle: Candle = {
    timestamp: candleStartTs,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  // Sub-case A: Exactly at close time (10:15:00.000 UTC)
  const resExact = ForwardCandleValidator.validate(closedCandle, null, candleCloseTs, false);
  assert.strictEqual(resExact.isValid, true);
  assert.strictEqual(resExact.isConfirmedClosed, true);
  assert.strictEqual(resExact.status, 'VALID');
  assert.strictEqual(resExact.candle?.isConfirmedClosed, true);
  assert.strictEqual(resExact.candle?.timestamp, candleStartTs);
  assert.strictEqual(resExact.candle?.datetime, '2026-09-29T10:00:00.000Z');

  // Sub-case B: After close time (e.g. 10:20:00 UTC)
  const resAfter = ForwardCandleValidator.validate(closedCandle, null, candleCloseTs + 5 * 60 * 1000, false);
  assert.strictEqual(resAfter.isValid, true);
  assert.strictEqual(resAfter.isConfirmedClosed, true);
  assert.strictEqual(resAfter.status, 'VALID');

  // Helper function verification
  assert.strictEqual(ForwardCandleValidator.isCandleConfirmedClosed(candleStartTs, candleCloseTs), true);
  assert.strictEqual(ForwardCandleValidator.isCandleConfirmedClosed(candleStartTs, candleCloseTs - 1), false);
});

// -----------------------------------------------------------------------------
// TEST 6: FORWARD PAPER ENGINE PROCESS CANDLE LIFECYCLE
// -----------------------------------------------------------------------------
runTest('ENGINE DATA SAFETY - Active forming candle returns INCOMPLETE without marking DATA_UNSAFE', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);

  const candleStartTs = parseTwelveDataTimestamp('2026-09-29 10:00:00');
  const candleCloseTs = candleStartTs + 15 * 60 * 1000;

  const candle1: Candle = {
    timestamp: candleStartTs,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  // 1. Process as confirmed candle at 10:15:00 UTC
  const res1 = engine.processCandle(candle1, candleCloseTs);
  assert.strictEqual(res1.validation.isValid, true);
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-29T10:00:00.000Z');

  // 2. Process next forming candle at 10:20:00 UTC (start 10:15:00, close 10:30:00)
  const formingCandle: Candle = {
    timestamp: candleCloseTs,
    open: 2652,
    high: 2658,
    low: 2651,
    close: 2656,
    volume: 45,
    isVerified: true,
  };
  const resForming = engine.processCandle(formingCandle, candleCloseTs + 5 * 60 * 1000);
  assert.strictEqual(resForming.validation.isValid, false);
  assert.strictEqual(resForming.validation.status, 'INCOMPLETE');
  
  // CRITICAL REQUIREMENT: Data safety must remain DATA_SAFE during active forming candle polling!
  assert.strictEqual(
    engine.getStatus().dataStatus,
    'DATA_SAFE',
    'Active forming candle must NOT trigger DATA_UNSAFE state'
  );
  // Signals count must not be incremented for unclosed candle
  assert.strictEqual(resForming.positionOpened, null);
  assert.strictEqual(resForming.positionsClosed.length, 0);

  // 3. Once forming candle reaches close time (10:30:00 UTC), engine processes it as valid
  const resClosed = engine.processCandle(formingCandle, candleCloseTs + 15 * 60 * 1000);
  assert.strictEqual(resClosed.validation.isValid, true);
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-29T10:15:00.000Z');
});

// -----------------------------------------------------------------------------
// TEST 7: FORWARD DATA ORDERING & CHRONOLOGICAL REGRESSION PROTECTION
// -----------------------------------------------------------------------------
runTest('CHRONOLOGICAL ORDERING - 07:00 followed by 07:15 = ACCEPT', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);

  const ts0700 = parseTwelveDataTimestamp('2026-09-30 07:00:00');
  const ts0715 = parseTwelveDataTimestamp('2026-09-30 07:15:00');
  const close0715 = ts0715; // 07:00 candle closes at 07:15
  const close0730 = ts0715 + 15 * 60 * 1000; // 07:15 candle closes at 07:30

  const candle0700: Candle = {
    timestamp: ts0700,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  const candle0715: Candle = {
    timestamp: ts0715,
    open: 2652,
    high: 2658,
    low: 2651,
    close: 2656,
    volume: 120,
    isVerified: true,
  };

  // Step 1: Ingest 07:00 candle at close (07:15 UTC) -> ACCEPT
  const res1 = engine.processCandle(candle0700, close0715);
  assert.strictEqual(res1.validation.isValid, true);
  assert.strictEqual(res1.validation.status, 'VALID');
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-30T07:00:00.000Z');

  // Step 2: Ingest 07:15 candle at close (07:30 UTC) -> ACCEPT
  const res2 = engine.processCandle(candle0715, close0730);
  assert.strictEqual(res2.validation.isValid, true);
  assert.strictEqual(res2.validation.status, 'VALID');
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-30T07:15:00.000Z');
});

runTest('CHRONOLOGICAL ORDERING - 07:15 followed by delayed 07:00 = safely ignored/rejected', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);

  const ts0700 = parseTwelveDataTimestamp('2026-09-30 07:00:00');
  const ts0715 = parseTwelveDataTimestamp('2026-09-30 07:15:00');
  const close0730 = ts0715 + 15 * 60 * 1000;

  const candle0715: Candle = {
    timestamp: ts0715,
    open: 2652,
    high: 2658,
    low: 2651,
    close: 2656,
    volume: 120,
    isVerified: true,
  };

  const delayed0700: Candle = {
    timestamp: ts0700,
    open: 2650,
    high: 2655,
    low: 2648,
    close: 2652,
    volume: 100,
    isVerified: true,
  };

  // 1. Confirm 07:15 first
  const res1 = engine.processCandle(candle0715, close0730);
  assert.strictEqual(res1.validation.isValid, true);
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-30T07:15:00.000Z');
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');

  // 2. Delayed 07:00 candle arrives after 07:15 has already been confirmed
  const resDelayed = engine.processCandle(delayed0700, close0730);
  
  // Must be rejected/safely ignored as OUT_OF_ORDER
  assert.strictEqual(resDelayed.validation.isValid, false);
  assert.strictEqual(resDelayed.validation.status, 'OUT_OF_ORDER');
  
  // CRITICAL: Engine MUST NOT regress lastCandle
  assert.strictEqual(
    engine.getStatus().lastCandle?.datetime,
    '2026-09-30T07:15:00.000Z',
    'lastCandle must remain at newer confirmed 07:15 candle, never regress to 07:00'
  );
  
  // CRITICAL: Engine MUST NOT be falsely marked as DATA_UNSAFE
  assert.strictEqual(
    engine.getStatus().dataStatus,
    'DATA_SAFE',
    'Delayed older candle must NOT flip engine to DATA_UNSAFE'
  );

  // CRITICAL: No trades opened/closed by delayed candle
  assert.strictEqual(resDelayed.positionOpened, null);
  assert.strictEqual(resDelayed.positionsClosed.length, 0);
});

runTest('CHRONOLOGICAL ORDERING - Duplicate candle = safely ignored', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);

  const ts0715 = parseTwelveDataTimestamp('2026-09-30 07:15:00');
  const close0730 = ts0715 + 15 * 60 * 1000;

  const candle0715: Candle = {
    timestamp: ts0715,
    open: 2652,
    high: 2658,
    low: 2651,
    close: 2656,
    volume: 120,
    isVerified: true,
  };

  // First ingestion -> VALID
  const res1 = engine.processCandle(candle0715, close0730);
  assert.strictEqual(res1.validation.isValid, true);
  const initialTradesCount = engine.getTrades().length;

  // Duplicate ingestion -> DUPLICATE safely ignored
  const resDup = engine.processCandle(candle0715, close0730);
  assert.strictEqual(resDup.validation.isValid, false);
  assert.strictEqual(resDup.validation.status, 'DUPLICATE');
  assert.strictEqual(engine.getStatus().dataStatus, 'DATA_SAFE');
  assert.strictEqual(engine.getStatus().lastCandle?.datetime, '2026-09-30T07:15:00.000Z');
  assert.strictEqual(engine.getTrades().length, initialTradesCount);
});

runTest('CHRONOLOGICAL ORDERING - Future candle = rejected', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);

  const nowMs = parseTwelveDataTimestamp('2026-09-30 07:30:00');
  const futureTs = parseTwelveDataTimestamp('2026-09-30 07:45:00'); // 15m in future

  const futureCandle: Candle = {
    timestamp: futureTs,
    open: 2660,
    high: 2665,
    low: 2658,
    close: 2662,
    volume: 100,
    isVerified: true,
  };

  const res = engine.processCandle(futureCandle, nowMs);
  assert.strictEqual(res.validation.isValid, false);
  assert.strictEqual(res.validation.status, 'MALFORMED');
  assert.ok(res.validation.error?.includes('FUTURE_CANDLE_REJECTED'));
  assert.strictEqual(res.positionOpened, null);
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
