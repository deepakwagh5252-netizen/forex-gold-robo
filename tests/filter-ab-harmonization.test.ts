import assert from 'assert';
import { evaluateFilterAB } from '../src/strategy/filter-ab';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { Candle } from '../src/market-data/provider.interface';
import { SetupRecord } from '../src/types/scanner';
import { IReplayStrategy } from '../src/types/replay';

console.log('================================================================');
console.log('FILTER AB HARMONIZATION TEST SUITE (REPLAY <-> FORWARD)');
console.log('Testing pure Filter AB function and harmonization across engines');
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
// Helper to create synthetic candle at specific ISO datetime
// -----------------------------------------------------------------------------
function createCandleAtUtc(isoDateStr: string, price: number = 2650): Candle {
  const timestamp = new Date(isoDateStr).getTime();
  return {
    timestamp,
    datetime: isoDateStr,
    open: price,
    high: price + 2,
    low: price - 2,
    close: price,
    volume: 100,
    isVerified: true,
  };
}

// -----------------------------------------------------------------------------
// Helper to create typed SetupRecord
// -----------------------------------------------------------------------------
function createCandidateSetup(
  direction: 'BULLISH' | 'BEARISH',
  regime: string,
  candle: Candle
): SetupRecord {
  const isLong = direction === 'BULLISH';
  const entry = candle.close;
  const stop = isLong ? entry - 10 : entry + 10;
  const target = isLong ? entry + 20 : entry - 20;
  const dt = candle.datetime ?? new Date(candle.timestamp).toISOString();

  return {
    setupId: `SETUP-${candle.timestamp}-${direction}`,
    symbol: 'XAU/USD',
    timeframe: '15m',
    direction,
    setupFamily: 'BREAKOUT_RETEST',
    createdAt: dt,
    lastUpdated: dt,
    status: 'VALIDATED_CANDIDATE',
    statusReason: 'Breakout retest confirmed',
    lifecycleSequence: ['WATCH', 'SETUP_FORMING', 'VALIDATED_CANDIDATE'],
    evidence: {
      liquidityLevel: 2650,
      liquiditySource: 'SESSION_HIGH',
      sweepDetected: true,
      sweepTimestamp: candle.timestamp,
      sweepDatetime: dt,
      sweepHighOrLow: 2655,
      structureEvent: 'CHOCH',
      structureTimestamp: candle.timestamp,
      structureDatetime: dt,
      brokenLevel: 2652,
      displacementDetected: true,
      displacementTimestamp: candle.timestamp,
      displacementDatetime: dt,
      displacementBodyRatio: 0.75,
      fvgDetected: false,
      fvgUpper: null,
      fvgLower: null,
      fvgTimestamp: null,
      fvgDatetime: null,
      retestDetected: true,
      retestTimestamp: candle.timestamp,
      retestDatetime: dt,
      retestPrice: entry,
      retestHolds: true,
    },
    risk: {
      entryReference: entry,
      entryType: 'CALCULATED',
      entryMethod: 'LIMIT_RETEST',
      stopLossReference: stop,
      stopLossType: 'CALCULATED',
      stopLossMethod: 'SWING_LOW',
      targetReference: target,
      targetType: 'CALCULATED',
      targetSource: '2x risk target',
      riskDistance: 10,
      rewardDistance: 20,
      riskRewardRatio: 2.0,
      minimumRequiredRR: 1.5,
    },
    validation: {
      dataVerified: true,
      marketRegime: regime,
      volatilityState: 'NORMAL',
      multiTimeframeContext: 'aligned',
      conditionsPassed: ['SWEEP', 'STRUCTURE', 'DISPLACEMENT', 'RETEST'],
      conditionsFailed: [],
      confluence: {
        liquidity: 'PASS',
        structure: 'PASS',
        displacement: 'PASS',
        fvg: 'NOT_AVAILABLE',
        retest: 'PASS',
        volatility: 'PASS',
        multiTimeframe: 'PASS',
        riskReward: 'PASS',
      },
      invalidationCondition: isLong ? `Candle close below $${stop}` : `Candle close above $${stop}`,
      isInvalidated: false,
    },
    provenance: {
      fact: ['Test candle verification'],
      calculation: ['1:2 RR'],
      modelOutput: ['Harmonization test setup'],
    },
    originatingCandleTimestamp: candle.timestamp,
    originatingEventKey: `M15-${candle.timestamp}`,
  };
}

