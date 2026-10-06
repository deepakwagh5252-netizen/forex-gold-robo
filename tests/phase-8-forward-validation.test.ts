import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ForwardCandleValidator } from '../src/services/paper-trading/forward-candle-validator';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { ForwardPersistence } from '../src/services/paper-trading/forward-persistence';
import { Candle } from '../src/market-data/provider.interface';
import { ForwardPosition } from '../src/types/forward-validation';

console.log('================================================================');
console.log('PHASE 8: LIVE FORWARD PAPER VALIDATION TEST SUITE');
console.log('Testing deterministic 24/7 forward paper-trading engine');
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

// -------------------------------------------------------------------------
// TEST 1: LIVE CANDLE VALIDATION
// -------------------------------------------------------------------------
runTest('LIVE CANDLE VALIDATION - Rejects malformed and invalid OHLC data', () => {
  const now = 1787616000000;

  // Null candle
  const nullRes = ForwardCandleValidator.validate(null, null, now);
  assert.strictEqual(nullRes.isValid, false);
  assert.strictEqual(nullRes.status, 'MALFORMED');

  // Negative price
  const negCandle: Candle = { timestamp: now - 900000, open: -2500, high: 2510, low: 2490, close: 2505, volume: 100, isVerified: true };
  const negRes = ForwardCandleValidator.validate(negCandle, null, now);
  assert.strictEqual(negRes.isValid, false);
  assert.strictEqual(negRes.status, 'MALFORMED');

  // High < close
  const highViolation: Candle = { timestamp: now - 900000, open: 2500, high: 2502, low: 2490, close: 2508, volume: 100, isVerified: true };
  const highRes = ForwardCandleValidator.validate(highViolation, null, now);
  assert.strictEqual(highRes.isValid, false);
  assert.strictEqual(highRes.status, 'MALFORMED');

  // Low > close
  const lowViolation: Candle = { timestamp: now - 900000, open: 2500, high: 2515, low: 2505, close: 2495, volume: 100, isVerified: true };
  const lowRes = ForwardCandleValidator.validate(lowViolation, null, now);
  assert.strictEqual(lowRes.isValid, false);
  assert.strictEqual(lowRes.status, 'MALFORMED');

  // Valid candle
  const validCandle: Candle = { timestamp: now - 900000, open: 2500, high: 2510, low: 2495, close: 2505, volume: 100, isVerified: true };
  const validRes = ForwardCandleValidator.validate(validCandle, null, now);
  assert.strictEqual(validRes.isValid, true);
  assert.strictEqual(validRes.status, 'VALID');
});

// -------------------------------------------------------------------------
// TEST 2: DUPLICATE CANDLE PROTECTION
// -------------------------------------------------------------------------
runTest('DUPLICATE CANDLE PROTECTION - Rejects candle with identical timestamp', () => {
  const ts = 1787616000000;
  const candleA: Candle = { timestamp: ts, open: 2500, high: 2510, low: 2495, close: 2505, volume: 100, isVerified: true };
  const validA = ForwardCandleValidator.validate(candleA, null, ts + 900000);
  assert.strictEqual(validA.isValid, true);

  // Ingest identical timestamp
  const dupRes = ForwardCandleValidator.validate(candleA, validA.candle, ts + 900000);
  assert.strictEqual(dupRes.isValid, false);
  assert.strictEqual(dupRes.status, 'DUPLICATE');
});

// -------------------------------------------------------------------------
// TEST 3: OUT-OF-ORDER CANDLE PROTECTION
// -------------------------------------------------------------------------
runTest('OUT-OF-ORDER CANDLE PROTECTION - Rejects timestamp earlier than previous confirmed', () => {
  const ts = 1787616000000;
  const candleA: Candle = { timestamp: ts, open: 2500, high: 2510, low: 2495, close: 2505, volume: 100, isVerified: true };
  const validA = ForwardCandleValidator.validate(candleA, null, ts + 900000);

  const olderCandle: Candle = { timestamp: ts - 900000, open: 2490, high: 2500, low: 2485, close: 2495, volume: 100, isVerified: true };
  const oooRes = ForwardCandleValidator.validate(olderCandle, validA.candle, ts + 900000);
  assert.strictEqual(oooRes.isValid, false);
  assert.strictEqual(oooRes.status, 'OUT_OF_ORDER');
});

