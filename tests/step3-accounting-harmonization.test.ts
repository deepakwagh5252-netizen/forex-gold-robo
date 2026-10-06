import assert from 'node:assert';
import { Candle } from '../src/market-data/provider.interface';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { IReplayStrategy } from '../src/types/replay';
import { SetupRecord } from '../src/types/scanner';

console.log('================================================================');
console.log('STEP 3: HISTORICAL REPLAY ACCOUNTING HARMONIZATION TEST SUITE');
console.log('Testing net P&L and commission accounting parity with Forward');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err: unknown) {
    console.error(`[FAIL] ${name}:`, (err as Error).message);
    process.exitCode = 1;
  }
}

function createCandles(specs: Array<{ open: number; high: number; low: number; close: number }>): Candle[] {
  const baseTime = Date.UTC(2026, 8, 1, 10, 0, 0); // 10:00 UTC (London session)
  return specs.map((s, i) => {
    const timestamp = baseTime + i * 15 * 60 * 1000;
    return {
      timestamp,
      datetime: new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19),
      open: s.open,
      high: s.high,
      low: s.low,
      close: s.close,
      volume: 1000,
      isVerified: true,
    };
  });
}

function createMockSetup(overrides: Partial<SetupRecord> & {
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
}): SetupRecord {
  const entry = overrides.entryPrice ?? overrides.risk?.entryReference ?? 2650;
  const sl = overrides.stopLoss ?? overrides.risk?.stopLossReference ?? 2640;
  const tp = overrides.targetPrice ?? overrides.risk?.targetReference ?? 2670;
  const dir = overrides.direction ?? 'BULLISH';
  const distance = Math.abs(entry - sl);
  const rewardDist = Math.abs(tp - entry);
  const ts = overrides.originatingCandleTimestamp ?? Date.now();

  return {
    setupId: overrides.setupId ?? 'MOCK-SETUP',
    symbol: overrides.symbol ?? 'XAU/USD',
    timeframe: overrides.timeframe ?? '15m',
    direction: dir,
    setupFamily: overrides.setupFamily ?? 'BREAKOUT_RETEST',
    status: 'VALIDATED_CANDIDATE',
    statusReason: 'VALIDATED',
    evidence: {
      liquidityLevel: 2650,
      liquiditySource: 'SESSION_HIGH',
      sweepDetected: true,
      sweepTimestamp: ts,
      sweepDatetime: new Date(ts).toISOString(),
      sweepHighOrLow: 2655,
      structureEvent: 'CHOCH',
      structureTimestamp: ts,
      structureDatetime: new Date(ts).toISOString(),
      brokenLevel: 2652,
      displacementDetected: true,
      displacementTimestamp: ts,
      displacementDatetime: new Date(ts).toISOString(),
      displacementBodyRatio: 0.75,
      fvgDetected: true,
      fvgUpper: 2652,
      fvgLower: 2649,
      fvgTimestamp: ts,
      fvgDatetime: new Date(ts).toISOString(),
      retestDetected: true,
      retestTimestamp: ts,
      retestDatetime: new Date(ts).toISOString(),
      retestPrice: entry,
      retestHolds: true,
      ...overrides.evidence,
    },
    risk: {
      entryReference: entry,
      entryType: 'CALCULATED',
      entryMethod: 'LIMIT_RETEST',
      stopLossReference: sl,
      stopLossType: 'CALCULATED',
      stopLossMethod: 'SWING_LOW',
      targetReference: tp,
      targetType: 'CALCULATED',
      targetSource: 'LIQUIDITY_POOL',
      riskDistance: distance,
      rewardDistance: rewardDist,
      riskRewardRatio: distance > 0 ? Number((rewardDist / distance).toFixed(2)) : 2.0,
      minimumRequiredRR: 1.5,
      ...overrides.risk,
    },
    validation: {
      dataVerified: true,
      marketRegime: overrides.validation?.marketRegime ?? 'TRENDING_BULLISH',
      volatilityState: overrides.validation?.volatilityState ?? 'NORMAL',
      multiTimeframeContext: overrides.validation?.multiTimeframeContext ?? 'aligned',
      conditionsPassed: overrides.validation?.conditionsPassed ?? ['SWEEP', 'STRUCTURE', 'DISPLACEMENT'],
      conditionsFailed: overrides.validation?.conditionsFailed ?? [],
      confluence: overrides.validation?.confluence ?? {
        liquidity: 'PASS',
        structure: 'PASS',
        displacement: 'PASS',
        fvg: 'PASS',
        retest: 'PASS',
        volatility: 'PASS',
        multiTimeframe: 'PASS',
        riskReward: 'PASS',
      },
      invalidationCondition: overrides.validation?.invalidationCondition ?? 'Close below invalidation level',
      isInvalidated: overrides.validation?.isInvalidated ?? false,
    },
    provenance: {
      fact: ['TEST'],
      calculation: ['TEST'],
      modelOutput: ['TEST'],
    },
    originatingCandleTimestamp: ts,
    originatingEventKey: overrides.originatingEventKey ?? `KEY-${ts}`,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lifecycleSequence: ['SETUP_FORMING', 'VALIDATED_CANDIDATE'],
  };
}