// =============================================================================
// TEST CASES 1 - 9
// =============================================================================

// 1. BEARISH + TRENDING_BEARISH -> A reject
runTest('1. BEARISH + TRENDING_BEARISH -> Filter A reject', () => {
  const afternoonTs = new Date('2026-09-01T14:30:00Z').getTime(); // Non-Asian session
  const res = evaluateFilterAB({
    direction: 'BEARISH',
    regime: 'TRENDING_BEARISH',
    timestamp: afternoonTs,
  });

  assert.strictEqual(res.rejectA, true, 'Filter A must reject BEARISH in TRENDING_BEARISH');
  assert.strictEqual(res.rejectB, false, 'Filter B must pass outside Asian session');
  assert.strictEqual(res.rejectAB, true, 'Combined Filter AB must reject');
  assert.strictEqual(res.passed, false, 'Setup must not pass');
  assert.strictEqual(res.filterAResult, 'REJECT');
  assert.strictEqual(res.filterBResult, 'PASS');
  assert.strictEqual(res.combinedFilterResult, 'REJECT');
  assert.strictEqual(res.reason, 'FILTER_A_REJECTED: Short breakdown during TRENDING_BEARISH regime');

  // Verify 'SHORT' alias semantics also match
  const resShort = evaluateFilterAB({
    direction: 'SHORT',
    regime: 'TRENDING_BEARISH',
    timestamp: afternoonTs,
  });
  assert.strictEqual(resShort.rejectA, true, 'Filter A must reject SHORT alias in TRENDING_BEARISH');
});

// 2. BEARISH + non-bearish -> A pass
runTest('2. BEARISH + non-bearish -> Filter A pass', () => {
  const afternoonTs = new Date('2026-09-01T14:30:00Z').getTime();
  const nonBearishRegimes = [
    'TRENDING_BULLISH',
    'RANGING_CONSOLIDATION',
    'VOLATILITY_EXPANSION',
    'LOW_VOLATILITY_COMPRESSION',
    'UNDEFINED',
  ];

  for (const regime of nonBearishRegimes) {
    const res = evaluateFilterAB({
      direction: 'BEARISH',
      regime,
      timestamp: afternoonTs,
    });

    assert.strictEqual(res.rejectA, false, `Filter A must pass BEARISH in non-bearish regime: ${regime}`);
    assert.strictEqual(res.filterAResult, 'PASS');
  }
});

// 3. BULLISH + TRENDING_BEARISH -> A pass
runTest('3. BULLISH + TRENDING_BEARISH -> Filter A pass', () => {
  const afternoonTs = new Date('2026-09-01T14:30:00Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BULLISH',
    regime: 'TRENDING_BEARISH',
    timestamp: afternoonTs,
  });

  assert.strictEqual(res.rejectA, false, 'Filter A must pass BULLISH even in TRENDING_BEARISH');
  assert.strictEqual(res.filterAResult, 'PASS');

  // Verify 'LONG' alias semantics
  const resLong = evaluateFilterAB({
    direction: 'LONG',
    regime: 'TRENDING_BEARISH',
    timestamp: afternoonTs,
  });
  assert.strictEqual(resLong.rejectA, false, 'Filter A must pass LONG in TRENDING_BEARISH');
});

// 4. 00:00 UTC -> B reject
runTest('4. 00:00 UTC -> Filter B reject', () => {
  const midnightTs = new Date('2026-09-01T00:00:00.000Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BULLISH',
    regime: 'TRENDING_BULLISH',
    timestamp: midnightTs,
  });

  assert.strictEqual(res.rejectB, true, 'Filter B must reject setup at 00:00:00 UTC');
  assert.strictEqual(res.rejectA, false, 'Filter A passes for BULLISH');
  assert.strictEqual(res.rejectAB, true, 'Combined Filter AB must reject');
  assert.strictEqual(res.filterBResult, 'REJECT');
  assert.strictEqual(res.reason, 'FILTER_B_REJECTED: Breakout entry during Asian Session (00:00-07:00 UTC)');
});

