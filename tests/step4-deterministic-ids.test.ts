import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Candle } from '../src/market-data/provider.interface';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { IReplayStrategy, ReplayCandleContext } from '../src/types/replay';
import { SetupRecord } from '../src/types/scanner';

console.log('================================================================');
console.log('STEP 4: DETERMINISTIC REPLAY IDS & LIFECYCLE IDENTITY TEST SUITE');
console.log('Testing determinism, uniqueness, lifecycle distinction & parity');
console.log('================================================================');

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

function runAll(engine: HistoricalReplayEngine, count: number): void {
  for (let i = 0; i < count; i++) {
    engine.stepForward();
  }
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
  const ts = overrides.originatingCandleTimestamp ?? 1787616000000;

  return {
    setupId: overrides.setupId ?? `P7B-BREAKOUT_RETEST-${dir}-${ts}`,
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
      marketRegime: overrides.validation?.marketRegime ?? (dir === 'BULLISH' ? 'TRENDING_BULLISH' : 'TRENDING_BEARISH'),
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
      ...overrides.validation,
    },
    provenance: {
      fact: ['TEST'],
      calculation: ['TEST'],
      modelOutput: ['TEST'],
    },
    originatingCandleTimestamp: ts,
    originatingEventKey: overrides.originatingEventKey ?? `KEY-${ts}`,
    createdAt: new Date(ts).toISOString(),
    lastUpdated: new Date(ts).toISOString(),
    lifecycleSequence: ['SETUP_FORMING', 'VALIDATED_CANDIDATE'],
  };
}

// -----------------------------------------------------------------------------
// Test Strategy Factory
// -----------------------------------------------------------------------------
function createPredictableStrategy(): IReplayStrategy {
  return {
    id: 'PREDICTABLE_REPLAY_STRATEGY_ID',
    name: 'PREDICTABLE_REPLAY_STRATEGY',
    evaluate(context: ReplayCandleContext): SetupRecord[] {
      const idx = context.currentIndex;
      const c = context.currentCandle;

      // Setup 1 at index 1 (LONG)
      if (idx === 1) {
        return [
          createMockSetup({
            setupId: `P7B-BREAKOUT_RETEST-LONG-${c.timestamp}`,
            symbol: 'XAU/USD',
            timeframe: '15m',
            direction: 'BULLISH',
            entryPrice: c.close,
            stopLoss: c.close - 10,
            targetPrice: c.close + 20,
            originatingCandleTimestamp: c.timestamp,
            validation: {
              dataVerified: true,
              marketRegime: 'TRENDING_BULLISH',
              volatilityState: 'NORMAL',
              multiTimeframeContext: 'aligned',
              conditionsPassed: ['SWEEP', 'STRUCTURE'],
              conditionsFailed: [],
              confluence: { liquidity: 'PASS', structure: 'PASS', displacement: 'PASS', fvg: 'PASS', retest: 'PASS', volatility: 'PASS', multiTimeframe: 'PASS', riskReward: 'PASS' },
              invalidationCondition: 'Close below invalidation',
              isInvalidated: false,
            },
          }),
        ];
      }

      // Setup 2 at index 6 (SHORT)
      if (idx === 6) {
        return [
          createMockSetup({
            setupId: `P7B-BREAKOUT_RETEST-SHORT-${c.timestamp}`,
            symbol: 'XAU/USD',
            timeframe: '15m',
            direction: 'BEARISH',
            entryPrice: c.close,
            stopLoss: c.close + 10,
            targetPrice: c.close - 20,
            originatingCandleTimestamp: c.timestamp,
            validation: {
              dataVerified: true,
              marketRegime: 'TRENDING_BEARISH',
              volatilityState: 'NORMAL',
              multiTimeframeContext: 'aligned',
              conditionsPassed: ['SWEEP', 'STRUCTURE'],
              conditionsFailed: [],
              confluence: { liquidity: 'PASS', structure: 'PASS', displacement: 'PASS', fvg: 'PASS', retest: 'PASS', volatility: 'PASS', multiTimeframe: 'PASS', riskReward: 'PASS' },
              invalidationCondition: 'Close above invalidation',
              isInvalidated: false,
            },
          }),
        ];
      }

      return [];
    },
  };
}