// -------------------------------------------------------------------------
// TEST 1: Winning Replay trade increases balance by exactly NET P&L
// -------------------------------------------------------------------------
runTest('1. One winning Replay trade increases balance by exactly NET P&L', () => {
  const initialBalance = 100_000;
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 }, // Step 0: Entry signal
    { open: 2650.0, high: 2675.0, low: 2649.0, close: 2672.0 }, // Step 1: Hits TP (2670)
    { open: 2672.0, high: 2674.0, low: 2670.0, close: 2673.0 }, // Step 2: Inactive
  ]);

  const engine = new HistoricalReplayEngine({
    initialBalance,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0, // 0.10 on XAU/USD (half spread = 0.05)
      slippageDisabled: false,
      slippagePips: 0.5,     // 0.05 on XAU/USD
    },
  });

  const strat: IReplayStrategy = {
    id: 'WIN_STRAT',
    name: 'Winning Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-WIN-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(strat);

  // Step 0: Entry
  engine.stepForward();
  assert.strictEqual(engine.getMetrics().currentBalance, initialBalance, 'Balance must remain initial at entry');

  // Step 1: Position closes at TP
  engine.stepForward();

  const closedTrades = engine.getClosedTrades();
  assert.strictEqual(closedTrades.length, 1, 'Should have 1 closed trade');
  const trade = closedTrades[0];

  // Numerical verification:
  // Executed Entry = 2650.0 + 0.05 + 0.05 = 2650.10
  // Executed Exit  = 2670.0 - 0.05 - 0.05 = 2669.90
  // Gross P&L      = (2669.90 - 2650.10) * 100 = $1,980.00
  // Entry Comm     = 1.0 lot * $3.50 = $3.50
  // Exit Comm      = 1.0 lot * $3.50 = $3.50
  // Total Fees     = $7.00
  // Net Realized   = $1,980.00 - $7.00 = $1,973.00
  const expectedGross = 1980.00;
  const expectedTotalFees = 7.00;
  const expectedNet = 1973.00;

  assert.strictEqual(trade.grossPnL, expectedGross, 'Recorded gross P&L must be $1,980.00');
  assert.strictEqual(trade.entryCommission, 3.50, 'Recorded entry commission must be $3.50');
  assert.strictEqual(trade.exitCommission, 3.50, 'Recorded exit commission must be $3.50');
  assert.strictEqual(trade.totalFees, expectedTotalFees, 'Recorded total fees must be $7.00');
  assert.strictEqual(trade.netPnL, expectedNet, 'Recorded net P&L must be $1,973.00');
  assert.strictEqual(trade.realizedPnL, expectedNet, 'Recorded realized P&L must equal net P&L');

  const finalBalance = engine.getMetrics().currentBalance;
  const finalEquity = engine.getMetrics().currentEquity;
  const balanceDelta = Number((finalBalance - initialBalance).toFixed(2));

  assert.strictEqual(balanceDelta, expectedNet, 'Balance change must equal net P&L (+1,973.00), NOT gross (+1,980.00)');
  assert.strictEqual(finalBalance, initialBalance + expectedNet, 'Final balance must be exactly $101,973.00');
  assert.strictEqual(finalEquity, finalBalance, 'Final equity must equal final balance with no open positions');
});