// 5. 06:59 UTC -> B reject
runTest('5. 06:59 UTC -> Filter B reject', () => {
  const endAsianTs = new Date('2026-09-01T06:59:59.999Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BULLISH',
    regime: 'TRENDING_BULLISH',
    timestamp: endAsianTs,
  });

  assert.strictEqual(res.rejectB, true, 'Filter B must reject setup at 06:59:59.999 UTC');
  assert.strictEqual(res.rejectAB, true, 'Combined Filter AB must reject at end of Asian session');
  assert.strictEqual(res.filterBResult, 'REJECT');
  assert.strictEqual(res.reason, 'FILTER_B_REJECTED: Breakout entry during Asian Session (00:00-07:00 UTC)');
});

// 6. 07:00 UTC -> B pass
runTest('6. 07:00 UTC -> Filter B pass', () => {
  const startLondonTs = new Date('2026-09-01T07:00:00.000Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BULLISH',
    regime: 'TRENDING_BULLISH',
    timestamp: startLondonTs,
  });

  assert.strictEqual(res.rejectB, false, 'Filter B must pass at 07:00:00 UTC');
  assert.strictEqual(res.rejectA, false);
  assert.strictEqual(res.rejectAB, false);
  assert.strictEqual(res.passed, true);
  assert.strictEqual(res.filterBResult, 'PASS');
  assert.strictEqual(res.reason, 'FILTER_AB_PASSED');
});

// 7. Both conditions -> both reject
runTest('7. Both conditions (BEARISH in TRENDING_BEARISH at Asian session) -> both reject', () => {
  const asianTs = new Date('2026-09-01T03:30:00Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BEARISH',
    regime: 'TRENDING_BEARISH',
    timestamp: asianTs,
  });

  assert.strictEqual(res.rejectA, true, 'Filter A must reject');
  assert.strictEqual(res.rejectB, true, 'Filter B must reject');
  assert.strictEqual(res.rejectAB, true, 'Combined Filter AB must reject');
  assert.strictEqual(res.passed, false);
  assert.strictEqual(res.filterAResult, 'REJECT');
  assert.strictEqual(res.filterBResult, 'REJECT');
  assert.strictEqual(res.combinedFilterResult, 'REJECT');
  assert.strictEqual(
    res.reason,
    'FILTER_AB_REJECTED: Short in Trending Bearish regime AND Asian Session (00:00-07:00 UTC)'
  );
});

// 8. Neither -> pass
runTest('8. Neither condition triggered -> pass', () => {
  const nyTs = new Date('2026-09-01T15:00:00Z').getTime();
  const res = evaluateFilterAB({
    direction: 'BULLISH',
    regime: 'TRENDING_BULLISH',
    timestamp: nyTs,
  });

  assert.strictEqual(res.rejectA, false, 'Filter A passes');
  assert.strictEqual(res.rejectB, false, 'Filter B passes');
  assert.strictEqual(res.rejectAB, false, 'Combined passes');
  assert.strictEqual(res.passed, true);
  assert.strictEqual(res.filterAResult, 'PASS');
  assert.strictEqual(res.filterBResult, 'PASS');
  assert.strictEqual(res.combinedFilterResult, 'PASS');
  assert.strictEqual(res.reason, 'FILTER_AB_PASSED');
});

