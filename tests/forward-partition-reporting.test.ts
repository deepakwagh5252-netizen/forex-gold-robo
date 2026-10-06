import assert from 'node:assert';
import {
  partitionForwardTrades,
  calculateCleanMetrics,
  calculateHistoricalMetrics,
  STEP_6E_DEPLOYMENT_CUTOFF_UTC,
  STEP_6E_DEPLOYMENT_CUTOFF_MS,
} from '../src/utils/forward-partition';
import { ForwardTrade } from '../src/types/forward-validation';

console.log('================================================================');
console.log('FORWARD REPORTING PARTITION TEST SUITE');
console.log('Testing clean post-Step-6E forward validation vs historical archive');
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

// Helper to make a mock trade record
function makeMockTrade(
  id: string,
  candleTs: string,
  execTs: string,
  dir: 'LONG' | 'SHORT',
  netPnL: number,
  isWin: boolean,
  fees: number = 4.72
): ForwardTrade {
  const exitTime = new Date(new Date(execTs).getTime() + 1800000).toISOString();
  return {
    tradeId: id,
    positionId: `POS-${id}`,
    signalId: `SIG-${id}`,
    paperOrderId: `ORD-${id}`,
    symbol: 'XAU/USD',
    direction: dir,
    timeframe: 'M15',
    signalCandleTimeUtc: candleTs,
    entryRequestedAtUtc: execTs,
    entryExecutedAtUtc: execTs,
    exitRequestedAtUtc: exitTime,
    exitExecutedAtUtc: exitTime,
    openedAt: execTs,
    closedAt: exitTime,
    entryPrice: 2650.0,
    exitPrice: isWin ? 2660.0 : 2645.0,
    stopLoss: isWin ? 2645.0 : 2645.0,
    initialStopLoss: 2645.0,
    takeProfit: isWin ? 2660.0 : 2660.0,
    initialTakeProfit: 2660.0,
    lotSize: 0.1,
    positionSize: 10,
    quantity: 10,
    grossPnL: isWin ? netPnL + fees : netPnL + fees,
    netPnL,
    commission: 2.0,
    fees,
    spreadCost: 0.61,
    slippageCost: 0.61,
    slippage: 0.61,
    totalFees: fees,
    closeReason: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
    exitReason: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
    isWin,
    rMultiple: isWin ? 2.0 : -1.0,
    strategyVersion: 'Phase 7F/7G Frozen Breakout-Retest',
    filterVersion: 'Filter AB Frozen',
    riskConfigurationVersion: 'Phase 8 Frozen 1% Risk / 3 Max Pos',
    createdAtUtc: execTs,
    updatedAtUtc: exitTime,
    attribution: {
      direction: dir,
      regime: 'TRENDING_BEARISH',
      session: 'ASIAN',
      filterStatus: 'PASS',
      riskState: 'PASS',
      exitReason: isWin ? 'TAKE_PROFIT' : 'STOP_LOSS',
      pnl: netPnL,
      entryQualityEvidence: ['TEST'],
    },
  };
}

// -----------------------------------------------------------------------------
// TEST 1: Exact Step 6E Cutoff timestamp matches test suite metadata
// -----------------------------------------------------------------------------
runCheck('TEST 1: Step 6E cutoff timestamp matches project deployment metadata', () => {
  assert.strictEqual(STEP_6E_DEPLOYMENT_CUTOFF_UTC, '2026-10-05T08:16:15.264Z');
  assert.strictEqual(typeof STEP_6E_DEPLOYMENT_CUTOFF_MS, 'number');
  assert.ok(STEP_6E_DEPLOYMENT_CUTOFF_MS > 0);
});

// -----------------------------------------------------------------------------
// TEST 2: Partitioning 15 historical records (9 genuine, 6 duplicates)
// -----------------------------------------------------------------------------
runCheck('TEST 2: Partitioning 15 historical records yields 0 clean trades and 15 archive records', () => {
  // Construct 15 historical records created prior to Step 6E boundary
  // 9 genuine candles, with 6 duplicate incidents (repeated candleTs + dir)
  const pre6eBase = '2026-09-28T10:00:00.000Z';
  const mock15: ForwardTrade[] = [];

  // 9 distinct candle setups
  for (let i = 1; i <= 9; i++) {
    const candleTime = `2026-09-28T1${i}:00:00.000Z`;
    const execTime = `2026-09-28T1${i}:15:05.100Z`; // Pre-6E execution time
    mock15.push(makeMockTrade(`TRD-GENUINE-${i}`, candleTime, execTime, 'SHORT', 1200, true));
  }

  // 6 duplicate incidents from the earlier candles
  const dupeCandles = [1, 2, 3, 4, 5, 6];
  for (const c of dupeCandles) {
    const candleTime = `2026-09-28T1${c}:00:00.000Z`; // Same candle timestamp
    const execTime = `2026-09-28T1${c}:15:10.500Z`; // Re-evaluation duplicate
    mock15.push(makeMockTrade(`TRD-DUPE-${c}`, candleTime, execTime, 'SHORT', 1200, true));
  }

  assert.strictEqual(mock15.length, 15, 'Total historical records must be 15');

  const partition = partitionForwardTrades(mock15);

  // A. Clean Post-Step-6E subset must be strictly 0
  assert.strictEqual(partition.cleanTrades.length, 0, 'Clean forward trades count must be 0');
  assert.strictEqual(partition.cleanMetrics.tradeCount, 0, 'Clean metrics trade count must be 0');
  assert.strictEqual(partition.cleanMetrics.wins, 0, 'Clean metrics wins must be 0');
  assert.strictEqual(partition.cleanMetrics.losses, 0, 'Clean metrics losses must be 0');
  assert.strictEqual(partition.cleanMetrics.winRate, 0, 'Clean win rate must be 0%');
  assert.strictEqual(partition.cleanMetrics.netPnL, 0, 'Clean net P&L must be 0');
  assert.strictEqual(partition.cleanMetrics.grossProfit, 0, 'Clean gross profit must be 0');
  assert.strictEqual(partition.cleanMetrics.grossLoss, 0, 'Clean gross loss must be 0');
  assert.strictEqual(partition.cleanMetrics.profitFactor, 0, 'Clean profit factor must be 0');
  assert.strictEqual(partition.cleanMetrics.expectancy, 0, 'Clean expectancy must be 0');
  assert.strictEqual(partition.cleanMetrics.maxDrawdown, 0, 'Clean max drawdown must be 0');
  assert.strictEqual(partition.cleanMetrics.totalFees, 0, 'Clean total fees must be 0');

  // B. Historical Archive must contain all 15 records
  assert.strictEqual(partition.historicalTrades.length, 15, 'Historical archive must preserve all 15 records');
  assert.strictEqual(partition.historicalMetrics.totalRecords, 15, 'Historical metrics total records must be 15');
  assert.strictEqual(partition.historicalMetrics.duplicateRecords, 6, 'Exactly 6 duplicate incident records quarantined');
  assert.strictEqual(partition.historicalMetrics.genuineRecords, 9, 'Exactly 9 genuine records identified');

  // Verify that the original mock15 array was not mutated
  assert.strictEqual(mock15.length, 15, 'Original array length unchanged');
  assert.strictEqual(mock15[0].tradeId, 'TRD-GENUINE-1', 'Original trade objects unchanged');
});

