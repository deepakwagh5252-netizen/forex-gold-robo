import assert from 'node:assert';
import { Step5GoldenEquivalenceService } from '../src/services/replay/step5-golden-equivalence-service';

console.log('================================================================');
console.log('STEP 5: GOLDEN FORWARD <-> REPLAY EQUIVALENCE TEST SUITE');
console.log('Testing side-by-side lifecycle, accounting, identity, & event parity');
console.log('================================================================\n');

let totalChecks = 0;
let passedChecks = 0;

function check(name: string, fn: () => void) {
  totalChecks++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedChecks++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err.message);
  }
}

// Execute the canonical golden equivalence report
const report = Step5GoldenEquivalenceService.runEquivalenceReport();

// -----------------------------------------------------------------------------
// SECTION 1: ACCOUNTING & NET P&L PARITY
// -----------------------------------------------------------------------------
check('1. Exact Starting & Ending Balance Parity', () => {
  assert.strictEqual(report.summaryMetrics.forward.startingBalance, 100_000, 'Forward starting balance is 100k');
  assert.strictEqual(report.summaryMetrics.replay.startingBalance, 100_000, 'Replay starting balance is 100k');
  assert.strictEqual(report.summaryMetrics.forward.endingBalance, report.summaryMetrics.replay.endingBalance, 'Ending balance matches exactly');
  assert.strictEqual(report.summaryMetrics.forward.endingBalance, 101_980.65, 'Ending balance is exactly $101,980.65');
});

check('2. Net Realized P&L and Balance Delta Parity', () => {
  const fwdDelta = Number((report.summaryMetrics.forward.endingBalance - report.summaryMetrics.forward.startingBalance).toFixed(2));
  const repDelta = Number((report.summaryMetrics.replay.endingBalance - report.summaryMetrics.replay.startingBalance).toFixed(2));
  assert.strictEqual(report.summaryMetrics.forward.netPnL, report.summaryMetrics.replay.netPnL, 'Net P&L matches');
  assert.strictEqual(report.summaryMetrics.forward.netPnL, 1980.65, 'Net P&L is +$1,980.65');
  assert.strictEqual(fwdDelta, report.summaryMetrics.forward.netPnL, 'Forward delta equals net P&L');
  assert.strictEqual(repDelta, report.summaryMetrics.replay.netPnL, 'Replay delta equals net P&L');
});

check('3. Commission & Total Fees Parity', () => {
  assert.strictEqual(report.summaryMetrics.forward.totalFees, report.summaryMetrics.replay.totalFees, 'Total fees match');
  assert.strictEqual(report.summaryMetrics.forward.totalFees, 5.02, 'Total fees is $5.02 (0.7166 lots * $7.00 round trip)');
});

// -----------------------------------------------------------------------------
// SECTION 2: LIFECYCLE IDENTIFIERS PARITY
// -----------------------------------------------------------------------------
check('4. Trade, Order, and Position Deterministic ID Parity', () => {
  assert.strictEqual(report.tradeComparisons.length, 1, 'Exactly one closed trade generated in canonical run');
  const trade = report.tradeComparisons[0];

  const tradeIdComp = trade.fields.find(f => f.field === 'tradeId');
  const orderIdComp = trade.fields.find(f => f.field === 'paperOrderId');
  const posIdComp = trade.fields.find(f => f.field === 'positionId');

  assert.ok(tradeIdComp, 'tradeId comparison present');
  assert.strictEqual(tradeIdComp.status, 'MATCH', 'tradeId matches between Forward and Replay');
  assert.strictEqual(tradeIdComp.forwardValue, 'TRD-P7F-XAUUSD-15M-1788275700000-LONG');

  assert.ok(orderIdComp, 'paperOrderId comparison present');
  assert.strictEqual(orderIdComp.status, 'MATCH', 'paperOrderId matches between Forward and Replay');
  assert.strictEqual(orderIdComp.forwardValue, 'ORD-P7F-XAUUSD-15M-1788275700000-LONG');

  assert.ok(posIdComp, 'positionId comparison present');
  assert.strictEqual(posIdComp.status, 'MATCH', 'positionId matches between Forward and Replay');
  assert.strictEqual(posIdComp.forwardValue, 'POS-P7F-XAUUSD-15M-1788275700000-LONG');
});

// -----------------------------------------------------------------------------
// SECTION 3: PRICING, SIZING & SL/TP PARITY
// -----------------------------------------------------------------------------
check('5. Execution Pricing, Direction & Sizing Parity', () => {
  const trade = report.tradeComparisons[0];

  const dirComp = trade.fields.find(f => f.field === 'direction');
  const entryComp = trade.fields.find(f => f.field === 'entryPrice');
  const exitComp = trade.fields.find(f => f.field === 'exitPrice');
  const qtyComp = trade.fields.find(f => f.field === 'quantityOunces');
  const slComp = trade.fields.find(f => f.field === 'stopLoss');
  const tpComp = trade.fields.find(f => f.field === 'takeProfit');

  assert.strictEqual(dirComp?.status, 'MATCH');
  assert.strictEqual(entryComp?.status, 'MATCH');
  assert.strictEqual(exitComp?.status, 'MATCH');
  assert.strictEqual(qtyComp?.status, 'MATCH');
  assert.strictEqual(slComp?.status, 'MATCH');
  assert.strictEqual(tpComp?.status, 'MATCH');

  assert.strictEqual(entryComp?.forwardValue, 2409.1);
  assert.strictEqual(exitComp?.forwardValue, 2436.8082);
  assert.strictEqual(qtyComp?.forwardValue, 71.6635);
  assert.strictEqual(slComp?.forwardValue, 2395.0459);
  assert.strictEqual(tpComp?.forwardValue, 2436.9082);
});

// -----------------------------------------------------------------------------
// SECTION 4: MISMATCH DIAGNOSTIC REGISTRY AUDIT (NO AUTO-FIX)
// -----------------------------------------------------------------------------
check('6. Mismatch Registry Captures Diagnostic Details Accurately', () => {
  console.log(`\n--- Mismatch Audit (${report.totalMismatches} discrepancies recorded across ${report.totalComparisons} total fields) ---`);
  for (const m of report.mismatchesList) {
    console.log(`  [MISMATCH RECORDED] Field: ${m.field} | Fwd: ${JSON.stringify(m.forwardValue)} | Rep: ${JSON.stringify(m.replayValue)} | Candle: ${m.candleTimestamp} (${m.candleTimeUtc})`);
  }
  // Verify that mismatches are strictly catalogued with timestamp and values
  for (const m of report.mismatchesList) {
    assert.ok(m.field, 'Field name must be present');
    assert.ok(m.candleTimestamp > 0, 'Candle timestamp must be positive number');
    assert.ok(m.candleTimeUtc, 'Candle UTC datetime must be present');
    assert.notStrictEqual(m.forwardValue, m.replayValue, 'Values must actually diverge');
  }
});

console.log('\n================================================================');
console.log(`STEP 5 TEST CHECKS: ${totalChecks} | PASSED: ${passedChecks} | FAILED: ${totalChecks - passedChecks}`);
console.log(`EQUIVALENCE PARITY RATE: ${report.matchPercentage}% (${report.totalMatches}/${report.totalComparisons} matches)`);
console.log('================================================================\n');

if (totalChecks !== passedChecks) {
  process.exit(1);
}