// 9. Same inputs -> Forward and Replay produce identical decisions
runTest('9. Same inputs -> Forward and Replay produce identical decisions', () => {
  // Scenario A: Setup rejected by Filter A (SHORT in TRENDING_BEARISH at 14:00 UTC)
  const candleA = createCandleAtUtc('2026-09-01T14:00:00Z', 2650);
  const setupA = createCandidateSetup('BEARISH', 'TRENDING_BEARISH', candleA);

  // Replay Engine with Filter AB enabled
  const replayEngineA = new HistoricalReplayEngine({
    filterABEnabled: true,
  });
  replayEngineA.loadDataset([candleA]);

  const mockStrategyA: IReplayStrategy = {
    id: 'test-strategy-a',
    name: 'Test Strategy A',
    evaluate: () => [setupA],
  };

  replayEngineA.setStrategy(mockStrategyA);
  replayEngineA.stepForward();

  // Forward evaluation using the exact same shared filter
  const forwardResultA = evaluateFilterAB({
    direction: setupA.direction,
    regime: setupA.validation.marketRegime,
    timestamp: candleA.timestamp,
  });

  const replayJournalA = replayEngineA.getJournal();
  const replayRejectionA = replayJournalA.find(j => j.eventType === 'ORDER_REJECTED');

  assert.strictEqual(forwardResultA.rejectAB, true, 'Forward must reject setup A');
  assert.strictEqual(forwardResultA.rejectA, true, 'Forward Filter A must reject setup A');
  assert.ok(replayRejectionA, 'Replay must record ORDER_REJECTED for setup A');
  assert.strictEqual(replayRejectionA.reason, forwardResultA.reason, 'Replay rejection reason must match Forward exactly');
  assert.strictEqual(replayEngineA.getOpenPositions().length, 0, 'Replay must open NO position on rejected setup');
  assert.strictEqual(replayEngineA.getClosedTrades().length, 0, 'Replay must have NO closed trades');
  assert.strictEqual(replayEngineA.getMetrics().totalRealizedPnL, 0, 'Replay must have 0 P&L');

  // Scenario B: Setup rejected by Filter B (BULLISH in Asian Session at 02:00 UTC)
  const candleB = createCandleAtUtc('2026-09-01T02:00:00Z', 2650);
  const setupB = createCandidateSetup('BULLISH', 'TRENDING_BULLISH', candleB);

  const replayEngineB = new HistoricalReplayEngine({
    filterABEnabled: true,
  });
  replayEngineB.loadDataset([candleB]);

  const mockStrategyB: IReplayStrategy = {
    id: 'test-strategy-b',
    name: 'Test Strategy B',
    evaluate: () => [setupB],
  };

  replayEngineB.setStrategy(mockStrategyB);
  replayEngineB.stepForward();

  const forwardResultB = evaluateFilterAB({
    direction: setupB.direction,
    regime: setupB.validation.marketRegime,
    timestamp: candleB.timestamp,
  });

  const replayJournalB = replayEngineB.getJournal();
  const replayRejectionB = replayJournalB.find(j => j.eventType === 'ORDER_REJECTED');

  assert.strictEqual(forwardResultB.rejectAB, true, 'Forward must reject setup B');
  assert.strictEqual(forwardResultB.rejectB, true, 'Forward Filter B must reject setup B');
  assert.ok(replayRejectionB, 'Replay must record ORDER_REJECTED for setup B');
  assert.strictEqual(replayRejectionB.reason, forwardResultB.reason, 'Replay rejection reason must match Forward exactly');
  assert.strictEqual(replayEngineB.getOpenPositions().length, 0, 'Replay must open NO position');
  assert.strictEqual(replayEngineB.getMetrics().totalRealizedPnL, 0, 'Replay must have 0 P&L');

  // Scenario C: Setup passing both filters (BULLISH in TRENDING_BULLISH at 14:00 UTC)
  const candleC = createCandleAtUtc('2026-09-01T14:00:00Z', 2650);
  const setupC = createCandidateSetup('BULLISH', 'TRENDING_BULLISH', candleC);

  const replayEngineC = new HistoricalReplayEngine({
    filterABEnabled: true,
  });
  replayEngineC.loadDataset([candleC]);

  const mockStrategyC: IReplayStrategy = {
    id: 'test-strategy-c',
    name: 'Test Strategy C',
    evaluate: () => [setupC],
  };

  replayEngineC.setStrategy(mockStrategyC);
  replayEngineC.stepForward();

  const forwardResultC = evaluateFilterAB({
    direction: setupC.direction,
    regime: setupC.validation.marketRegime,
    timestamp: candleC.timestamp,
  });

  const replayJournalC = replayEngineC.getJournal();
  const replayRejectionC = replayJournalC.find(j => j.eventType === 'ORDER_REJECTED');

  assert.strictEqual(forwardResultC.rejectAB, false, 'Forward must pass setup C');
  assert.strictEqual(forwardResultC.passed, true);
  assert.strictEqual(replayRejectionC, undefined, 'Replay must NOT reject setup C at Filter AB');
  assert.strictEqual(replayEngineC.getOpenPositions().length, 1, 'Replay must open position for valid passing setup');
});

console.log('================================================================');
console.log(`TOTAL TESTS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