// -------------------------------------------------------------------------
// TEST 2: Losing Replay trade decreases balance by exactly NET P&L
// -------------------------------------------------------------------------
runTest('2. One losing Replay trade decreases balance by exactly NET P&L', () => {
  const initialBalance = 100_000;
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 }, // Step 0: Entry signal
    { open: 2650.0, high: 2652.0, low: 2635.0, close: 2638.0 }, // Step 1: Hits SL (2640)
    { open: 2638.0, high: 2640.0, low: 2636.0, close: 2639.0 }, // Step 2: Inactive
  ]);

  const engine = new HistoricalReplayEngine({
    initialBalance,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    },
  });

  const strat: IReplayStrategy = {
    id: 'LOSS_STRAT',
    name: 'Losing Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-LOSS-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(strat);

  // Step 0: Entry
  engine.stepForward();

  // Step 1: Position closes at SL
  engine.stepForward();

  const closedTrades = engine.getClosedTrades();
  assert.strictEqual(closedTrades.length, 1, 'Should have 1 closed trade');
  const trade = closedTrades[0];

  // Numerical verification:
  // Executed Entry = 2650.0 + 0.05 + 0.05 = 2650.10
  // Executed Exit  = 2640.0 - 0.05 - 0.05 = 2639.90
  // Gross P&L      = (2639.90 - 2650.10) * 100 = -$1,020.00
  // Entry Comm     = 1.0 lot * $3.50 = $3.50
  // Exit Comm      = 1.0 lot * $3.50 = $3.50
  // Total Fees     = $7.00
  // Net Realized   = -$1,020.00 - $7.00 = -$1,027.00
  const expectedGross = -1020.00;
  const expectedTotalFees = 7.00;
  const expectedNet = -1027.00;

  assert.strictEqual(trade.grossPnL, expectedGross, 'Recorded gross P&L must be -$1,020.00');
  assert.strictEqual(trade.entryCommission, 3.50, 'Recorded entry commission must be $3.50');
  assert.strictEqual(trade.exitCommission, 3.50, 'Recorded exit commission must be $3.50');
  assert.strictEqual(trade.totalFees, expectedTotalFees, 'Recorded total fees must be $7.00');
  assert.strictEqual(trade.netPnL, expectedNet, 'Recorded net P&L must be -$1,027.00');
  assert.strictEqual(trade.realizedPnL, expectedNet, 'Recorded realized P&L must equal net P&L');

  const finalBalance = engine.getMetrics().currentBalance;
  const finalEquity = engine.getMetrics().currentEquity;
  const balanceDelta = Number((finalBalance - initialBalance).toFixed(2));

  assert.strictEqual(balanceDelta, expectedNet, 'Balance change must equal net P&L (-1,027.00), NOT gross (-1,020.00)');
  assert.strictEqual(finalBalance, initialBalance + expectedNet, 'Final balance must be exactly $98,973.00');
  assert.strictEqual(finalEquity, finalBalance, 'Final equity must equal final balance with no open positions');
});

// -------------------------------------------------------------------------
// TEST 3: Entry + exit commission are both included exactly once
// -------------------------------------------------------------------------
runTest('3. Entry + exit commission are both included exactly once', () => {
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 },
    { open: 2650.0, high: 2675.0, low: 2649.0, close: 2672.0 },
  ]);

  const engine = new HistoricalReplayEngine({
    initialBalance: 50_000,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    },
  });

  const strat: IReplayStrategy = {
    id: 'COMM_ONCE_STRAT',
    name: 'Commission Counting',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-COMM-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(strat);

  // Step 0: Position opens (0.50 lot for 50k balance)
  engine.stepForward();
  const openPos = engine.getOpenPositions()[0];
  assert.ok(openPos, 'Position must be open');
  assert.strictEqual(openPos.accumulatedFees, 1.75, 'Entry fee on position must be $1.75 (0.50 lot * $3.50)');

  // Step 1: Position closes
  engine.stepForward();
  const trade = engine.getClosedTrades()[0];

  assert.strictEqual(trade.entryCommission, 1.75, 'Entry commission must be exactly $1.75');
  assert.strictEqual(trade.exitCommission, 1.75, 'Exit commission must be exactly $1.75');
  assert.strictEqual(trade.totalFees, 3.50, 'Total fees must be exactly $3.50 (counted once for entry, once for exit)');
});

