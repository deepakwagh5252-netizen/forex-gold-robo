import { Candle } from '../src/market-data/provider.interface';
import { setupScannerEngine } from '../src/intelligence/setup-scanner-engine';
import { xauUsdIntelligenceCoordinator } from '../src/intelligence/xau-usd-coordinator';
import { XauUsdMarketIntelligence, MultiTimeframeFact } from '../src/types/intelligence';

const baseTime = 1789700000000;
const hourMs = 3600000;

function runSetupScannerTests() {
  console.log('Running Deterministic Setup Scanner Engine Tests...');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
    }
  }

  // Helper to build base mock intelligence
  function createBaseIntel(): XauUsdMarketIntelligence {
    return {
      symbol: 'XAU/USD',
      timeframe: 'M15',
      status: 'VERIFIED',
      candleCount: 20,
      latestCandle: { timestamp: baseTime + 20 * hourMs, open: 2400, high: 2405, low: 2398, close: 2402, volume: 100, isVerified: true },
      marketStructure: {
        trendState: 'BEARISH',
        rangeState: 'TRENDING',
        swingHighs: [
          { index: 2, type: 'SWING_HIGH', price: 2430.0, timestamp: baseTime + 2 * hourMs, datetime: new Date(baseTime + 2 * hourMs).toISOString(), structureType: 'HH', isConfirmed: true },
        ],
        swingLows: [
          { index: 5, type: 'SWING_LOW', price: 2390.0, timestamp: baseTime + 5 * hourMs, datetime: new Date(baseTime + 5 * hourMs).toISOString(), structureType: 'HL', isConfirmed: true },
        ],
        lastSwingHigh: { index: 2, type: 'SWING_HIGH', price: 2430.0, timestamp: baseTime + 2 * hourMs, datetime: new Date(baseTime + 2 * hourMs).toISOString(), structureType: 'HH', isConfirmed: true },
        lastSwingLow: { index: 5, type: 'SWING_LOW', price: 2390.0, timestamp: baseTime + 5 * hourMs, datetime: new Date(baseTime + 5 * hourMs).toISOString(), structureType: 'HL', isConfirmed: true },
        higherHighsCount: 1,
        higherLowsCount: 1,
        lowerHighsCount: 0,
        lowerLowsCount: 0,
        lastStructurePoint: 'HH',
        lastEvent: null,
      },
      previousPeriodLevels: {
        pdh: 2420.0,
        pdl: 2350.0,
        pdo: 2380.0,
        pdc: 2400.0,
        pwh: 2450.0,
        pwl: 2320.0,
        pwo: 2370.0,
        pwc: 2410.0,
        timestamp: baseTime,
        datetime: new Date(baseTime).toISOString(),
      },
      volatility: {
        atr: 12.0,
        period: 14,
        classification: 'NORMAL',
        currentCandleRange: 10.0,
        averageRangeRatio: 0.83,
        thresholds: { lowMaxRatio: 0.7, normalMaxRatio: 1.3, highMaxRatio: 2.0 },
      },
      sessions: [],
      liquidityLevels: [
        { id: 'PDH', level: 2420.0, source: 'PREVIOUS_DAY_HIGH', timestamp: baseTime, datetime: new Date(baseTime).toISOString(), distanceFromCurrentPrice: 18.0, validationStatus: 'CONFIRMED', isSwept: true },
        { id: 'PDL', level: 2350.0, source: 'PREVIOUS_DAY_LOW', timestamp: baseTime, datetime: new Date(baseTime).toISOString(), distanceFromCurrentPrice: 52.0, validationStatus: 'CONFIRMED', isSwept: false },
      ],
      liquiditySweeps: [],
      displacements: [],
      fairValueGaps: [],
      structureEvents: [],
      multiTimeframeFacts: [
        { timeframe: 'M15', hasData: true, candleCount: 20, trend: 'BEARISH', structure: 'HH (TRENDING)', volatility: 'NORMAL', atr: 12.0, liquidityState: 'Active', latestCandleTimestamp: baseTime + 20 * hourMs },
        { timeframe: 'H1', hasData: true, candleCount: 20, trend: 'BEARISH', structure: 'LH (TRENDING)', volatility: 'NORMAL', atr: 15.0, liquidityState: 'Active', latestCandleTimestamp: baseTime + 20 * hourMs },
      ],
      calculatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------
  // Test 1: Valid Liquidity Sweep Reversal (Complete sequence -> VALIDATED_CANDIDATE)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 30,
      candles: [] as any,
    }];

    // Subsequent candles: Candle at t+4 retraces into FVG (high 2408 touches FVG [2404, 2412]) and closes at 2402 (held)
    const mockCandles: Candle[] = [];
    for (let i = 0; i <= 15; i++) {
      const t = sweepTime + i * hourMs;
      if (i === 4) {
        // Retest candle
        mockCandles.push({ timestamp: t, open: 2400, high: 2408, low: 2398, close: 2402, volume: 150, isVerified: true });
      } else {
        mockCandles.push({ timestamp: t, open: 2400, high: 2403, low: 2396, close: 2399, volume: 100, isVerified: true });
      }
    }

    const summary = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const validated = summary.candidates.find(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');
    
    assert(summary.status === 'VALIDATED_CANDIDATES_FOUND', 'Test 1: Valid sweep reversal summary status is VALIDATED_CANDIDATES_FOUND');
    assert(validated !== undefined && validated.status === 'VALIDATED_CANDIDATE', 'Test 1: Sweep reversal is VALIDATED_CANDIDATE');
    assert(validated?.risk.riskRewardRatio !== null && (validated?.risk.riskRewardRatio || 0) >= 2.0, 'Test 1: R:R ratio meets requirement (>= 2.0)');
  }

  // -------------------------------------------------------------
  // Test 2: Sweep without structure confirmation (status -> WATCH, not validated)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = []; // NO structure change
    intel.displacements = [];
    intel.fairValueGaps = [];

    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + i * hourMs, open: 2415, high: 2418, low: 2412, close: 2416, volume: 100, isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    const candidate = summary.candidates.find(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');

    assert(summary.status === 'NO_VALIDATED_SETUP', 'Test 2: Sweep without structure has summary NO_VALIDATED_SETUP');
    assert(candidate?.status === 'WATCH', 'Test 2: Candidate remains in WATCH state');
    assert(candidate?.validation.confluence.structure === 'FAIL', 'Test 2: Structure confluence is FAIL');
  }

  // -------------------------------------------------------------
  // Test 3: Structure break without sweep
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const breakTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = []; // NO SWEEP
    intel.structureEvents = [{
      type: 'BOS',
      direction: 'BEARISH',
      brokenLevel: 2390.0,
      breakCandleTimestamp: breakTime,
      datetime: new Date(breakTime).toISOString(),
      timeframe: 'M15',
    }];

    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: breakTime + i * hourMs, open: 2388, high: 2389, low: 2380, close: 2382, volume: 100, isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    const sweepCandidates = summary.candidates.filter(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');
    const breakoutCandidates = summary.candidates.filter(c => c.setupFamily === 'BREAKOUT_RETEST');

    assert(sweepCandidates.length === 0, 'Test 3: Zero sweep candidates generated when no sweep occurred');
    assert(breakoutCandidates.length > 0, 'Test 3: Breakout retest candidate evaluated for structure break');
  }

  // -------------------------------------------------------------
  // Test 4: FVG without retest (status -> SETUP_FORMING)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    // Subsequent candles stay far below FVG (highs < 2400, never touching 2404)
    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (4 + i) * hourMs, open: 2390, high: 2395, low: 2385, close: 2388, volume: 100, isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    const candidate = summary.candidates.find(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');

    assert(candidate?.status === 'SETUP_FORMING', 'Test 4: FVG without retest has status SETUP_FORMING');
    assert(candidate?.validation.confluence.retest === 'FAIL', 'Test 4: Retest confluence is FAIL');
  }

  // -------------------------------------------------------------
  // Test 5: Complete Breakout + Retest setup (-> VALIDATED_CANDIDATE)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const breakTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [];
    intel.structureEvents = [{
      type: 'BOS',
      direction: 'BEARISH',
      brokenLevel: 2390.0,
      breakCandleTimestamp: breakTime,
      datetime: new Date(breakTime).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: breakTime,
      datetime: new Date(breakTime).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.marketStructure!.lastSwingHigh = {
      index: 1,
      type: 'SWING_HIGH',
      price: 2400.0,
      timestamp: breakTime - 2 * hourMs,
      datetime: new Date(breakTime - 2 * hourMs).toISOString(),
      isConfirmed: true,
    };

    // Subsequent candles: bar touches 2390.0 (high 2390.2) and holds (close 2388)
    const mockCandles: Candle[] = [];
    for (let i = 1; i <= 15; i++) {
      const t = breakTime + i * hourMs;
      if (i === 2) {
        mockCandles.push({ timestamp: t, open: 2385, high: 2390.2, low: 2384, close: 2388, volume: 140, isVerified: true });
      } else {
        mockCandles.push({ timestamp: t, open: 2385, high: 2388, low: 2378, close: 2380, volume: 100, isVerified: true });
      }
    }

    const summary = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const candidate = summary.candidates.find(c => c.setupFamily === 'BREAKOUT_RETEST');

    assert(candidate?.status === 'VALIDATED_CANDIDATE', 'Test 5: Complete Breakout + Retest is VALIDATED_CANDIDATE');
    assert(candidate?.evidence.retestHolds === true, 'Test 5: Retest holds is true');
  }

  // -------------------------------------------------------------
  // Test 6: Invalidated setup (price breaks invalidation level)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    // Subsequent candle explodes through Stop Loss (close 2435.0 > SL 2425.50)
    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (3 + i) * hourMs,
      open: i === 0 ? 2410 : 2435,
      high: i === 0 ? 2438 : 2440,
      low: i === 0 ? 2409 : 2430,
      close: i === 0 ? 2435 : 2436,
      volume: 500,
      isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    const candidate = summary.candidates.find(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');

    assert(candidate?.status === 'INVALIDATED', 'Test 6: Price closing above Stop Loss marks setup as INVALIDATED');
    assert(candidate?.validation.isInvalidated === true, 'Test 6: isInvalidated flag is true');
    assert(candidate?.validation.invalidationReason !== null, 'Test 6: Invalidation reason is explicitly recorded');
  }

  // -------------------------------------------------------------
  // Test 7: R:R below threshold fails validation
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 30,
      candles: [] as any,
    }];

    // Force target very close (e.g. opposing liquidity at 2390)
    intel.liquidityLevels = [
      { id: 'CLOSE_TARGET', level: 2390.0, source: 'SESSION_LOW', timestamp: baseTime, datetime: new Date(baseTime).toISOString(), distanceFromCurrentPrice: 10, validationStatus: 'CONFIRMED', isSwept: false },
    ];
    intel.previousPeriodLevels!.pdl = null;

    // Entry = 2404, SL = 2425.50 (Risk = 21.50). Target = 2390 (Reward = 14.00). R:R = 14 / 21.5 = 0.65 < 2.0
    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (4 + i) * hourMs,
      open: 2400,
      high: i === 0 ? 2406 : 2402,
      low: 2398,
      close: 2401,
      volume: 150,
      isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const candidate = summary.candidates.find(c => c.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL');

    assert(candidate?.status !== 'VALIDATED_CANDIDATE', 'Test 7: Setup with R:R < 2.0 cannot validate');
    assert(candidate?.validation.confluence.riskReward === 'FAIL', 'Test 7: R:R confluence is FAIL');
  }

  // -------------------------------------------------------------
  // Test 8: Insufficient data (< 10 candles)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const shortCandles: Candle[] = [
      { timestamp: baseTime, open: 2400, high: 2405, low: 2395, close: 2402, volume: 100, isVerified: true },
      { timestamp: baseTime + hourMs, open: 2402, high: 2410, low: 2400, close: 2408, volume: 120, isVerified: true },
    ];

    const summary = setupScannerEngine.scan(intel, shortCandles);

    assert(summary.status === 'INSUFFICIENT_DATA', 'Test 8: Summary status is INSUFFICIENT_DATA');
    assert(summary.currentSetup?.status === 'NO_SETUP', 'Test 8: Current setup status is NO_SETUP');
    assert(summary.candidates.length === 0, 'Test 8: No candidates output on insufficient data');
  }

  // -------------------------------------------------------------
  // Test 9: Conflicting multi-timeframe structure
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    // Set H1 to BULLISH and M15 to BEARISH => conflicting
    intel.multiTimeframeFacts = [
      { timeframe: 'M15', hasData: true, candleCount: 20, trend: 'BEARISH', structure: 'LH', volatility: 'NORMAL', atr: 12.0, liquidityState: 'Active', latestCandleTimestamp: baseTime },
      { timeframe: 'H1', hasData: true, candleCount: 20, trend: 'BULLISH', structure: 'HH', volatility: 'NORMAL', atr: 15.0, liquidityState: 'Active', latestCandleTimestamp: baseTime },
    ];

    const context = setupScannerEngine.evaluateMultiTimeframeContext(intel);
    assert(context === 'conflicting', 'Test 9: Opposing timeframe trends evaluated as conflicting');

    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: baseTime + i * hourMs, open: 2400, high: 2405, low: 2395, close: 2402, volume: 100, isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    assert(summary.candidates.every(c => c.validation.multiTimeframeContext === 'conflicting'), 'Test 9: Candidates inherit conflicting multi-TF context');
  }

  // =============================================================
  // PHASE 3C AUDIT TESTS
  // =============================================================

  // -------------------------------------------------------------
  // Audit Test 1: Pure No-Setup Behavior (Section 14 TEST 1)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    intel.liquiditySweeps = [];
    intel.structureEvents = [];
    intel.displacements = [];
    intel.fairValueGaps = [];

    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: baseTime + i * hourMs, open: 2400, high: 2405, low: 2395, close: 2402, volume: 100, isVerified: true
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);

    assert(summary.currentScannerState === 'NO_VALIDATED_SETUP', 'Audit 1: Current scanner state is NO_VALIDATED_SETUP');
    assert(summary.status === 'NO_VALIDATED_SETUP', 'Audit 1: Summary status is NO_VALIDATED_SETUP');
    assert(summary.candidates.length === 0, 'Audit 1: Zero candidates emitted when no setup exists');
    assert(summary.paperTradeCreated === false, 'Audit 1: paperTradeCreated is strictly false');
    assert(summary.activeSetupId === null, 'Audit 1: activeSetupId is null');
    assert(summary.snapshot.currentScannerState === 'NO_VALIDATED_SETUP', 'Audit 1: Snapshot state is NO_VALIDATED_SETUP');
  }

  // -------------------------------------------------------------
  // Audit Test 2: Clean Reversal Lifecycle Progression (Section 14 TEST 2)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const sweepTime = baseTime + 10 * hourMs;
    const intel = createBaseIntel();
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [];
    intel.displacements = [];
    intel.fairValueGaps = [];

    const mockCandlesStage1: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + i * hourMs, open: 2415, high: 2418, low: 2412, close: 2416, volume: 100, isVerified: true
    }));

    // Stage 1: Sweep only -> WATCH
    const scan1 = setupScannerEngine.scan(intel, mockCandlesStage1);
    const candidate1 = scan1.candidates[0];
    assert(candidate1.status === 'WATCH', 'Audit 2: Stage 1 status is WATCH');
    assert(candidate1.lifecycleSequence.includes('WATCH'), 'Audit 2: Lifecycle contains WATCH');

    // Stage 2: Structure break + displacement + FVG forms -> SETUP_FORMING
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    const mockCandlesStage2: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (4 + i) * hourMs, open: 2390, high: 2395, low: 2385, close: 2388, volume: 100, isVerified: true
    }));

    const scan2 = setupScannerEngine.scan(intel, mockCandlesStage2);
    const candidate2 = scan2.candidates[0];
    assert(candidate2.status === 'SETUP_FORMING', 'Audit 2: Stage 2 status is SETUP_FORMING');

    // Stage 3: Retest touches and holds with R:R >= 2.0 -> VALIDATED_CANDIDATE
    const mockCandlesStage3: Candle[] = [];
    for (let i = 0; i <= 15; i++) {
      const t = sweepTime + i * hourMs;
      if (i === 4) {
        mockCandlesStage3.push({ timestamp: t, open: 2400, high: 2408, low: 2398, close: 2402, volume: 150, isVerified: true });
      } else {
        mockCandlesStage3.push({ timestamp: t, open: 2400, high: 2403, low: 2396, close: 2399, volume: 100, isVerified: true });
      }
    }

    const scan3 = setupScannerEngine.scan(intel, mockCandlesStage3);
    const candidate3 = scan3.candidates[0];
    assert(candidate3.status === 'VALIDATED_CANDIDATE', 'Audit 2: Stage 3 status is VALIDATED_CANDIDATE');
    assert(candidate3.lifecycleSequence.includes('WATCH') && candidate3.lifecycleSequence.includes('VALIDATED_CANDIDATE'), 'Audit 2: Lifecycle sequence preserves monotonic history');
    assert(candidate3.provenance.fact.length > 0, 'Audit 2: Provenance facts populated');
    assert(candidate3.provenance.calculation.length > 0, 'Audit 2: Provenance calculations populated');
  }

  // -------------------------------------------------------------
  // Audit Test 3: Clean Breakout + Retest Lifecycle (Section 14 TEST 3)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const breakTime = baseTime + 10 * hourMs;
    const intel = createBaseIntel();
    intel.liquiditySweeps = [];
    intel.structureEvents = [{
      type: 'BOS',
      direction: 'BEARISH',
      brokenLevel: 2390.0,
      breakCandleTimestamp: breakTime,
      datetime: new Date(breakTime).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: breakTime,
      datetime: new Date(breakTime).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.marketStructure!.lastSwingHigh = {
      index: 1,
      type: 'SWING_HIGH',
      price: 2400.0,
      timestamp: breakTime - 2 * hourMs,
      datetime: new Date(breakTime - 2 * hourMs).toISOString(),
      isConfirmed: true,
    };

    // Stage 1: No retest yet -> WATCH
    const mockCandlesStage1: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: breakTime + (1 + i) * hourMs, open: 2380, high: 2384, low: 2375, close: 2378, volume: 100, isVerified: true
    }));

    const scan1 = setupScannerEngine.scan(intel, mockCandlesStage1);
    const candidate1 = scan1.candidates.find(c => c.setupFamily === 'BREAKOUT_RETEST');
    assert(candidate1?.status === 'WATCH', 'Audit 3: Breakout awaiting retest is WATCH');

    // Stage 2: Retest touches 2390 and holds -> VALIDATED_CANDIDATE
    const mockCandlesStage2: Candle[] = [];
    for (let i = 1; i <= 15; i++) {
      const t = breakTime + i * hourMs;
      if (i === 2) {
        mockCandlesStage2.push({ timestamp: t, open: 2385, high: 2390.2, low: 2384, close: 2388, volume: 140, isVerified: true });
      } else {
        mockCandlesStage2.push({ timestamp: t, open: 2385, high: 2388, low: 2378, close: 2380, volume: 100, isVerified: true });
      }
    }

    const scan2 = setupScannerEngine.scan(intel, mockCandlesStage2, { minRiskReward: 2.0 });
    const candidate2 = scan2.candidates.find(c => c.setupFamily === 'BREAKOUT_RETEST');
    assert(candidate2?.status === 'VALIDATED_CANDIDATE', 'Audit 3: Breakout with held retest validates as VALIDATED_CANDIDATE');
    assert(candidate2?.evidence.retestHolds === true, 'Audit 3: Retest holds flag is true');
  }

  // -------------------------------------------------------------
  // Audit Test 4: Incomplete Candle Ignored (Section 14 TEST 4)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    // 8 completed candles + 1 incomplete candle (total 9 completed -> less than 10 required)
    const candlesWithIncomplete: (Candle & { isComplete?: boolean })[] = [
      ...Array(8).fill(0).map((_, i) => ({
        timestamp: sweepTime + i * hourMs, open: 2410, high: 2412, low: 2405, close: 2408, volume: 100, isVerified: true, isComplete: true
      })),
      { timestamp: sweepTime + 9 * hourMs, open: 2408, high: 2410, low: 2402, close: 2404, volume: 50, isVerified: true, isComplete: false },
    ];

    const summary = setupScannerEngine.scan(intel, candlesWithIncomplete as Candle[]);
    assert(summary.status === 'INSUFFICIENT_DATA', 'Audit 4: Incomplete candles ignored, returns INSUFFICIENT_DATA');
    assert(summary.currentScannerState === 'INSUFFICIENT VERIFIED DATA', 'Audit 4: Scanner state is INSUFFICIENT VERIFIED DATA');
  }

  // -------------------------------------------------------------
  // Audit Test 5: Retest Failure Rejection (Section 14 TEST 5)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    // Retest fails: candle closes completely through FVG top (close 2416 > 2412)
    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (3 + i) * hourMs,
      open: i === 0 ? 2406 : 2415,
      high: i === 0 ? 2418 : 2420,
      low: i === 0 ? 2405 : 2410,
      close: i === 0 ? 2416 : 2418, // Closes above FVG upper boundary 2412
      volume: 300,
      isVerified: true,
    }));

    const summary = setupScannerEngine.scan(intel, mockCandles);
    const candidate = summary.candidates[0];

    assert(candidate?.status === 'INVALIDATED', 'Audit 5: Retest blowing through FVG boundary marks INVALIDATED');
    assert(candidate?.validation.isInvalidated === true, 'Audit 5: Invalidation flag is true');
  }

  // -------------------------------------------------------------
  // Audit Test 6: Risk-Reward Threshold Enforcement (Section 14 TEST 6)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const intel = createBaseIntel();
    const sweepTime = baseTime + 10 * hourMs;
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 30,
      candles: [] as any,
    }];

    // Opposing target close (R:R ~ 1.0)
    intel.liquidityLevels = [
      { id: 'CLOSE_TARGET', level: 2382.0, source: 'SESSION_LOW', timestamp: baseTime, datetime: new Date(baseTime).toISOString(), distanceFromCurrentPrice: 10, validationStatus: 'CONFIRMED', isSwept: false },
    ];
    intel.previousPeriodLevels!.pdl = null;

    const mockCandles: Candle[] = [];
    for (let i = 0; i <= 15; i++) {
      const t = sweepTime + i * hourMs;
      if (i === 4) {
        mockCandles.push({ timestamp: t, open: 2400, high: 2408, low: 2398, close: 2402, volume: 150, isVerified: true });
      } else {
        mockCandles.push({ timestamp: t, open: 2400, high: 2403, low: 2396, close: 2399, volume: 100, isVerified: true });
      }
    }

    // SL = 2425.50, Entry = 2404 -> Risk = 21.50. Target = 2382 -> Reward = 22.00. R:R = 1.02 < 2.0
    const summaryFail = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const candidateFail = summaryFail.candidates[0];
    assert(candidateFail.status !== 'VALIDATED_CANDIDATE', 'Audit 6: Sub-2.0 R:R cannot validate');
    assert(candidateFail.validation.confluence.riskReward === 'FAIL', 'Audit 6: R:R confluence is FAIL');

    // Widen target to 2350 (Reward = 54, Risk = 21.5 -> R:R = 2.51 >= 2.0)
    intel.liquidityLevels = [
      { id: 'FAR_TARGET', level: 2350.0, source: 'SESSION_LOW', timestamp: baseTime, datetime: new Date(baseTime).toISOString(), distanceFromCurrentPrice: 10, validationStatus: 'CONFIRMED', isSwept: false },
    ];
    setupScannerEngine.clearRegistry();
    const summaryPass = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const candidatePass = summaryPass.candidates[0];
    assert(candidatePass.status === 'VALIDATED_CANDIDATE', 'Audit 6: R:R >= 2.0 cleanly validates setup');
    assert(candidatePass.validation.confluence.riskReward === 'PASS', 'Audit 6: R:R confluence is PASS');
  }

  // -------------------------------------------------------------
  // Audit Test 7: Invalidation Permanence (Section 14 TEST 7)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const sweepTime = baseTime + 10 * hourMs;
    const intel = createBaseIntel();
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 0,
      candles: [] as any,
    }];

    // Scan 1: Price closes beyond Stop Loss -> INVALIDATED
    const invalidatingCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (3 + i) * hourMs,
      open: 2410, high: 2440, low: 2409, close: 2435, volume: 500, isVerified: true
    }));

    const scan1 = setupScannerEngine.scan(intel, invalidatingCandles);
    assert(scan1.candidates[0].status === 'INVALIDATED', 'Audit 7: First scan is INVALIDATED');

    // Scan 2: New candles appear with favorable price action, but setup ID is identical
    const newFavorableCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + (18 + i) * hourMs,
      open: 2400, high: 2405, low: 2395, close: 2398, volume: 100, isVerified: true
    }));

    const scan2 = setupScannerEngine.scan(intel, newFavorableCandles);
    assert(scan2.candidates[0].status === 'INVALIDATED', 'Audit 7: Once INVALIDATED, setup permanently remains INVALIDATED');
  }

  // -------------------------------------------------------------
  // Audit Test 8: Duplicate Prevention Under Continuous Scanning (Section 14 TEST 8)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const sweepTime = baseTime + 10 * hourMs;
    const intel = createBaseIntel();
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];

    const mockCandles: Candle[] = Array(15).fill(0).map((_, i) => ({
      timestamp: sweepTime + i * hourMs, open: 2415, high: 2418, low: 2412, close: 2416, volume: 100, isVerified: true
    }));

    // Perform 5 consecutive scans of the same intelligence
    let lastSummary = setupScannerEngine.scan(intel, mockCandles);
    for (let run = 1; run < 5; run++) {
      lastSummary = setupScannerEngine.scan(intel, mockCandles);
    }

    assert(lastSummary.candidates.length === 1, 'Audit 8: Exactly 1 candidate emitted after 5 continuous scans');
    assert(setupScannerEngine.getRegistry().length === 1, 'Audit 8: Exactly 1 setup registered in setupRegistry');
    assert(lastSummary.candidates[0].setupId === `SWEEP-REV-BEARISH-${sweepTime}`, 'Audit 8: Setup ID is deterministic');
  }

  // -------------------------------------------------------------
  // Audit Test 9: Snapshot Consistency (Section 14 TEST 9)
  // -------------------------------------------------------------
  {
    setupScannerEngine.clearRegistry();
    const sweepTime = baseTime + 10 * hourMs;
    const intel = createBaseIntel();
    intel.liquiditySweeps = [{
      levelSwept: 2420.0,
      source: 'PREVIOUS_DAY_HIGH',
      sweepCandleTimestamp: sweepTime,
      sweepHighOrLow: 2425.0,
      sweepClose: 2418.0,
      confirmationCandleTimestamp: sweepTime + hourMs,
      timestamp: sweepTime,
      datetime: new Date(sweepTime).toISOString(),
      direction: 'BEARISH_SWEEP_OF_HIGHS',
      timeframe: 'M15',
    }];
    intel.structureEvents = [{
      type: 'CHOCH',
      direction: 'BEARISH',
      brokenLevel: 2400.0,
      breakCandleTimestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      timeframe: 'M15',
    }];
    intel.displacements = [{
      timestamp: sweepTime + 2 * hourMs,
      datetime: new Date(sweepTime + 2 * hourMs).toISOString(),
      direction: 'BEARISH',
      candleRange: 20.0,
      bodySize: 16.0,
      bodyToRangeRatio: 0.8,
      atrRatio: 1.6,
      isDisplaced: true,
    }];
    intel.fairValueGaps = [{
      id: 'FVG-1',
      direction: 'BEARISH',
      upperBoundary: 2412.0,
      lowerBoundary: 2404.0,
      gapSize: 8.0,
      formationTimestamp: sweepTime + 3 * hourMs,
      datetime: new Date(sweepTime + 3 * hourMs).toISOString(),
      timeframe: 'M15',
      isFilled: false,
      fillPercentage: 30,
      candles: [] as any,
    }];

    const mockCandles: Candle[] = [];
    for (let i = 0; i <= 15; i++) {
      const t = sweepTime + i * hourMs;
      if (i === 4) {
        mockCandles.push({ timestamp: t, open: 2400, high: 2408, low: 2398, close: 2402, volume: 150, isVerified: true });
      } else {
        mockCandles.push({ timestamp: t, open: 2400, high: 2403, low: 2396, close: 2399, volume: 100, isVerified: true });
      }
    }

    const summary = setupScannerEngine.scan(intel, mockCandles, { minRiskReward: 2.0 });
    const snapshot = summary.snapshot;

    assert(snapshot !== undefined, 'Audit 9: Snapshot exists in summary');
    assert(snapshot.currentScannerState === 'VALIDATED_CANDIDATE', 'Audit 9: Snapshot state is VALIDATED_CANDIDATE');
    assert(snapshot.activeSetupId === summary.currentSetup?.setupId, 'Audit 9: Snapshot activeSetupId matches currentSetup');
    assert(snapshot.entry === summary.currentSetup?.risk.entryReference, 'Audit 9: Snapshot entry matches risk reference');
    assert(snapshot.stopLoss === summary.currentSetup?.risk.stopLossReference, 'Audit 9: Snapshot stopLoss matches risk reference');
    assert(snapshot.target === summary.currentSetup?.risk.targetReference, 'Audit 9: Snapshot target matches risk reference');
    assert(snapshot.riskRewardRatio === summary.currentSetup?.risk.riskRewardRatio, 'Audit 9: Snapshot R:R matches risk calculation');
    assert(snapshot.dataVerified === true, 'Audit 9: Snapshot dataVerified is true');
    assert(snapshot.lastEvidenceTimestamp !== null, 'Audit 9: Snapshot lastEvidenceTimestamp is present');
  }

  console.log(`\nSetup Scanner Engine Test Result: ${passed}/${total} assertions passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runSetupScannerTests();
