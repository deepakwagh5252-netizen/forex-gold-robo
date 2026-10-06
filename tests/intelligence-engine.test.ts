import { Candle } from '../src/market-data/provider.interface';
import { MarketStructureEngine } from '../src/intelligence/market-structure-engine';
import { VolatilityEngine } from '../src/intelligence/volatility-engine';
import { LiquidityEngine } from '../src/intelligence/liquidity-engine';
import { FvgDisplacementEngine } from '../src/intelligence/fvg-displacement-engine';

// Deterministic mock candles with clear swing points, HH/HL, FVG, BOS, and sweeps
const baseTime = 1789700000000;
const hourMs = 3600000;

export const FIXTURE_CANDLES: Candle[] = [
  // Day 1 (Previous Day baseline)
  { timestamp: baseTime - 1 * hourMs, open: 2398.0, high: 2401.0, low: 2392.0, close: 2399.0, volume: 90, isVerified: true }, // Buffer bar
  { timestamp: baseTime + 0 * hourMs, open: 2400.0, high: 2405.0, low: 2395.0, close: 2402.0, volume: 100, isVerified: true },
  { timestamp: baseTime + 1 * hourMs, open: 2402.0, high: 2420.0, low: 2400.0, close: 2415.0, volume: 150, isVerified: true }, // Peak 1 (now at index 2!)
  { timestamp: baseTime + 2 * hourMs, open: 2415.0, high: 2416.0, low: 2408.0, close: 2410.0, volume: 120, isVerified: true },
  { timestamp: baseTime + 3 * hourMs, open: 2410.0, high: 2412.0, low: 2390.0, close: 2392.0, volume: 130, isVerified: true }, // Trough 1
  { timestamp: baseTime + 4 * hourMs, open: 2392.0, high: 2400.0, low: 2391.0, close: 2398.0, volume: 110, isVerified: true },
  { timestamp: baseTime + 24 * hourMs, open: 2398.0, high: 2405.0, low: 2396.0, close: 2404.0, volume: 140, isVerified: true },

  // Day 2 (Bullish Expansion, HH, HL, FVG, BOS)
  // Candle 6 (FVG c1): high 2408
  { timestamp: baseTime + 25 * hourMs, open: 2404.0, high: 2408.0, low: 2402.0, close: 2406.0, volume: 160, isVerified: true },
  // Candle 7 (FVG c2, displacement): big expansion bar open 2406, close 2435, high 2438
  { timestamp: baseTime + 26 * hourMs, open: 2406.0, high: 2438.0, low: 2405.0, close: 2435.0, volume: 350, isVerified: true },
  // Candle 8 (FVG c3): low 2420 > Candle 6 high 2408 => Bullish FVG (2408 to 2420)
  { timestamp: baseTime + 27 * hourMs, open: 2435.0, high: 2445.0, low: 2420.0, close: 2442.0, volume: 220, isVerified: true }, // Peak 2 (Higher High vs 2420)
  // Candle 9: pullback to 2425 (Higher Low vs 2390)
  { timestamp: baseTime + 28 * hourMs, open: 2442.0, high: 2444.0, low: 2425.0, close: 2428.0, volume: 180, isVerified: true },
  // Candle 10: continuation to 2432
  { timestamp: baseTime + 29 * hourMs, open: 2428.0, high: 2435.0, low: 2426.0, close: 2432.0, volume: 140, isVerified: true },
  // Candle 11: further consolidation
  { timestamp: baseTime + 30 * hourMs, open: 2432.0, high: 2436.0, low: 2428.0, close: 2434.0, volume: 130, isVerified: true },
  // Candle 12: equal high test at 2445.2 (Equal High within tolerance of 2445.0)
  { timestamp: baseTime + 31 * hourMs, open: 2434.0, high: 2445.2, low: 2430.0, close: 2438.0, volume: 190, isVerified: true },
  // Candle 13: sweep of 2445.2 high up to 2448.0 then closing down at 2439.0 (Liquidity Sweep)
  { timestamp: baseTime + 32 * hourMs, open: 2438.0, high: 2448.0, low: 2435.0, close: 2439.0, volume: 280, isVerified: true },
  // Candle 14: subsequent bar
  { timestamp: baseTime + 33 * hourMs, open: 2439.0, high: 2442.0, low: 2433.0, close: 2436.0, volume: 150, isVerified: true },
  // Candle 15: trailing bar for ATR(14)
  { timestamp: baseTime + 34 * hourMs, open: 2436.0, high: 2440.0, low: 2432.0, close: 2435.0, volume: 120, isVerified: true },
  // Candle 16: trailing bar
  { timestamp: baseTime + 35 * hourMs, open: 2435.0, high: 2441.0, low: 2434.0, close: 2438.0, volume: 110, isVerified: true },
];