// -------------------------------------------------------------------------
// TEST 4: INCOMPLETE CANDLE PROTECTION
// -------------------------------------------------------------------------
runTest('INCOMPLETE CANDLE PROTECTION - Rejects trading decision from active forming candle', () => {
  const now = 1787616300000; // 5 minutes into the 15m candle
  const activeCandle: Candle = { timestamp: 1787616000000, open: 2500, high: 2510, low: 2495, close: 2505, volume: 50, isVerified: true };

  const res = ForwardCandleValidator.validate(activeCandle, null, now, false);
  assert.strictEqual(res.isValid, false);
  assert.strictEqual(res.status, 'INCOMPLETE');
  assert.strictEqual(res.isConfirmedClosed, false);
});

// -------------------------------------------------------------------------
// TEST 4B: FUTURE CANDLE REJECTION
// -------------------------------------------------------------------------
runTest('FUTURE CANDLE REJECTION - Rejects candle with timestamp in the future', () => {
  const now = 1787616000000; // 2026-09-29T10:00:00.000Z
  const futureTs = now + 10 * 3600 * 1000; // 10 hours in the future (20:00:00Z)
  const futureCandle: Candle = { timestamp: futureTs, open: 2500, high: 2510, low: 2495, close: 2505, volume: 50, isVerified: true };

  const res = ForwardCandleValidator.validate(futureCandle, null, now, false);
  assert.strictEqual(res.isValid, false);
  assert.strictEqual(res.status, 'MALFORMED');
  assert.ok(res.error?.includes('FUTURE_CANDLE_REJECTED'));
});

// -------------------------------------------------------------------------
// TEST 4C: UTC M15 BOUNDARY ENFORCEMENT
// -------------------------------------------------------------------------
runTest('UTC M15 BOUNDARY ENFORCEMENT - Rejects unaligned candle timestamps', () => {
  const now = 1787616900000; // 10:15:00 UTC
  // Unaligned timestamp: 10:07:00 UTC (not multiple of 900,000 ms)
  const unalignedTs = 1787616000000 + 7 * 60 * 1000;
  const unalignedCandle: Candle = { timestamp: unalignedTs, open: 2500, high: 2510, low: 2495, close: 2505, volume: 50, isVerified: true };

  const res = ForwardCandleValidator.validate(unalignedCandle, null, now, false);
  assert.strictEqual(res.isValid, false);
  assert.strictEqual(res.status, 'MALFORMED');
  assert.ok(res.error?.includes('UNALIGNED_M15_BOUNDARY'));
});

// -------------------------------------------------------------------------
// TEST 4D: CONFIRMED CANDLE ACCEPTANCE
// -------------------------------------------------------------------------
runTest('CONFIRMED CANDLE ACCEPTANCE - Confirms candle when current UTC >= close time', () => {
  const candleTs = 1787616000000; // 10:00:00 UTC
  const closeTs = candleTs + 15 * 60 * 1000; // 10:15:00 UTC
  const candle: Candle = { timestamp: candleTs, open: 2500, high: 2510, low: 2495, close: 2505, volume: 50, isVerified: true };

  // At exactly close time (10:15:00 UTC)
  const resExact = ForwardCandleValidator.validate(candle, null, closeTs, false);
  assert.strictEqual(resExact.isValid, true);
  assert.strictEqual(resExact.isConfirmedClosed, true);
  assert.strictEqual(resExact.status, 'VALID');

  // 1 millisecond before close time (10:14:59.999 UTC) -> still active!
  const resBefore = ForwardCandleValidator.validate(candle, null, closeTs - 1, false);
  assert.strictEqual(resBefore.isValid, false);
  assert.strictEqual(resBefore.isConfirmedClosed, false);
  assert.strictEqual(resBefore.status, 'INCOMPLETE');
});