// -----------------------------------------------------------------------------
// TEST 3: Admitting genuine post-Step-6E trades strictly > cutoff boundary
// -----------------------------------------------------------------------------
runCheck('TEST 3: Post-Step-6E trades strictly after cutoff are admitted into clean dataset', () => {
  const post6eExecTime1 = '2026-10-05T09:00:05.000Z'; // After Oct 5 08:16:15 UTC
  const post6eExecTime2 = '2026-10-05T10:00:05.000Z'; // After Oct 5 08:16:15 UTC

  const pre6eTrade = makeMockTrade('TRD-PRE-1', '2026-09-30T12:00:00.000Z', '2026-09-30T12:15:05.000Z', 'SHORT', 500, true);
  const post6eTradeWin = makeMockTrade('TRD-POST-1', '2026-10-05T08:45:00.000Z', post6eExecTime1, 'SHORT', 1500, true, 5.0);
  const post6eTradeLoss = makeMockTrade('TRD-POST-2', '2026-10-05T09:45:00.000Z', post6eExecTime2, 'SHORT', -750, false, 5.0);

  const trades = [pre6eTrade, post6eTradeWin, post6eTradeLoss];
  const partition = partitionForwardTrades(trades);

  // Clean subset should contain only the 2 post-6E trades
  assert.strictEqual(partition.cleanTrades.length, 2, 'Exactly 2 clean trades admitted');
  assert.strictEqual(partition.cleanMetrics.tradeCount, 2);
  assert.strictEqual(partition.cleanMetrics.wins, 1);
  assert.strictEqual(partition.cleanMetrics.losses, 1);
  assert.strictEqual(partition.cleanMetrics.winRate, 50.0);
  assert.strictEqual(partition.cleanMetrics.grossProfit, 1500);
  assert.strictEqual(partition.cleanMetrics.grossLoss, 750);
  assert.strictEqual(partition.cleanMetrics.netPnL, 750);
  assert.strictEqual(partition.cleanMetrics.profitFactor, 2.0);
  assert.strictEqual(partition.cleanMetrics.expectancy, 375);
  assert.strictEqual(partition.cleanMetrics.totalFees, 10.0);

  // Historical archive contains the 1 pre-6E trade
  assert.strictEqual(partition.historicalTrades.length, 1);
  assert.strictEqual(partition.historicalTrades[0].tradeId, 'TRD-PRE-1');
});

// -----------------------------------------------------------------------------
// TEST 4: Boundary precision test: timestamp equal to cutoff vs strictly after
// -----------------------------------------------------------------------------
runCheck('TEST 4: Boundary precision test: equal to cutoff is archived, strictly after is clean', () => {
  const exactCutoff = STEP_6E_DEPLOYMENT_CUTOFF_UTC;
  const oneMsAfter = new Date(STEP_6E_DEPLOYMENT_CUTOFF_MS + 1).toISOString();

  const atBoundaryTrade = makeMockTrade('TRD-AT-CUTOFF', '2026-10-05T08:00:00.000Z', exactCutoff, 'SHORT', 100, true);
  const strictlyAfterTrade = makeMockTrade('TRD-AFTER-CUTOFF', '2026-10-05T08:00:00.000Z', oneMsAfter, 'SHORT', 100, true);

  const partition1 = partitionForwardTrades([atBoundaryTrade]);
  assert.strictEqual(partition1.cleanTrades.length, 0, 'Exact boundary is archived');
  assert.strictEqual(partition1.historicalTrades.length, 1);

  const partition2 = partitionForwardTrades([strictlyAfterTrade]);
  assert.strictEqual(partition2.cleanTrades.length, 1, 'Strictly after boundary is clean');
  assert.strictEqual(partition2.historicalTrades.length, 0);
});

console.log('\n================================================================');
console.log(`PARTITION TEST RESULTS: ${passCount} / ${passCount + failCount} PASSED`);
if (failCount > 0) {
  console.error(`FAILED CHECKS: ${failCount}`);
  process.exit(1);
} else {
  console.log('ALL FORWARD REPORTING PARTITION CHECKS PASSED.');
  console.log('================================================================\n');
}