function createTenCandleDataset(): Candle[] {
  const baseTime = Date.UTC(2026, 8, 1, 10, 0, 0); // 10:00 UTC (London session)
  const step = 15 * 60 * 1000;
  return [
    makeCandle(baseTime, 2650, 2655, 2648, 2652),                    // 0: warmup
    makeCandle(baseTime + step * 1, 2652, 2654, 2650, 2653),          // 1: Setup 1 LONG entry at 2653
    makeCandle(baseTime + step * 2, 2653, 2660, 2651, 2658),          // 2: In trade
    makeCandle(baseTime + step * 3, 2658, 2675, 2657, 2674),          // 3: Hits TP (2673 target) -> Position 1 Closed
    makeCandle(baseTime + step * 4, 2674, 2676, 2670, 2672),          // 4: Flat
    makeCandle(baseTime + step * 5, 2672, 2673, 2668, 2670),          // 5: Flat
    makeCandle(baseTime + step * 6, 2670, 2671, 2665, 2668),          // 6: Setup 2 SHORT entry at 2668
    makeCandle(baseTime + step * 7, 2668, 2670, 2655, 2658),          // 7: In trade
    makeCandle(baseTime + step * 8, 2658, 2660, 2645, 2646),          // 8: Hits TP (2648 target) -> Position 2 Closed
    makeCandle(baseTime + step * 9, 2646, 2650, 2644, 2648),          // 9: Flat end
  ];
}

// =============================================================================
// TEST A: Same replay dataset/config run twice -> identical trade IDs
// =============================================================================
{
  const dataset = createTenCandleDataset();
  const engine1 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine1.loadDataset(dataset);
  engine1.setStrategy(createPredictableStrategy());
  runAll(engine1, dataset.length);

  const engine2 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine2.loadDataset(dataset);
  engine2.setStrategy(createPredictableStrategy());
  runAll(engine2, dataset.length);

  const trades1 = engine1.getClosedTrades();
  const trades2 = engine2.getClosedTrades();

  assert.strictEqual(trades1.length, 2, 'Should execute 2 closed trades in run 1');
  assert.strictEqual(trades2.length, 2, 'Should execute 2 closed trades in run 2');

  const tradeIds1 = trades1.map(t => t.tradeId);
  const tradeIds2 = trades2.map(t => t.tradeId);

  assert.deepStrictEqual(tradeIds1, tradeIds2, 'Trade IDs must be identical across runs');
  assert.strictEqual(tradeIds1[0], `TRD-P7F-XAUUSD-15M-${dataset[1].timestamp}-LONG`);
  assert.strictEqual(tradeIds1[1], `TRD-P7F-XAUUSD-15M-${dataset[6].timestamp}-SHORT`);

  // Also test resetSimulation reproducibility
  engine1.resetSimulation();
  runAll(engine1, dataset.length);
  const trades1Reset = engine1.getClosedTrades();
  assert.deepStrictEqual(trades1Reset.map(t => t.tradeId), tradeIds1, 'Trade IDs must be identical after resetSimulation');

  console.log('[PASS] A. Same replay dataset/config run twice -> identical trade IDs');
}

// =============================================================================
// TEST B: Same replay dataset/config run twice -> identical order IDs
// =============================================================================
{
  const dataset = createTenCandleDataset();
  const engine1 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine1.loadDataset(dataset);
  engine1.setStrategy(createPredictableStrategy());
  runAll(engine1, dataset.length);

  const engine2 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine2.loadDataset(dataset);
  engine2.setStrategy(createPredictableStrategy());
  runAll(engine2, dataset.length);

  const trades1 = engine1.getClosedTrades();
  const trades2 = engine2.getClosedTrades();

  const orderIds1 = trades1.map(t => t.paperOrderId);
  const orderIds2 = trades2.map(t => t.paperOrderId);

  assert.deepStrictEqual(orderIds1, orderIds2, 'Order IDs must be identical across runs');
  assert.strictEqual(orderIds1[0], `ORD-P7F-XAUUSD-15M-${dataset[1].timestamp}-LONG`);
  assert.strictEqual(orderIds1[1], `ORD-P7F-XAUUSD-15M-${dataset[6].timestamp}-SHORT`);

  // Also verify order IDs from journal submitted events
  const submittedOrders1 = engine1.getJournal()
    .filter(j => j.eventType === 'ORDER_SUBMITTED')
    .map(j => j.paperOrderId);
  const submittedOrders2 = engine2.getJournal()
    .filter(j => j.eventType === 'ORDER_SUBMITTED')
    .map(j => j.paperOrderId);

  assert.deepStrictEqual(submittedOrders1, submittedOrders2, 'Journal order IDs must be identical');
  assert.deepStrictEqual(submittedOrders1, orderIds1);

  console.log('[PASS] B. Same replay dataset/config run twice -> identical order IDs');
}