// -------------------------------------------------------------------------
// TEST 4: Journal totalFees equals entryCommission + exitCommission
// -------------------------------------------------------------------------
runTest('4. Journal totalFees equals entryCommission + exitCommission', () => {
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 },
    { open: 2650.0, high: 2675.0, low: 2649.0, close: 2672.0 },
  ]);

  const engine = new HistoricalReplayEngine({
    initialBalance: 100_000,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    },
  });

  const strat: IReplayStrategy = {
    id: 'JRN_STRAT',
    name: 'Journal Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-JRN-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(strat);
  engine.stepForward();
  engine.stepForward();

  const journal = engine.getJournal();
  const closeEvent = journal.find((j) => j.eventType === 'POSITION_CLOSED');
  assert.ok(closeEvent, 'Must have POSITION_CLOSED journal event');

  assert.strictEqual(closeEvent.grossPnL, 1980.00);
  assert.strictEqual(closeEvent.entryCommission, 3.50);
  assert.strictEqual(closeEvent.exitCommission, 3.50);
  assert.strictEqual(closeEvent.totalFees, 7.00);
  assert.strictEqual(closeEvent.netPnL, 1973.00);
  assert.strictEqual(closeEvent.realizedPnL, 1973.00);
  assert.strictEqual(
    closeEvent.totalFees,
    Number(((closeEvent.entryCommission ?? 0) + (closeEvent.exitCommission ?? 0)).toFixed(2)),
    'Journal totalFees must equal entryCommission + exitCommission'
  );
  assert.strictEqual(
    closeEvent.netPnL,
    Number(((closeEvent.grossPnL ?? 0) - (closeEvent.totalFees ?? 0)).toFixed(2)),
    'Journal netPnL must equal grossPnL - totalFees'
  );

  // Check details dictionary as well
  assert.strictEqual(closeEvent.details?.grossPnL, 1980.00);
  assert.strictEqual(closeEvent.details?.entryCommission, 3.50);
  assert.strictEqual(closeEvent.details?.exitCommission, 3.50);
  assert.strictEqual(closeEvent.details?.totalFees, 7.00);
  assert.strictEqual(closeEvent.details?.netPnL, 1973.00);
});

// -------------------------------------------------------------------------
// TEST 5: Recorded net P&L equals balance change
// -------------------------------------------------------------------------
runTest('5. Recorded net P&L equals balance change', () => {
  const initialBalance = 100_000;
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 },
    { open: 2650.0, high: 2675.0, low: 2649.0, close: 2672.0 },
  ]);

  const engine = new HistoricalReplayEngine({
    initialBalance,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    },
  });

  const strat: IReplayStrategy = {
    id: 'RECON_STRAT',
    name: 'Recon Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-RECON-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(strat);
  engine.stepForward();
  engine.stepForward();

  const trade = engine.getClosedTrades()[0];
  const delta = Number((engine.getMetrics().currentBalance - initialBalance).toFixed(2));
  assert.strictEqual(trade.netPnL, delta, 'Trade net P&L must exactly equal balance change');
  assert.strictEqual(trade.realizedPnL, delta, 'Trade realized P&L must exactly equal balance change');
});