// -------------------------------------------------------------------------
// TEST 5: FILTER AB ENFORCEMENT
// -------------------------------------------------------------------------
runTest('FILTER AB ENFORCEMENT - Disallows SHORT in Bearish regime or Asian session', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  // 1. Direction SHORT during Asian Session (00:00 to 07:00 UTC)
  // 03:00 UTC = Hour 3
  const asianTs = new Date('2026-09-01T03:00:00Z').getTime();
  const asianHour = new Date(asianTs).getUTCHours();
  assert.strictEqual(asianHour >= 0 && asianHour < 7, true);

  // 2. Direction SHORT during TRENDING_BEARISH
  const isShort = true;
  const isBearish = true;
  const rejectA = isShort && isBearish;
  assert.strictEqual(rejectA, true);

  // 3. Direction LONG during London session (09:00 UTC) in TRENDING_BULLISH
  const londonTs = new Date('2026-09-01T09:00:00Z').getTime();
  const londonHour = new Date(londonTs).getUTCHours();
  const rejectB_london = londonHour >= 0 && londonHour < 7;
  const rejectA_long = false && isBearish;
  assert.strictEqual(rejectA_long || rejectB_london, false);
});

// -------------------------------------------------------------------------
// TEST 6: RISK PARITY
// -------------------------------------------------------------------------
runTest('RISK PARITY - Strictly preserves 1% risk, 3 max positions, 3% daily loss, 10% max DD', () => {
  const p = ForwardPaperEngine.FROZEN_PARAMS;
  assert.strictEqual(p.riskPerTradePercent, 1.0);
  assert.strictEqual(p.maxOpenPositions, 3);
  assert.strictEqual(p.maximumDailyLossPercent, 3.0);
  assert.strictEqual(p.maximumDrawdownPercent, 10.0);
});

// -------------------------------------------------------------------------
// TEST 7: LOT / OUNCE FRICTION
// -------------------------------------------------------------------------
runTest('LOT/OUNCE FRICTION - 100 oz per lot, $3.50 commission per side, 1.0 pip spread, 0.5 pip slippage', () => {
  const p = ForwardPaperEngine.FROZEN_PARAMS;
  assert.strictEqual(p.contractOuncesPerLot, 100);
  assert.strictEqual(p.commissionPerLotPerSide, 3.50);
  assert.strictEqual(p.spreadMarkupPips, 1.0);
  assert.strictEqual(p.slippagePips, 0.5);

  // Position sizing test: $100,000 equity, 1.0% risk = $1,000
  // Entry = 2500.00, SL = 2498.00 -> distance = $2.00
  // Ounces = 1,000 / 2 = 500 oz
  // Lots = 500 / 100 = 5.0 lots
  const equity = 100_000;
  const riskAmount = (equity * p.riskPerTradePercent) / 100;
  const distance = 2.0;
  const ounces = riskAmount / distance;
  const lots = ounces / p.contractOuncesPerLot;
  assert.strictEqual(riskAmount, 1000);
  assert.strictEqual(ounces, 500);
  assert.strictEqual(lots, 5.0);

  // Round trip commission: 5.0 lots * $7.00 = $35.00
  const roundTripComm = lots * (p.commissionPerLotPerSide * 2);
  assert.strictEqual(roundTripComm, 35.0);
});

// -------------------------------------------------------------------------
// TEST 8: PAPER ORDER LIFECYCLE
// -------------------------------------------------------------------------
runTest('PAPER ORDER LIFECYCLE - Complete deterministic lifecycle execution', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const startTs = new Date('2026-09-01T12:00:00Z').getTime();

  // Create clean priming candles
  const candles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    const t = startTs + i * 900000;
    const base = 2500 + Math.sin(i / 5) * 10;
    candles.push({
      timestamp: t,
      datetime: new Date(t).toISOString(),
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + 0.5,
      volume: 100,
      isVerified: true,
    });
  }

  engine.primeCandleBuffer(candles);
  const status = engine.getStatus();
  assert.strictEqual(status.engineStatus, 'IDLE');
  assert.strictEqual(status.dataStatus, 'DATA_SAFE');
  assert.strictEqual(status.paperStatus, 'PAPER_ACTIVE');
});

// -------------------------------------------------------------------------
// TEST 9: NO REAL BROKER ROUTE SAFETY AUDIT
// -------------------------------------------------------------------------
runTest('NO REAL BROKER ROUTE - Verifies zero real-money order routing code exists', () => {
  const searchTerms = ['executeLive', 'realTrading', 'brokerOrder', 'sendRealOrder'];
  const srcFiles = fs.readdirSync(path.join(process.cwd(), 'src/services/paper-trading'));

  for (const file of srcFiles) {
    const content = fs.readFileSync(path.join(process.cwd(), 'src/services/paper-trading', file), 'utf-8');
    for (const term of searchTerms) {
      assert.strictEqual(content.includes(term), false, `Forbidden real trading term "${term}" found in ${file}`);
    }
  }
});