// =============================================================================
// TEST C: Same replay dataset/config run twice -> identical position IDs
// =============================================================================
{
  const dataset = createTenCandleDataset();
  const engine1 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine1.loadDataset(dataset);
  engine1.setStrategy(createPredictableStrategy());
  runAll(engine1, dataset.length);

  const engine2 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine2.loadDataset(dataset);
  engine2.setStrategy(createPredictableStrategy());
  runAll(engine2, dataset.length);

  const trades1 = engine1.getClosedTrades();
  const trades2 = engine2.getClosedTrades();

  const posIds1 = trades1.map(t => t.positionId);
  const posIds2 = trades2.map(t => t.positionId);

  assert.deepStrictEqual(posIds1, posIds2, 'Position IDs must be identical across runs');
  assert.strictEqual(posIds1[0], `POS-P7F-XAUUSD-15M-${dataset[1].timestamp}-LONG`);
  assert.strictEqual(posIds1[1], `POS-P7F-XAUUSD-15M-${dataset[6].timestamp}-SHORT`);

  // Also check position IDs in journal events
  const journalPosIds1 = engine1.getJournal()
    .filter(j => j.eventType === 'POSITION_OPENED')
    .map(j => j.positionId);
  const journalPosIds2 = engine2.getJournal()
    .filter(j => j.eventType === 'POSITION_OPENED')
    .map(j => j.positionId);

  assert.deepStrictEqual(journalPosIds1, journalPosIds2, 'Journal position IDs must be identical');
  assert.deepStrictEqual(journalPosIds1, posIds1);

  console.log('[PASS] C. Same replay dataset/config run twice -> identical position IDs');
}

// =============================================================================
// TEST D: Same replay dataset/config run twice -> identical event IDs/order
// =============================================================================
{
  const dataset = createTenCandleDataset();
  const engine1 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine1.loadDataset(dataset);
  engine1.setStrategy(createPredictableStrategy());
  runAll(engine1, dataset.length);

  const engine2 = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  engine2.loadDataset(dataset);
  engine2.setStrategy(createPredictableStrategy());
  runAll(engine2, dataset.length);

  const j1 = engine1.getJournal();
  const j2 = engine2.getJournal();

  assert.ok(j1.length > 5, 'Journal should contain events');
  assert.strictEqual(j1.length, j2.length, 'Journal lengths must match exactly');

  // Verify exact deterministic event IDs and order
  const ids1 = j1.map(r => r.id);
  const ids2 = j2.map(r => r.id);
  assert.deepStrictEqual(ids1, ids2, 'Journal event id fields must be identical across runs');

  const eventIds1 = j1.map(r => r.eventId);
  const eventIds2 = j2.map(r => r.eventId);
  assert.deepStrictEqual(eventIds1, eventIds2, 'Journal eventId fields must be identical across runs');

  // Verify event types and sequence
  const types1 = j1.map(r => r.eventType);
  const types2 = j2.map(r => r.eventType);
  assert.deepStrictEqual(types1, types2, 'Event types sequence must match exactly');

  // Verify each event has non-empty deterministic IDs
  for (let i = 0; i < j1.length; i++) {
    assert.ok(j1[i].id.startsWith('RJRN-'), `Event id must start with RJRN- at index ${i}`);
    assert.ok(j1[i].eventId && j1[i].eventId!.startsWith(`EVT-${j1[i].eventType}-`), `Event eventId must start with EVT-${j1[i].eventType}- at index ${i}`);
  }

  console.log('[PASS] D. Same replay dataset/config run twice -> identical event IDs and ordering');
}