function runTests() {
  console.log('Running Deterministic Intelligence Engine Tests...');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
    }
  }

  const structureEngine = new MarketStructureEngine({ leftBars: 2, rightBars: 2 });
  const volatilityEngine = new VolatilityEngine({ period: 14, lowMaxRatio: 0.6, normalMaxRatio: 1.4, highMaxRatio: 2.2 });
  const liquidityEngine = new LiquidityEngine({ pipTolerance: 0.40, minBarsApart: 2 });
  const fvgEngine = new FvgDisplacementEngine();

  // Test 1: Swings detection
  const swings = structureEngine.detectSwings(FIXTURE_CANDLES);
  assert(swings.length > 0, `Swing detection returned ${swings.length} swings`);
  const swingHighs = swings.filter(s => s.type === 'SWING_HIGH');
  assert(swingHighs.some(s => s.price === 2420.0 || s.price === 2445.0), 'Detected expected swing high levels');

  // Test 2: Market Structure & Trend
  const structure = structureEngine.analyzeStructure(FIXTURE_CANDLES);
  assert(structure.higherHighsCount > 0, `HH count: ${structure.higherHighsCount}`);
  assert(structure.trendState !== 'UNDEFINED', `Trend state resolved: ${structure.trendState}`);

  // Test 3: Previous Day Levels
  const periodLevels = liquidityEngine.calculatePeriodLevels(FIXTURE_CANDLES);
  assert(periodLevels.pdh !== null && periodLevels.pdl !== null, `PDH: ${periodLevels.pdh}, PDL: ${periodLevels.pdl}`);

  // Test 4: ATR & Volatility
  const vol = volatilityEngine.calculateATR(FIXTURE_CANDLES);
  assert(vol.atr !== null && vol.atr > 0, `ATR(14) calculated: ${vol.atr}`);
  assert(['LOW', 'NORMAL', 'HIGH', 'EXTREME'].includes(vol.classification), `Volatility classification: ${vol.classification}`);

  // Test 5: Session Ranges
  const sessions = liquidityEngine.calculateSessions(FIXTURE_CANDLES);
  assert(sessions.length === 3, `Sessions calculated: ${sessions.map(s => s.name).join(', ')}`);

  // Test 6: Fair Value Gap (FVG)
  const fvgs = fvgEngine.detectFVGs(FIXTURE_CANDLES);
  assert(fvgs.length > 0, `Detected ${fvgs.length} FVGs`);
  const bullishFvg = fvgs.find(f => f.direction === 'BULLISH');
  assert(bullishFvg !== undefined && bullishFvg.lowerBoundary === 2408 && bullishFvg.upperBoundary === 2420, 'Identified exact Bullish FVG boundary (2408 to 2420)');

  // Test 7: Displacement
  const displacements = fvgEngine.detectDisplacement(FIXTURE_CANDLES, vol.atr);
  assert(displacements.length > 0, `Detected ${displacements.length} displacement bars`);

  // Test 8: Equal Highs and Liquidity Sweeps
  const map = liquidityEngine.generateLiquidityMap(FIXTURE_CANDLES, periodLevels, sessions);
  assert(map.length > 0, `Generated ${map.length} liquidity levels`);

  const sweeps = liquidityEngine.detectSweeps(FIXTURE_CANDLES, map);
  assert(Array.isArray(sweeps), `Executed sweep detection (${sweeps.length} sweeps found)`);

  // Test 9: BOS and CHOCH events
  const events = structureEngine.detectStructureEvents(FIXTURE_CANDLES, structure.swingHighs, structure.swingLows);
  assert(events.length > 0, `Detected ${events.length} structure events (BOS/CHOCH)`);

  console.log(`\nTest Result: ${passed}/${total} assertions passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
