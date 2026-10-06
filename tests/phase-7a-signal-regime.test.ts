import { Candle } from '../src/market-data/provider.interface';
import { MarketRegimeEngine } from '../src/intelligence/market-regime-engine';
import { BreakoutEngine } from '../src/intelligence/breakout-engine';
import { DeterministicSignalEngine } from '../src/intelligence/deterministic-signal-engine';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { ReplayCandleContext } from '../src/types/replay';

/**
 * PHASE 7A: DETERMINISTIC SIGNAL ARCHITECTURE & REGIME ENGINE TEST SUITE
 */
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${message}`);
  }
}

console.log('\n=== PHASE 7A: MARKET REGIME & SIGNAL ARCHITECTURE TEST SUITE ===');

const baseTimestamp = 1710000000000;
const intervalMs = 15 * 60 * 1000;

function createCandles(count: number, generator: (i: number, basePrice: number) => { o: number; h: number; l: number; c: number }): Candle[] {
  const candles: Candle[] = [];
  let basePrice = 2400;
  for (let i = 0; i < count; i++) {
    const { o, h, l, c } = generator(i, basePrice);
    basePrice = c;
    candles.push({
      timestamp: baseTimestamp + i * intervalMs,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: 100 + (i % 20) * 10,
      isVerified: true,
      datetime: new Date(baseTimestamp + i * intervalMs).toISOString(),
    });
  }
  return candles;
}

// 1. Regime Engine: Undefined when history < 14
const shortCandles = createCandles(10, (i) => ({ o: 2400, h: 2405, l: 2395, c: 2402 }));
const regimeEngine = new MarketRegimeEngine();
const repUndefined = regimeEngine.evaluateRegime(shortCandles);
assert(repUndefined.regime === 'UNDEFINED', '1. History < 14 correctly results in UNDEFINED regime');

// 2. Regime Engine: Trending Bullish
const bullCandles = createCandles(30, (i) => {
  const p = 2400 + i * 2;
  return { o: p, h: p + 3, l: p - 1, c: p + 2 };
});
const repBull = regimeEngine.evaluateRegime(bullCandles);
assert(repBull.regime === 'TRENDING_BULLISH' || repBull.regime === 'VOLATILITY_EXPANSION', '2. Upward stair-stepping candles classify as TRENDING_BULLISH or EXPANSION');
assert(repBull.atrValue > 0, '2. ATR value is positively calculated');

// 3. Regime Engine: Low Volatility Compression
const flatCandles = createCandles(40, (i) => {
  return { o: 2400, h: 2400.20, l: 2399.80, c: 2400.05 };
});
const repComp = regimeEngine.evaluateRegime(flatCandles);
assert(repComp.regime === 'LOW_VOLATILITY_COMPRESSION' || repComp.compression === true, '3. Tight range candle series flags compression');

// 4. Breakout Engine: Valid Breakout
const breakoutEngine = new BreakoutEngine();
const breakoutCandles = createCandles(20, (i) => {
  if (i === 19) {
    return { o: 2410, h: 2420, l: 2409, c: 2419 }; // Large green bar breaking 2410
  }
  return { o: 2400 + (i % 3), h: 2405, l: 2395, c: 2402 };
});
const evalBreakout = breakoutEngine.evaluateBreakouts(
  breakoutCandles,
  {
    trendState: 'BULLISH',
    rangeState: 'TRENDING',
    swingHighs: [{ index: 5, price: 2405, timestamp: baseTimestamp + 5 * intervalMs, datetime: '', type: 'SWING_HIGH', isConfirmed: true }],
    swingLows: [{ index: 3, price: 2395, timestamp: baseTimestamp + 3 * intervalMs, datetime: '', type: 'SWING_LOW', isConfirmed: true }],
    lastSwingHigh: { index: 5, price: 2405, timestamp: baseTimestamp + 5 * intervalMs, datetime: '', type: 'SWING_HIGH', isConfirmed: true },
    lastSwingLow: { index: 3, price: 2395, timestamp: baseTimestamp + 3 * intervalMs, datetime: '', type: 'SWING_LOW', isConfirmed: true },
    higherHighsCount: 1,
    higherLowsCount: 1,
    lowerHighsCount: 0,
    lowerLowsCount: 0,
    lastStructurePoint: null,
    lastEvent: null,
  },
  2405,
  2395
);
assert(evalBreakout.type === 'VALID_BREAKOUT', '4. Strong close above resistance identifies as VALID_BREAKOUT');
assert(evalBreakout.displacementRatio >= 0.60, '4. Displacement ratio is >= 60% body');

// 5. Breakout Engine: Bull Trap (Fakeout)
const fakeoutCandles = createCandles(20, (i) => {
  if (i === 19) {
    return { o: 2404, h: 2415, l: 2400, c: 2402 }; // Wicks high above 2405 but closes at 2402
  }
  return { o: 2400 + (i % 3), h: 2404, l: 2395, c: 2402 };
});
const evalTrap = breakoutEngine.evaluateBreakouts(
  fakeoutCandles,
  {
    trendState: 'RANGING',
    rangeState: 'CONSOLIDATING',
    swingHighs: [],
    swingLows: [],
    lastSwingHigh: null,
    lastSwingLow: null,
    higherHighsCount: 0,
    higherLowsCount: 0,
    lowerHighsCount: 0,
    lowerLowsCount: 0,
    lastStructurePoint: null,
    lastEvent: null,
  },
  2405,
  2395
);
assert(evalTrap.type === 'FAKE_BREAKOUT_BULL_TRAP', '5. Rejection back into range identifies as FAKE_BREAKOUT_BULL_TRAP');
assert(evalTrap.isFakeoutTrap === true, '5. Flag isFakeoutTrap is true');

// 6. Deterministic Signal Engine: No Trade Zone during Compression
const signalEngine = new DeterministicSignalEngine({ symbol: 'XAU/USD', timeframe: 'M15' });
const sigComp = signalEngine.generateSignal(flatCandles);
assert(sigComp.state === 'NO_TRADE_ZONE', '6. Compression series leads to NO_TRADE_ZONE state');
assert(sigComp.isTradable === false, '6. Compressed signal is not tradable');
assert(sigComp.noTradeReason === 'COMPRESSION_WITHOUT_EXPANSION', '6. Correct no-trade reason specified');

// 7. Deterministic Signal Engine: Confirmed Bull Trap Contrarian Trade
const sigTrap = signalEngine.generateSignal(fakeoutCandles);
assert(sigTrap.breakoutType === 'FAKE_BREAKOUT_BULL_TRAP', '7. Bull trap identified in signal engine');
if (sigTrap.isTradable) {
  assert(sigTrap.direction === 'SHORT', '7. Bull trap contrarian signal trades SHORT');
  assert(sigTrap.stopLoss! > sigTrap.entryPrice!, '7. Short stop loss is above entry price');
}

// 8. Deterministic Signal Engine: Replay Engine Compatibility
const replayEngine = new HistoricalReplayEngine();
const testCandles = createCandles(50, (i) => {
  const p = 2400 + Math.sin(i / 5) * 10;
  return { o: p, h: p + 2, l: p - 2, c: p + 0.5 };
});
const loadRes = replayEngine.loadDataset(testCandles);
assert(loadRes.isValid === true, '8. Dataset loads cleanly into HistoricalReplayEngine');

// Attach Phase 7A strategy to Replay Engine
replayEngine.setStrategy(signalEngine);
replayEngine.stepForward();
const stepRes = replayEngine.stepForward();
assert(stepRes !== null && stepRes.candleIndex === 1, '8. Replay steps through candle with Phase 7A strategy active');
assert(stepRes !== null && stepRes.isComplete === false, '8. Replay step succeeds without runtime errors');

// 9. Strict Determinism Check
const sig1 = signalEngine.generateSignal(testCandles);
const sig2 = signalEngine.generateSignal(testCandles);
assert(sig1.state === sig2.state, '9. Deterministic signal states match across executions');
assert(sig1.confluenceScore === sig2.confluenceScore, '9. Confluence scores match across executions');
assert(sig1.direction === sig2.direction, '9. Directions match across executions');

console.log('======================================================');
console.log('ALL 9 PHASE 7A TESTS PASSED (9/9)');
console.log('======================================================');