// =============================================================================
// TEST E: Different setup timestamps -> different trade IDs
// =============================================================================
{
  const baseTime1 = Date.UTC(2026, 8, 1, 10, 0, 0);
  const baseTime2 = Date.UTC(2026, 8, 2, 10, 0, 0); // 1 day later
  const step = 15 * 60 * 1000;

  const dataset1 = [
    makeCandle(baseTime1, 2650, 2655, 2648, 2652),
    makeCandle(baseTime1 + step * 1, 2652, 2654, 2650, 2653),
    makeCandle(baseTime1 + step * 2, 2653, 2680, 2651, 2678), // TP hit
  ];

  const dataset2 = [
    makeCandle(baseTime2, 2650, 2655, 2648, 2652),
    makeCandle(baseTime2 + step * 1, 2652, 2654, 2650, 2653),
    makeCandle(baseTime2 + step * 2, 2653, 2680, 2651, 2678), // TP hit
  ];

  const strategy: IReplayStrategy = {
    id: 'TEST_STRAT_E',
    name: 'TEST_STRAT',
    evaluate(context: ReplayCandleContext): SetupRecord[] {
      if (context.currentIndex === 1) {
        return [
          createMockSetup({
            setupId: `SETUP-${context.currentCandle.timestamp}`,
            symbol: 'XAU/USD',
            timeframe: '15m',
            direction: 'BULLISH',
            entryPrice: context.currentCandle.close,
            stopLoss: context.currentCandle.close - 10,
            targetPrice: context.currentCandle.close + 20,
            originatingCandleTimestamp: context.currentCandle.timestamp,
            validation: {
              dataVerified: true,
              marketRegime: 'TRENDING_BULLISH',
              volatilityState: 'NORMAL',
              multiTimeframeContext: 'aligned',
              conditionsPassed: ['SWEEP'],
              conditionsFailed: [],
              confluence: { liquidity: 'PASS', structure: 'PASS', displacement: 'PASS', fvg: 'PASS', retest: 'PASS', volatility: 'PASS', multiTimeframe: 'PASS', riskReward: 'PASS' },
              invalidationCondition: 'Close below invalidation',
              isInvalidated: false,
            },
          }),
        ];
      }
      return [];
    },
  };

  const engine1 = new HistoricalReplayEngine();
  engine1.loadDataset(dataset1);
  engine1.setStrategy(strategy);
  runAll(engine1, dataset1.length);

  const engine2 = new HistoricalReplayEngine();
  engine2.loadDataset(dataset2);
  engine2.setStrategy(strategy);
  runAll(engine2, dataset2.length);

  const trade1 = engine1.getClosedTrades()[0];
  const trade2 = engine2.getClosedTrades()[0];

  assert.ok(trade1 && trade2, 'Both trades must exist');
  assert.notStrictEqual(trade1.tradeId, trade2.tradeId, 'Different setup timestamps must produce different trade IDs');
  assert.notStrictEqual(trade1.paperOrderId, trade2.paperOrderId, 'Different setup timestamps must produce different order IDs');
  assert.notStrictEqual(trade1.positionId, trade2.positionId, 'Different setup timestamps must produce different position IDs');

  console.log('[PASS] E. Different setup timestamps -> different trade, order, and position IDs');
}