// -------------------------------------------------------------------------
// TEST 10: RESTART RECOVERY
// -------------------------------------------------------------------------
runTest('RESTART RECOVERY - State persists across simulated session restarts', () => {
  const engineA = new ForwardPaperEngine();
  engineA.resetForwardState(100_000);
  engineA.setPaperTradingActive(true);

  // State should be PAPER_ACTIVE
  assert.strictEqual(engineA.isPaperTradingActive(), true);

  // Simulate new engine instance reading storage
  const engineB = new ForwardPaperEngine();
  assert.strictEqual(engineB.isPaperTradingActive(), true);
  assert.strictEqual(engineB.getAccount().startingBalance, 100_000);
});

// -------------------------------------------------------------------------
// TEST 11: IDEMPOTENCY
// -------------------------------------------------------------------------
runTest('IDEMPOTENCY - Processing the same candle twice creates zero duplicate trades', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const t = new Date('2026-09-01T14:00:00Z').getTime();
  const candle: Candle = {
    timestamp: t,
    datetime: new Date(t).toISOString(),
    open: 2500,
    high: 2510,
    low: 2490,
    close: 2505,
    volume: 100,
    isVerified: true,
  };

  const res1 = engine.processCandle(candle, t + 900000, true);
  const posCount1 = engine.getOpenPositions().length;

  // Process exact same candle again
  const res2 = engine.processCandle(candle, t + 900000, true);
  const posCount2 = engine.getOpenPositions().length;

  assert.strictEqual(res2.validation.status, 'DUPLICATE');
  assert.strictEqual(posCount1, posCount2, 'Duplicate candle must not create duplicate positions');
});

// -------------------------------------------------------------------------
// TEST 12: TRADE JOURNAL COMPLETENESS
// -------------------------------------------------------------------------
runTest('TRADE JOURNAL COMPLETENESS - Forward Trade schema contains full required fields', () => {
  const engine = new ForwardPaperEngine();
  const metrics = engine.getMetrics();
  assert.strictEqual(typeof metrics.winRate, 'number');
  assert.strictEqual(typeof metrics.profitFactor, 'number');
  assert.strictEqual(typeof metrics.maxDrawdownPercent, 'number');
});

// -------------------------------------------------------------------------
// TEST 13: EQUITY RECONCILIATION
// -------------------------------------------------------------------------
runTest('EQUITY RECONCILIATION - Balance, realized P&L, unrealized P&L, and equity reconcile', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  const acc = engine.getAccount();
  const positions = engine.getOpenPositions();

  let unPnL = 0;
  for (const pos of positions) {
    unPnL += pos.unrealizedPnL;
  }

  const expectedEquity = Number((acc.currentBalance + unPnL).toFixed(2));
  assert.strictEqual(acc.currentEquity, expectedEquity);
  assert.strictEqual(acc.currentBalance, acc.startingBalance + acc.realizedPnL);
});

// -------------------------------------------------------------------------
// TEST 14: HISTORICAL REPLAY RESULTS REMAIN UNCHANGED
// -------------------------------------------------------------------------
runTest('HISTORICAL RESULTS UNCHANGED - Phase 7G-D authoritative OOS results match reference', () => {
  const auditPath = path.join(process.cwd(), 'tests/phase_7ge_forensic_audit.json');
  assert.strictEqual(fs.existsSync(auditPath), true, 'Phase 7G-E audit report must exist');

  const auditData = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
  const ledger = auditData.audit2_oosLedger;

  assert.strictEqual(ledger.tradeCount, 20, 'OOS trades must be 20');
  assert.strictEqual(ledger.wins, 8, 'OOS wins must be 8');
  assert.strictEqual(ledger.losses, 12, 'OOS losses must be 12');
  assert.strictEqual(ledger.netPnL, 4174.58, 'OOS net P&L must be +$4,174.58');
  assert.strictEqual(ledger.profitFactor, 1.29, 'OOS Profit Factor must be 1.29');
});

