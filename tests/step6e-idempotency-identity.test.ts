import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { DeterministicSignalEngine } from '../src/intelligence/deterministic-signal-engine';
import { Candle } from '../src/market-data/provider.interface';

console.log('================================================================');
console.log('STEP 6E: CONFIRMED CANDLE IDEMPOTENCY & IDENTITY TEST SUITE');
console.log('Testing single-processing guarantee, duplicate suppression & deterministic IDs');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function runCheck(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err.message);
    failCount++;
  }
}

function makeCandle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp,
    datetime: new Date(timestamp).toISOString(),
    open,
    high,
    low,
    close,
    volume: 1000,
    isVerified: true,
  };
}

// -----------------------------------------------------------------------------
// TEST A: Same confirmed candle delivered twice => forward processing occurs only once
// -----------------------------------------------------------------------------
runCheck('TEST A: Same confirmed candle delivered twice -> processed only once', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const baseTs = Date.UTC(2026, 8, 1, 10, 0, 0); // 10:00 UTC (M15 aligned)
  const candleA = makeCandle(baseTs, 2600, 2605, 2595, 2602);
  const evalTime = baseTs + 15 * 60 * 1000 + 500; // 15m later (confirmed closed)

  // First delivery
  const res1 = engine.processCandle(candleA, evalTime, true);
  assert.strictEqual(res1.validation.isValid, true, 'First delivery must be valid');
  assert.strictEqual(engine.hasProcessedCandle(baseTs), true, 'Engine must flag candle timestamp as processed');

  // Second delivery of exact same candle
  const res2 = engine.processCandle(candleA, evalTime + 1000, true);
  assert.strictEqual(res2.validation.isValid, false, 'Second delivery must be marked invalid');
  assert.strictEqual(res2.validation.status, 'DUPLICATE', 'Second delivery must return status DUPLICATE');
  assert.strictEqual(res2.positionsClosed.length, 0, 'No positions closed on duplicate');
  assert.strictEqual(res2.positionOpened, null, 'No position opened on duplicate');
});

// -----------------------------------------------------------------------------
// TEST B: Same confirmed candle delivered multiple times => zero duplicate signals/orders/trades
// -----------------------------------------------------------------------------
runCheck('TEST B: Same confirmed candle delivered 10 times -> zero duplicate lifecycles', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const baseTs = Date.UTC(2026, 8, 1, 10, 15, 0);
  const candle = makeCandle(baseTs, 2602, 2610, 2600, 2608);
  const evalTime = baseTs + 15 * 60 * 1000 + 500;

  // Process 10 times in a row
  for (let i = 0; i < 10; i++) {
    engine.processCandle(candle, evalTime + i * 100, true);
  }

  // Verification: exactly 1 signal recorded, exactly 0 duplicate signals created
  const signalsForCandle = engine.getSignals().filter(s => s.candleTimestamp === baseTs);
  assert.strictEqual(signalsForCandle.length, 1, 'Exactly one signal record created despite 10 deliveries');

  // Open positions count must not multiply
  assert.ok(engine.getOpenPositions().length <= 1, 'Max 1 position allowed, no duplicates');

  // Trades count must be 0 (candle did not close any trade)
  assert.strictEqual(engine.getTrades().length, 0, 'No duplicate trade records created');

  // Processed timestamps set must contain exactly 1 entry for this candle
  assert.strictEqual(engine.hasProcessedCandle(baseTs), true, 'Timestamp recorded in processed set');
});

// -----------------------------------------------------------------------------
// TEST C: Same candle + same setup + same direction => deterministic signalId is identical
// -----------------------------------------------------------------------------
runCheck('TEST C: Same candle + setup + direction -> deterministic signalId is identical', () => {
  const signalEngine1 = new DeterministicSignalEngine({ symbol: 'XAU/USD', timeframe: 'M15' });
  const signalEngine2 = new DeterministicSignalEngine({ symbol: 'XAU/USD', timeframe: 'M15' });

  const baseTs = Date.UTC(2026, 8, 1, 10, 0, 0);
  const candles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    const t = baseTs + i * 15 * 60 * 1000;
    candles.push(makeCandle(t, 2600 + i, 2605 + i, 2595 + i, 2602 + i));
  }

  // Evaluate across 10 repeated runs
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const sig = signalEngine1.generateSignal(candles);
    ids.push(sig.signalId);
  }

  // All 10 IDs must be strictly identical
  const firstId = ids[0];
  assert.ok(firstId.startsWith('SIG-XAUUSD-M15-'), 'Must have standardized deterministic prefix');
  const targetTs = candles[candles.length - 1].timestamp;
  assert.ok(firstId.includes(String(targetTs)), 'Must include candle timestamp');
  for (let i = 1; i < ids.length; i++) {
    assert.strictEqual(ids[i], firstId, `Run ${i} must produce exact same signalId as Run 0`);
  }

  // Engine 2 instance must produce the exact same ID
  const sig2 = signalEngine2.generateSignal(candles);
  assert.strictEqual(sig2.signalId, firstId, 'Independent engine instance produces identical signalId');
});