// =============================================================================
// TEST F: LONG vs SHORT at the same timestamp -> different IDs
// =============================================================================
{
  const baseTime = Date.UTC(2026, 8, 1, 14, 0, 0); // New York overlap
  const step = 15 * 60 * 1000;

  const datasetLong = [
    makeCandle(baseTime, 2650, 2655, 2648, 2652),
    makeCandle(baseTime + step * 1, 2652, 2654, 2650, 2653),
    makeCandle(baseTime + step * 2, 2653, 2680, 2651, 2678), // Hits Long TP
  ];

  const datasetShort = [
    makeCandle(baseTime, 2650, 2655, 2648, 2652),
    makeCandle(baseTime + step * 1, 2652, 2654, 2650, 2653),
    makeCandle(baseTime + step * 2, 2653, 2654, 2620, 2625), // Hits Short TP
  ];

  function makeDirectionStrategy(direction: 'BULLISH' | 'BEARISH'): IReplayStrategy {
    return {
      id: `STRAT_${direction}_ID`,
      name: `STRAT_${direction}`,
      evaluate(context: ReplayCandleContext): SetupRecord[] {
        if (context.currentIndex === 1) {
          const isLong = direction === 'BULLISH';
          return [
            createMockSetup({
              setupId: `SETUP-${direction}-${context.currentCandle.timestamp}`,
              symbol: 'XAU/USD',
              timeframe: '15m',
              direction,
              entryPrice: context.currentCandle.close,
              stopLoss: isLong ? context.currentCandle.close - 10 : context.currentCandle.close + 10,
              targetPrice: isLong ? context.currentCandle.close + 20 : context.currentCandle.close - 20,
              originatingCandleTimestamp: context.currentCandle.timestamp,
              validation: {
                dataVerified: true,
                marketRegime: isLong ? 'TRENDING_BULLISH' : 'TRENDING_BEARISH',
                volatilityState: 'NORMAL',
                multiTimeframeContext: 'aligned',
                conditionsPassed: ['SWEEP'],
                conditionsFailed: [],
                confluence: { liquidity: 'PASS', structure: 'PASS', displacement: 'PASS', fvg: 'PASS', retest: 'PASS', volatility: 'PASS', multiTimeframe: 'PASS', riskReward: 'PASS' },
                invalidationCondition: 'Close level invalidation',
                isInvalidated: false,
              },
            }),
          ];
        }
        return [];
      },
    };
  }

  const engineLong = new HistoricalReplayEngine();
  engineLong.loadDataset(datasetLong);
  engineLong.setStrategy(makeDirectionStrategy('BULLISH'));
  runAll(engineLong, datasetLong.length);

  const engineShort = new HistoricalReplayEngine();
  engineShort.loadDataset(datasetShort);
  engineShort.setStrategy(makeDirectionStrategy('BEARISH'));
  runAll(engineShort, datasetShort.length);

  const tradeLong = engineLong.getClosedTrades()[0];
  const tradeShort = engineShort.getClosedTrades()[0];

  assert.ok(tradeLong && tradeShort, 'Both trades must exist');
  assert.notStrictEqual(tradeLong.tradeId, tradeShort.tradeId, 'LONG and SHORT at same timestamp must have different trade IDs');
  assert.notStrictEqual(tradeLong.paperOrderId, tradeShort.paperOrderId, 'LONG and SHORT at same timestamp must have different order IDs');
  assert.notStrictEqual(tradeLong.positionId, tradeShort.positionId, 'LONG and SHORT at same timestamp must have different position IDs');

  assert.ok(tradeLong.tradeId?.endsWith('-LONG'), 'Long trade ID must end with -LONG');
  assert.ok(tradeShort.tradeId?.endsWith('-SHORT'), 'Short trade ID must end with -SHORT');
  assert.ok(tradeLong.paperOrderId?.endsWith('-LONG'), 'Long order ID must end with -LONG');
  assert.ok(tradeShort.paperOrderId?.endsWith('-SHORT'), 'Short order ID must end with -SHORT');
  assert.ok(tradeLong.positionId?.endsWith('-LONG'), 'Long position ID must end with -LONG');
  assert.ok(tradeShort.positionId?.endsWith('-SHORT'), 'Short position ID must end with -SHORT');

  console.log('[PASS] F. LONG vs SHORT at the same timestamp -> different trade, order, and position IDs');
}