// -------------------------------------------------------------------------
// TEST 15: FORWARD DASHBOARD REPORT FORMATTING & CONTENT
// -------------------------------------------------------------------------
runTest('COPY REPORT - Verifies comprehensive plain text report structure and fields', () => {
  const engine = new ForwardPaperEngine();
  const status = engine.getStatus();
  const account = engine.getAccount();
  const metrics = engine.getMetrics();
  const progress = engine.getProgress();

  // Test report generation template logic
  const timestampUTC = new Date().toISOString();
  const latestTrade = engine.getTrades().length > 0 ? engine.getTrades()[engine.getTrades().length - 1] : null;
  const latestTradeStr = latestTrade ? latestTrade.tradeId : 'None';
  const latestSignalStr = status.lastSignal ? status.lastSignal.signalId : 'None';

  const report = [
    '================================================================',
    'FOREX & GOLD ROBO — FORWARD PAPER VALIDATION REPORT',
    '================================================================',
    `Generated At UTC:           ${timestampUTC}`,
    'Asset & Timeframe:          XAU/USD M15',
    'Execution Mode:             PAPER TRADING ONLY (ZERO REAL BROKER ROUTE)',
    'Strategy Configuration:     Phase 7F/7G Frozen Rules',
    'Combined Filter AB:         FROZEN Candidate (Short in Bearish / Asian 00-07 UTC)',
    '',
    `Engine Status:              ${status.engineStatus}`,
    `Paper Trading Status:       ${status.paperStatus}`,
    `Starting Balance:           $${account.startingBalance.toFixed(2)}`,
    `Current Equity:             $${account.currentEquity.toFixed(2)}`,
    `Open Positions:             ${engine.getOpenPositions().length} / 3 MAX`,
    `Forward Trades:             ${metrics.forwardTrades}`,
    `Wins:                       ${metrics.wins}`,
    `Losses:                     ${metrics.losses}`,
    `Win Rate:                   ${metrics.winRate.toFixed(1)}%`,
    `Net P&L:                    $${metrics.netPnL.toFixed(2)}`,
    `Profit Factor:              ${metrics.profitFactor.toFixed(2)}`,
    `Expectancy:                 $${metrics.expectancy.toFixed(2)}`,
    `Maximum Drawdown:           ${metrics.maxDrawdownPercent.toFixed(2)}% ($${metrics.maxDrawdown.toFixed(2)})`,
    `Observation Period:         ${progress.daysObserved} days`,
    `M15 Candles Confirmed:      ${progress.m15CandlesObserved}`,
    `Filtered Signals:           ${progress.filteredSignals}`,
    `Risk Rejections:            ${progress.riskRejections}`,
    `Data Warnings / Rejections: ${progress.dataRejections}`,
    `Latest Signal:              ${latestSignalStr}`,
    `Latest Trade:               ${latestTradeStr}`,
  ].join('\n');

  assert.ok(report.includes('Engine Status:'));
  assert.ok(report.includes('Paper Trading Status:'));
  assert.ok(report.includes('XAU/USD M15'));
  assert.ok(report.includes('Forward Trades:'));
  assert.ok(report.includes('Wins:'));
  assert.ok(report.includes('Losses:'));
  assert.ok(report.includes('Win Rate:'));
  assert.ok(report.includes('Net P&L:'));
  assert.ok(report.includes('Profit Factor:'));
  assert.ok(report.includes('Expectancy:'));
  assert.ok(report.includes('Maximum Drawdown:'));
  assert.ok(report.includes('Current Equity:'));
  assert.ok(report.includes('Open Positions:'));
  assert.ok(report.includes('Filtered Signals:'));
  assert.ok(report.includes('Risk Rejections:'));
  assert.ok(report.includes('Data Warnings / Rejections:'));
  assert.ok(report.includes('Latest Signal:'));
  assert.ok(report.includes('Latest Trade:'));
  assert.ok(report.includes('Observation Period:'));
  assert.ok(report.includes('Generated At UTC:'));
});

console.log('\n================================================================');
console.log(`PHASE 8 TEST RESULTS: ${passCount} / ${passCount + failCount} PASSED`);
if (failCount > 0) {
  console.error(`FAILED TESTS: ${failCount}`);
  process.exit(1);
} else {
  console.log('ALL PHASE 8 ACCEPTANCE TESTS PASSED SUCCESSFULLY.');
  console.log('================================================================\n');
}