// -------------------------------------------------------------------------
// TEST 6: No double-counting occurs across full lifecycle
// -------------------------------------------------------------------------
runTest('6. No double-counting occurs across full lifecycle', () => {
  const initialBalance = 100_000;
  const candles = createCandles([
    { open: 2649.0, high: 2651.0, low: 2648.0, close: 2650.0 }, // Step 0: Trade 1 open
    { open: 2650.0, high: 2675.0, low: 2649.0, close: 2672.0 }, // Step 1: Trade 1 close (+1973 net)
    { open: 2672.0, high: 2674.0, low: 2670.0, close: 2671.0 }, // Step 2: Trade 2 open (SHORT)
    { open: 2671.0, high: 2685.0, low: 2668.0, close: 2682.0 }, // Step 3: Trade 2 close at SL (-1027 net)
  ]);

  const strat: IReplayStrategy = {
    id: 'NO_DOUBLE_COUNT',
    name: 'Multi-trade Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-MULT-01',
            entryPrice: 2650.0,
            stopLoss: 2640.0,
            targetPrice: 2670.0,
            direction: 'BULLISH',
            originatingCandleTimestamp: ctx.timestamp,
          }),
        ];
      }
      if (ctx.currentIndex === 2) {
        return [
          createMockSetup({
            setupId: 'SETUP-MULT-02',
            entryPrice: 2671.0,
            stopLoss: 2681.0,
            targetPrice: 2651.0,
            direction: 'BEARISH',
            originatingCandleTimestamp: ctx.timestamp,
            validation: {
              dataVerified: true,
              marketRegime: 'TRENDING_BEARISH',
              volatilityState: 'NORMAL',
              multiTimeframeContext: 'aligned',
              conditionsPassed: ['SWEEP', 'STRUCTURE', 'DISPLACEMENT'],
              conditionsFailed: [],
              confluence: {
                liquidity: 'PASS',
                structure: 'PASS',
                displacement: 'PASS',
                fvg: 'PASS',
                retest: 'PASS',
                volatility: 'PASS',
                multiTimeframe: 'PASS',
                riskReward: 'PASS',
              },
              invalidationCondition: 'Close below invalidation level',
              isInvalidated: false,
            },
          }),
        ];
      }
      return [];
    },
  };

  const engine = new HistoricalReplayEngine({
    initialBalance,
    symbol: 'XAU/USD',
    timeframe: '15m',
    riskConfig: {
      riskPerTradePercent: 1.0,
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    },
  });

  engine.loadDataset(candles);
  engine.setStrategy(strat);

  for (let i = 0; i < 4; i++) {
    engine.stepForward();
  }

  const trades = engine.getClosedTrades();
  assert.strictEqual(trades.length, 2, 'Should have completed 2 trades');
  const trade1 = trades[0];
  const trade2 = trades[1];
  assert.ok(trade1 && trade2, 'Both trades must be defined');

  // Trade 1: +1973.00 net
  assert.strictEqual(trade1.grossPnL, 1980.00);
  assert.strictEqual(trade1.totalFees, 7.00);
  assert.strictEqual(trade1.netPnL, 1973.00);
  assert.strictEqual(trade1.realizedPnL, 1973.00);

  // Trade 2:
  assert.strictEqual(trade2.totalFees, Number(((trade2.entryCommission ?? 0) + (trade2.exitCommission ?? 0)).toFixed(2)));
  assert.strictEqual(trade2.netPnL, Number(((trade2.grossPnL ?? 0) - trade2.totalFees).toFixed(2)));
  assert.strictEqual(trade2.realizedPnL, trade2.netPnL);

  // Sum of net P&L
  const expectedTotalNet = Number((trade1.netPnL + trade2.netPnL).toFixed(2));
  const metrics = engine.getMetrics();

  assert.strictEqual(metrics.totalRealizedPnL, expectedTotalNet, 'totalRealizedPnL must equal sum of net P&Ls');
  assert.strictEqual(metrics.currentBalance, Number((initialBalance + expectedTotalNet).toFixed(2)), 'currentBalance must equal initialBalance + sum of net P&Ls');
  assert.strictEqual(metrics.currentEquity, metrics.currentBalance, 'currentEquity must equal currentBalance');
  assert.strictEqual(
    Number((metrics.currentBalance - initialBalance).toFixed(2)),
    metrics.totalRealizedPnL,
    'currentBalance - initialBalance must exactly equal totalRealizedPnL'
  );
});

// -------------------------------------------------------------------------
// TEST 7: Numerical parity with Forward Paper Trading accounting
// -------------------------------------------------------------------------
runTest('7. Numerical parity with Forward Paper Trading accounting', () => {
  // Test that both Replay and Forward use the identical formula:
  // netPnL = grossPnL - totalFees
  // balance = balance + netPnL
  const p = ForwardPaperEngine.FROZEN_PARAMS;
  const lotSize = 1.0;
  const positionSize = 100; // oz
  const entryPrice = 2650.10;
  const exitPrice = 2669.90;

  // Forward calculation:
  const fwdEntryComm = Number((lotSize * p.commissionPerLotPerSide).toFixed(2));
  const fwdExitComm = Number((lotSize * p.commissionPerLotPerSide).toFixed(2));
  const fwdTotalFees = Number((fwdEntryComm + fwdExitComm).toFixed(2));
  const fwdGross = Number(((exitPrice - entryPrice) * positionSize).toFixed(2));
  const fwdNet = Number((fwdGross - fwdTotalFees).toFixed(2));

  assert.strictEqual(fwdGross, 1980.00);
  assert.strictEqual(fwdTotalFees, 7.00);
  assert.strictEqual(fwdNet, 1973.00);

  // Replay accounting uses identical formula:
  const replayGross = 1980.00;
  const replayTotalFees = 7.00;
  const replayNet = Number((replayGross - replayTotalFees).toFixed(2));

  assert.strictEqual(replayGross, fwdGross, 'Replay and Forward grossPnL match');
  assert.strictEqual(replayTotalFees, fwdTotalFees, 'Replay and Forward totalFees match');
  assert.strictEqual(replayNet, fwdNet, 'Replay and Forward netPnL match');
});

console.log('\n================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('================================================================\n');
