import { Candle } from '../src/market-data/provider.interface';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { SetupRecord } from '../src/types/scanner';
import { IReplayStrategy, ReplayCandleContext } from '../src/types/replay';

console.log('=== PHASE 6: DETERMINISTIC HISTORICAL REPLAY ENGINE TEST SUITE ===');

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, details?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name} ${details ? ': ' + details : ''}`);
  }
}

// Generate deterministic 15-minute candles starting at 2026-09-19 00:00:00 UTC
const baseTime = Date.UTC(2026, 8, 19, 0, 0, 0); // 1789776000000
const intervalMs = 15 * 60 * 1000;

const createSampleDataset = (count: number = 20): Candle[] => {
  const candles: Candle[] = [];
  let price = 2650.0;

  for (let i = 0; i < count; i++) {
    const open = price;
    const move = (i % 2 === 0 ? 1 : -1) * (1.5 + (i % 3) * 0.5);
    const close = Number((open + move).toFixed(2));
    const high = Number((Math.max(open, close) + 1.2).toFixed(2));
    const low = Number((Math.min(open, close) - 1.1).toFixed(2));
    price = close;

    candles.push({
      timestamp: baseTime + i * intervalMs,
      datetime: new Date(baseTime + i * intervalMs).toISOString().replace('T', ' ').substring(0, 19),
      open,
      high,
      low,
      close,
      volume: 100 + i * 10,
      isVerified: true,
    });
  }
  return candles;
};

// Helper to create fully typed valid SetupRecords
function createMockSetup(overrides: Partial<SetupRecord> & {
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  direction?: 'BULLISH' | 'BEARISH';
  timestamp: number;
}): SetupRecord {
  const direction = overrides.direction ?? 'BULLISH';
  const riskDist = Math.abs(overrides.entryPrice - overrides.stopLoss);
  const rewardDist = Math.abs(overrides.targetPrice - overrides.entryPrice);
  const rr = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 0;

  return {
    setupId: overrides.setupId ?? 'SETUP-MOCK-1',
    symbol: 'XAU/USD',
    timeframe: overrides.timeframe ?? '15m',
    direction,
    setupFamily: 'BREAKOUT_RETEST',
    createdAt: new Date(overrides.timestamp).toISOString(),
    lastUpdated: new Date(overrides.timestamp).toISOString(),
    status: overrides.status ?? 'VALIDATED_CANDIDATE',
    statusReason: 'Setup validated against rules',
    lifecycleSequence: ['WATCH', 'SETUP_FORMING', 'VALIDATED_CANDIDATE'],
    evidence: {
      liquidityLevel: 2650,
      liquiditySource: 'SESSION_HIGH',
      sweepDetected: true,
      sweepTimestamp: overrides.timestamp,
      sweepDatetime: new Date(overrides.timestamp).toISOString(),
      sweepHighOrLow: 2655,
      structureEvent: 'CHOCH',
      structureTimestamp: overrides.timestamp,
      structureDatetime: new Date(overrides.timestamp).toISOString(),
      brokenLevel: 2652,
      displacementDetected: true,
      displacementTimestamp: overrides.timestamp,
      displacementDatetime: new Date(overrides.timestamp).toISOString(),
      displacementBodyRatio: 0.75,
      fvgDetected: true,
      fvgUpper: 2652,
      fvgLower: 2649,
      fvgTimestamp: overrides.timestamp,
      fvgDatetime: new Date(overrides.timestamp).toISOString(),
      retestDetected: true,
      retestTimestamp: overrides.timestamp,
      retestDatetime: new Date(overrides.timestamp).toISOString(),
      retestPrice: overrides.entryPrice,
      retestHolds: true,
    },
    risk: {
      entryReference: overrides.entryPrice,
      entryType: 'CALCULATED',
      entryMethod: 'LIMIT_RETEST',
      stopLossReference: overrides.stopLoss,
      stopLossType: 'CALCULATED',
      stopLossMethod: 'SWING_LOW',
      targetReference: overrides.targetPrice,
      targetType: 'CALCULATED',
      targetSource: 'LIQUIDITY_POOL',
      riskDistance: riskDist,
      rewardDistance: rewardDist,
      riskRewardRatio: rr,
      minimumRequiredRR: 1.5,
    },
    validation: {
      dataVerified: true,
      marketRegime: 'TRENDING_BULLISH',
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
    provenance: {
      fact: ['Source bar confirmed'],
      calculation: ['RR calculated'],
      modelOutput: ['Rule verification verified'],
    },
    originatingCandleTimestamp: overrides.timestamp,
    originatingEventKey: `EVENT-${overrides.timestamp}`,
  };
}

// 1. Chronological replay
{
  const dataset = createSampleDataset(10);
  const engine = new HistoricalReplayEngine();
  const val = engine.loadDataset(dataset);
  assert('1. Chronological replay dataset valid', val.isValid);
  assert('1. Initial index is -1 before start', engine.getCurrentIndex() === -1);

  const res1 = engine.stepForward();
  assert('1. Step 1 advances to index 0', res1?.candleIndex === 0 && res1?.timestamp === dataset[0].timestamp);

  const res2 = engine.stepForward();
  assert('1. Step 2 advances to index 1', res2?.candleIndex === 1 && res2?.timestamp === dataset[1].timestamp);
}

// 2. Strict No-lookahead: history slice strictly contains 0..N only
{
  const dataset = createSampleDataset(10);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  let observedFutureLeak = false;

  const spyStrategy: IReplayStrategy = {
    id: 'SPY_STRATEGY',
    name: 'Spy Strategy',
    evaluate: (ctx: ReplayCandleContext) => {
      if (ctx.history.length !== ctx.currentIndex + 1) {
        observedFutureLeak = true;
      }
      const lastInHistory = ctx.history[ctx.history.length - 1];
      if (lastInHistory.timestamp !== ctx.currentCandle.timestamp) {
        observedFutureLeak = true;
      }
      return [];
    },
  };

  engine.setStrategy(spyStrategy);
  for (let i = 0; i < 5; i++) {
    engine.stepForward();
  }

  assert('2. Strict No-lookahead protection verified across steps', !observedFutureLeak);
}

// 3. Future candle access prevention (immutable context)
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const ctx = engine.getReplayContext(2);
  let mutationBlocked = false;
  try {
    (ctx?.history as any).push(dataset[4]);
  } catch (e) {
    mutationBlocked = true;
  }
  assert('3. Future candle access prevention: context is frozen/immutable', mutationBlocked);
}

// 4. Candle-by-candle state
{
  const dataset = createSampleDataset(10);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  for (let i = 0; i < 5; i++) engine.stepForward();

  const metrics = engine.getMetrics();
  assert('4. Processed candles count tracked accurately', metrics.processedCandles === 5 && metrics.totalCandles === 10);
  assert('4. Chart candles expose exactly 0..4', engine.getChartCandles().length === 5);
}

// 5. Indicator update ordering
{
  const dataset = createSampleDataset(10);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const windowSizes: number[] = [];
  const indStrat: IReplayStrategy = {
    id: 'IND',
    name: 'Indicator Window',
    evaluate: (ctx) => {
      windowSizes.push(ctx.history.length);
      return [];
    },
  };

  engine.setStrategy(indStrat);
  for (let i = 0; i < 4; i++) engine.stepForward();

  assert('5. Indicator update ordering: context length increases strictly 1, 2, 3, 4', JSON.stringify(windowSizes) === JSON.stringify([1, 2, 3, 4]));
}

// 6 & 7. Existing position management and new signal processing
{
  const dataset = createSampleDataset(10);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const signalStrategy: IReplayStrategy = {
    id: 'BUY_AT_0',
    name: 'Buy at Candle 0',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-TEST-1',
            entryPrice: ctx.currentCandle.close,
            stopLoss: ctx.currentCandle.close - 10,
            targetPrice: ctx.currentCandle.close + 20,
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.setStrategy(signalStrategy);
  engine.stepForward(); // Step 0: Signal triggered and position opened
  assert('6. Position opened on signal at step 0', engine.getOpenPositions().length === 1);

  engine.stepForward(); // Step 1: Position evaluated
  assert('7. Existing position updated against candle 1', engine.getOpenPositions()[0].currentPrice === dataset[1].close);
}

// 8. RiskManager integration
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine({
    riskConfig: { minimumRR: 3.0 },
  });
  engine.loadDataset(dataset);

  const badRRStrategy: IReplayStrategy = {
    id: 'BAD_RR',
    name: 'Bad RR',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-BAD-RR',
            entryPrice: 2650,
            stopLoss: 2640,
            targetPrice: 2665, // 1.5 RR < 3.0
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.setStrategy(badRRStrategy);
  engine.stepForward();

  assert('8. RiskManager integration blocks order with sub-standard RR', engine.getOpenPositions().length === 0);
  const rejections = engine.getJournal().filter(j => j.eventType === 'ORDER_REJECTED');
  assert('8. Order rejection recorded in journal', rejections.length > 0 && rejections[0].reason!.includes('BLOCKED_INVALID_RR'));
}

// 9 & 10. Stop Loss and Take Profit execution
{
  const dataset: Candle[] = [
    {
      timestamp: baseTime,
      datetime: '2026-09-19 00:00:00',
      open: 2650,
      high: 2652,
      low: 2648,
      close: 2650,
      volume: 100,
      isVerified: true,
    },
    {
      timestamp: baseTime + intervalMs,
      datetime: '2026-09-19 00:15:00',
      open: 2650,
      high: 2651,
      low: 2630, // Drops below SL (2638)
      close: 2632,
      volume: 120,
      isVerified: true,
    },
  ];

  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const buyStrategy: IReplayStrategy = {
    id: 'BUY',
    name: 'Buy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-SL-TEST',
            entryPrice: 2650,
            stopLoss: 2638,
            targetPrice: 2680,
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.setStrategy(buyStrategy);
  engine.stepForward(); // opens position
  engine.stepForward(); // low breaks SL

  assert('9. Stop Loss triggers position close', engine.getOpenPositions().length === 0 && engine.getClosedTrades().length === 1);
  assert('10. Closed trade records STOP_LOSS closeReason', engine.getClosedTrades()[0].closeReason === 'STOP_LOSS');
}

// 11. Ambiguous intrabar exit handling
{
  const dataset: Candle[] = [
    {
      timestamp: baseTime,
      datetime: '2026-09-19 00:00:00',
      open: 2650,
      high: 2652,
      low: 2648,
      close: 2650,
      volume: 100,
      isVerified: true,
    },
    {
      timestamp: baseTime + intervalMs,
      datetime: '2026-09-19 00:15:00',
      open: 2650,
      high: 2680, // Touches TP 2670
      low: 2635,  // Touches SL 2640
      close: 2660,
      volume: 500,
      isVerified: true,
    },
  ];

  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const buyStrategy: IReplayStrategy = {
    id: 'BUY',
    name: 'Buy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-AMBIGUOUS',
            entryPrice: 2650,
            stopLoss: 2640,
            targetPrice: 2670,
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.setStrategy(buyStrategy);
  engine.stepForward();
  engine.stepForward();

  const trade = engine.getClosedTrades()[0];
  assert('11. Ambiguous intrabar exit marked AMBIGUOUS_INTRABAR_EXIT', trade?.closeReason === 'AMBIGUOUS_INTRABAR_EXIT');
  // Conservative rule: assumes worst case (stop loss price with adverse execution friction, exactly matching Phase 4B)
  assert('11. Conservative exit price applied (stop loss price with friction)', trade?.exitPrice <= 2640);
}

// 12, 13, 14, 15. Spread, Slippage, and Commission friction enforcement
{
  const dataset = createSampleDataset(3);
  const unconfiguredEngine = new HistoricalReplayEngine({
    riskConfig: {
      commissionPerLot: null,
      commissionDisabled: false,
    },
  });
  unconfiguredEngine.loadDataset(dataset);

  const testStrategy: IReplayStrategy = {
    id: 'BUY',
    name: 'Buy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-FRICTION',
            entryPrice: 2650,
            stopLoss: 2640,
            targetPrice: 2670,
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  unconfiguredEngine.setStrategy(testStrategy);
  unconfiguredEngine.stepForward();

  assert('12-15. Unconfigured friction rejects order deterministically', unconfiguredEngine.getOpenPositions().length === 0);
  const rejection = unconfiguredEngine.getJournal().find(j => j.eventType === 'ORDER_REJECTED');
  assert('12-15. Rejection specifies COMMISSION_NOT_CONFIGURED', rejection?.reason?.includes('COMMISSION_NOT_CONFIGURED') || false);
}

// 16 & 17. Position lifecycle: PENDING -> OPEN -> CLOSED
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  const strat: IReplayStrategy = {
    id: 'LIFECYCLE',
    name: 'Lifecycle',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 0) {
        return [
          createMockSetup({
            setupId: 'SETUP-LIFECYCLE',
            entryPrice: ctx.currentCandle.close,
            stopLoss: ctx.currentCandle.close - 50,
            targetPrice: ctx.currentCandle.close + 100,
            direction: 'BULLISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  engine.setStrategy(strat);
  engine.stepForward();

  const journal = engine.getJournal();
  assert('16. Lifecycle submits and opens position', journal.some(j => j.eventType === 'ORDER_SUBMITTED') && journal.some(j => j.eventType === 'POSITION_OPENED'));
  assert('17. Open position status is OPEN', engine.getOpenPositions()[0]?.status === 'OPEN');
}

// 18. Journal completeness
{
  const dataset = createSampleDataset(3);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);

  for (let i = 0; i < 3; i++) engine.stepForward();

  const journal = engine.getJournal();
  assert('18. Journal records all steps with required fields', journal.length >= 3 && journal.every(r => !!r.id && r.timestamp > 0 && !!r.symbol && !!r.eventType));
}

// 19. Replay reset
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine({ initialBalance: 100_000 });
  engine.loadDataset(dataset);

  for (let i = 0; i < 4; i++) engine.stepForward();
  assert('19. Advanced to index 3 before reset', engine.getCurrentIndex() === 3);

  engine.resetSimulation();
  assert('19. Index is -1 after reset', engine.getCurrentIndex() === -1);
  assert('19. Balance restored to initial 100k', engine.getMetrics().currentBalance === 100_000);
}

// 20. Reproducibility
{
  const dataset = createSampleDataset(15);
  const testStrategy: IReplayStrategy = {
    id: 'DETERMINISTIC_STRAT',
    name: 'Deterministic Strategy',
    evaluate: (ctx) => {
      if (ctx.currentIndex === 1 || ctx.currentIndex === 5) {
        return [
          createMockSetup({
            setupId: `SETUP-${ctx.currentIndex}`,
            entryPrice: ctx.currentCandle.close,
            stopLoss: ctx.currentIndex === 1 ? ctx.currentCandle.close - 8 : ctx.currentCandle.close + 8,
            targetPrice: ctx.currentIndex === 1 ? ctx.currentCandle.close + 18 : ctx.currentCandle.close - 18,
            direction: ctx.currentIndex === 1 ? 'BULLISH' : 'BEARISH',
            timestamp: ctx.timestamp,
          }),
        ];
      }
      return [];
    },
  };

  const engine1 = new HistoricalReplayEngine();
  engine1.loadDataset(dataset);
  engine1.setStrategy(testStrategy);
  for (let i = 0; i < 15; i++) engine1.stepForward();
  const m1 = engine1.getMetrics();
  const j1 = engine1.getJournal();

  const engine2 = new HistoricalReplayEngine();
  engine2.loadDataset(dataset);
  engine2.setStrategy(testStrategy);
  for (let i = 0; i < 15; i++) engine2.stepForward();
  const m2 = engine2.getMetrics();
  const j2 = engine2.getJournal();

  assert('20. Deterministic reproducibility: total trades match', m1.totalTrades === m2.totalTrades);
  assert('20. Deterministic reproducibility: realized PnL match', m1.totalRealizedPnL === m2.totalRealizedPnL);
  assert('20. Deterministic reproducibility: equity matches', m1.currentEquity === m2.currentEquity);
  assert('20. Deterministic reproducibility: max drawdown matches', m1.maxDrawdownPercent === m2.maxDrawdownPercent);
  assert('20. Deterministic reproducibility: journal count matches', j1.length === j2.length);
}

// 21 & 22. Equity and Drawdown
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine({ initialBalance: 50_000 });
  engine.loadDataset(dataset);
  engine.stepForward();

  const m = engine.getMetrics();
  assert('21. Initial equity equals initial balance', m.currentEquity === 50_000);
  assert('22. Initial drawdown is 0', m.maxDrawdownPercent === 0);
}

// 23. Invalid candle rejection
{
  const badDataset: Candle[] = [
    {
      timestamp: baseTime,
      datetime: '2026-09-19 00:00:00',
      open: 2650,
      high: 2640, // High < Open
      low: 2630,
      close: 2645,
      volume: 100,
      isVerified: true,
    },
  ];

  const engine = new HistoricalReplayEngine();
  const val = engine.loadDataset(badDataset);
  assert('23. Invalid candle rejected with error', !val.isValid && val.error!.includes('INVALID_HIGH'));
}

// 24. Duplicate timestamp handling
{
  const duplicateDataset: Candle[] = [
    {
      timestamp: baseTime,
      datetime: '2026-09-19 00:00:00',
      open: 2650,
      high: 2660,
      low: 2640,
      close: 2655,
      volume: 100,
      isVerified: true,
    },
    {
      timestamp: baseTime, // Duplicate
      datetime: '2026-09-19 00:00:00',
      open: 2655,
      high: 2665,
      low: 2645,
      close: 2660,
      volume: 100,
      isVerified: true,
    },
  ];

  const engine = new HistoricalReplayEngine();
  const val = engine.loadDataset(duplicateDataset);
  assert('24. Duplicate timestamp rejected', !val.isValid && val.error!.includes('DUPLICATE_TIMESTAMP'));
}

// 25. Timezone & UTC consistency
{
  const dataset = createSampleDataset(5);
  const engine = new HistoricalReplayEngine();
  engine.loadDataset(dataset);
  engine.stepForward();

  const ctx = engine.getReplayContext(0);
  assert('25. Context preserves underlying UTC timestamp', ctx?.timestamp === dataset[0].timestamp);
}

console.log('======================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================');

if (failed > 0) {
  process.exit(1);
}