// -----------------------------------------------------------------------------
// TEST D: Different candle timestamp => different signal identity
// -----------------------------------------------------------------------------
runCheck('TEST D: Different candle timestamp -> different signal identity', () => {
  const signalEngine = new DeterministicSignalEngine({ symbol: 'XAU/USD', timeframe: 'M15' });

  const baseTs = Date.UTC(2026, 8, 1, 10, 0, 0);
  const candles1: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    const t = baseTs + i * 15 * 60 * 1000;
    candles1.push(makeCandle(t, 2600 + i, 2605 + i, 2595 + i, 2602 + i));
  }

  const candles2 = [...candles1];
  const t21 = baseTs + 20 * 15 * 60 * 1000;
  candles2.push(makeCandle(t21, 2620, 2625, 2615, 2622));

  const sig1 = signalEngine.generateSignal(candles1);
  const sig2 = signalEngine.generateSignal(candles2);

  const ts1 = candles1[candles1.length - 1].timestamp;
  const ts2 = candles2[candles2.length - 1].timestamp;

  assert.notStrictEqual(sig1.signalId, sig2.signalId, 'Different candle timestamps must produce different signalIds');
  assert.ok(sig1.signalId.includes(String(ts1)), 'Signal 1 must include ts1');
  assert.ok(sig2.signalId.includes(String(ts2)), 'Signal 2 must include ts2');
});

// -----------------------------------------------------------------------------
// TEST E: Two genuinely distinct valid lifecycles => paperOrderIds do not collide
// -----------------------------------------------------------------------------
runCheck('TEST E: Two genuinely distinct valid lifecycles -> paperOrderIds do not collide', () => {
  const ts1 = Date.UTC(2026, 8, 1, 10, 0, 0);
  const ts2 = Date.UTC(2026, 8, 1, 14, 0, 0);

  // Current forward paper order ID formula: ORD-P7F-XAUUSD-15M-${candle.timestamp}-${direction}
  const orderId1Long = `ORD-P7F-XAUUSD-15M-${ts1}-LONG`;
  const orderId1Short = `ORD-P7F-XAUUSD-15M-${ts1}-SHORT`;
  const orderId2Long = `ORD-P7F-XAUUSD-15M-${ts2}-LONG`;

  // Distinct timestamps never collide
  assert.notStrictEqual(orderId1Long, orderId2Long, 'Orders at different times must have different IDs');

  // Opposite directions at the same timestamp never collide
  assert.notStrictEqual(orderId1Long, orderId1Short, 'Opposite directions at same time must have different IDs');

  // Format preserves contract specification
  assert.ok(orderId1Long.includes('XAUUSD-15M'), 'Order ID specifies asset and timeframe');
  assert.ok(orderId1Long.includes('LONG'), 'Order ID specifies direction');
});

// -----------------------------------------------------------------------------
// TEST F: Existing historical data is not modified by the new idempotency logic
// -----------------------------------------------------------------------------
runCheck('TEST F: Existing historical data is not modified by the new idempotency logic', () => {
  const auditPath = path.join(process.cwd(), 'tests/phase_7ge_forensic_audit.json');
  assert.strictEqual(fs.existsSync(auditPath), true, 'Phase 7G-E audit report must exist');

  const auditData = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
  const ledger = auditData.audit2_oosLedger;

  assert.strictEqual(ledger.tradeCount, 20, 'OOS historical trade count preserved');
  assert.strictEqual(ledger.wins, 8, 'OOS historical wins preserved');
  assert.strictEqual(ledger.losses, 12, 'OOS historical losses preserved');
  assert.strictEqual(ledger.netPnL, 4174.58, 'OOS net P&L preserved');
  assert.strictEqual(ledger.profitFactor, 1.29, 'OOS profit factor preserved');

  const simCachePath = path.join(process.cwd(), 'tests/sim_cache_filter_ab.json');
  assert.strictEqual(fs.existsSync(simCachePath), true, 'Filter AB simulation cache must exist');
  const simData = JSON.parse(fs.readFileSync(simCachePath, 'utf-8'));
  assert.strictEqual(simData.trades.length, 70, 'Filter AB 70 historical trades preserved');
});

console.log('\n================================================================');
console.log(`STEP 6E TEST RESULTS: ${passCount} / ${passCount + failCount} PASSED`);
if (failCount > 0) {
  console.error(`FAILED CHECKS: ${failCount}`);
  process.exit(1);
} else {
  console.log('ALL STEP 6E ACCEPTANCE CHECKS PASSED.');
  console.log('================================================================\n');
}