// =============================================================================
// TEST G: No random ID generation remains in the Replay identity path
// =============================================================================
{
  const replayEngineCode = fs.readFileSync(
    path.join(process.cwd(), 'src/services/replay/historical-replay-engine.ts'),
    'utf-8'
  );

  // Check no Math.random in historical-replay-engine.ts
  assert.ok(!replayEngineCode.includes('Math.random'), 'HistoricalReplayEngine must contain zero Math.random occurrences');

  // Check no Date.now in historical-replay-engine.ts
  assert.ok(!replayEngineCode.includes('Date.now()'), 'HistoricalReplayEngine must contain zero Date.now() calls');

  // Run 10 consecutive identical replays and verify 100% ID stability
  const dataset = createTenCandleDataset();
  const baselineEngine = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
  baselineEngine.loadDataset(dataset);
  baselineEngine.setStrategy(createPredictableStrategy());
  runAll(baselineEngine, dataset.length);

  const baselineTradeIds = baselineEngine.getClosedTrades().map(t => t.tradeId);
  const baselineOrderIds = baselineEngine.getClosedTrades().map(t => t.paperOrderId);
  const baselinePosIds = baselineEngine.getClosedTrades().map(t => t.positionId);
  const baselineJournalIds = baselineEngine.getJournal().map(j => j.id);

  for (let i = 0; i < 10; i++) {
    const testEngine = new HistoricalReplayEngine({ symbol: 'XAU/USD', timeframe: '15m' });
    testEngine.loadDataset(dataset);
    testEngine.setStrategy(createPredictableStrategy());
    runAll(testEngine, dataset.length);

    const runTradeIds = testEngine.getClosedTrades().map(t => t.tradeId);
    const runOrderIds = testEngine.getClosedTrades().map(t => t.paperOrderId);
    const runPosIds = testEngine.getClosedTrades().map(t => t.positionId);
    const runJournalIds = testEngine.getJournal().map(j => j.id);

    assert.deepStrictEqual(runTradeIds, baselineTradeIds, `Iteration ${i}: Trade IDs must match baseline`);
    assert.deepStrictEqual(runOrderIds, baselineOrderIds, `Iteration ${i}: Order IDs must match baseline`);
    assert.deepStrictEqual(runPosIds, baselinePosIds, `Iteration ${i}: Position IDs must match baseline`);
    assert.deepStrictEqual(runJournalIds, baselineJournalIds, `Iteration ${i}: Journal IDs must match baseline`);
  }

  console.log('[PASS] G. No random ID generation remains in Replay path (10/10 runs perfectly identical)');
}

// =============================================================================
// TEST H: Existing Replay functionality and lifecycle distinction remain intact
// =============================================================================
{
  const dataset = createTenCandleDataset();
  const engine = new HistoricalReplayEngine({ initialBalance: 100_000, symbol: 'XAU/USD', timeframe: '15m' });
  engine.loadDataset(dataset);
  engine.setStrategy(createPredictableStrategy());
  runAll(engine, dataset.length);

  const metrics = engine.getMetrics();
  assert.strictEqual(metrics.totalTrades, 2, 'Total trades must be 2');
  assert.strictEqual(metrics.winningTrades, 2, 'Winning trades must be 2');
  assert.strictEqual(metrics.losingTrades, 0, 'Losing trades must be 0');
  assert.ok(metrics.totalRealizedPnL > 0, 'Realized PnL must be positive');
  assert.strictEqual(metrics.currentBalance, 100_000 + metrics.totalRealizedPnL, 'Balance must reconcile with realized net PnL');

  // Verify distinction across lifecycle IDs:
  const trades = engine.getClosedTrades();
  for (const trade of trades) {
    assert.ok(trade.setupId.startsWith('P7B-') || trade.setupId.startsWith('SIG-'), 'Setup ID distinct');
    assert.ok(trade.paperOrderId.startsWith('ORD-'), 'Order ID distinct with ORD- prefix');
    assert.ok(trade.positionId?.startsWith('POS-'), 'Position ID distinct with POS- prefix');
    assert.ok(trade.tradeId?.startsWith('TRD-'), 'Trade ID distinct with TRD- prefix');
    assert.ok(trade.journalId.startsWith('JRN-'), 'Journal ID distinct with JRN- prefix');

    // Cross-verify that prefixes are mutually distinct
    assert.notStrictEqual(trade.setupId, trade.paperOrderId);
    assert.notStrictEqual(trade.paperOrderId, trade.positionId);
    assert.notStrictEqual(trade.positionId, trade.tradeId);
    assert.notStrictEqual(trade.tradeId, trade.journalId);
  }

  console.log('[PASS] H. Existing Replay functionality & lifecycle identity distinction remain intact');
}

console.log('================================================================');
console.log('ALL STEP 4 DETERMINISTIC ID TESTS PASSED SUCCESSFULLY (8/8)');
console.log('================================================================');
