import assert from 'node:assert';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { PaperExecutionService } from '../src/services/paper-trading/paper-execution-service';
import { Candle } from '../src/market-data/provider.interface';
import { PaperOrder, PaperPosition } from '../src/types/paper-trading';
import { IReplayStrategy, ReplayCandleContext } from '../src/types/replay';
import { SetupRecord } from '../src/types/scanner';

console.log('================================================================');
console.log('STEP 2: COMMISSION UNIT HARMONIZATION TEST SUITE');
console.log('Testing commission calculation consistency between Replay and Forward');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}: ${err?.message || err}`);
    throw err;
  }
}

const mockCandle: Candle = {
  timestamp: Date.UTC(2026, 8, 1, 10, 0, 0), // 10:00 UTC (London session)
  datetime: '2026-09-01 10:00:00',
  open: 2650.0,
  high: 2655.0,
  low: 2645.0,
  close: 2650.0,
  volume: 100,
  isVerified: true,
};

const riskConfig = {
  commissionDisabled: false,
  commissionPerLot: 3.50,
  spreadDisabled: true,
  spreadMarkupPips: 0,
  slippageDisabled: true,
  slippagePips: 0,
};

// -------------------------------------------------------------------------
// TEST 1: 1.00 lot = $3.50 per side
// -------------------------------------------------------------------------
runTest('1. 1.00 lot = $3.50 per side', () => {
  const lotSize = 1.00;
  const forwardRate = ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide;
  const forwardEntryComm = Number((lotSize * forwardRate).toFixed(2));
  const forwardExitComm = Number((lotSize * forwardRate).toFixed(2));

  assert.strictEqual(forwardRate, 3.50, 'Forward rate must be 3.50 per lot per side');
  assert.strictEqual(forwardEntryComm, 3.50, 'Forward 1.00 lot entry commission must be $3.50');
  assert.strictEqual(forwardExitComm, 3.50, 'Forward 1.00 lot exit commission must be $3.50');

  // PaperExecutionService directly with lotSize
  const friction = PaperExecutionService.calculateFillsWithFriction(
    2650.0,
    'LONG',
    'XAU/USD',
    100, // 100 oz
    riskConfig,
    false,
    lotSize
  );
  assert.strictEqual(friction.commissionFee, 3.50, 'Execution service 1.00 lot must be $3.50');
});

// -------------------------------------------------------------------------
// TEST 2: 0.50 lot = $1.75 per side
// -------------------------------------------------------------------------
runTest('2. 0.50 lot = $1.75 per side', () => {
  const lotSize = 0.50;
  const forwardRate = ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide;
  const forwardEntryComm = Number((lotSize * forwardRate).toFixed(2));
  const forwardExitComm = Number((lotSize * forwardRate).toFixed(2));

  assert.strictEqual(forwardEntryComm, 1.75, 'Forward 0.50 lot entry commission must be $1.75');
  assert.strictEqual(forwardExitComm, 1.75, 'Forward 0.50 lot exit commission must be $1.75');

  const friction = PaperExecutionService.calculateFillsWithFriction(
    2650.0,
    'LONG',
    'XAU/USD',
    50, // 50 oz
    riskConfig,
    false,
    lotSize
  );
  assert.strictEqual(friction.commissionFee, 1.75, 'Execution service 0.50 lot must be $1.75');
});

// -------------------------------------------------------------------------
// TEST 3: 0.01 lot = $0.035, using project's existing rounding convention
// -------------------------------------------------------------------------
runTest('3. 0.01 lot = $0.035, using project existing rounding convention', () => {
  const lotSize = 0.01;
  const forwardRate = ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide;
  
  // Mathematical value is 0.01 * 3.50 = 0.035
  const rawComm = lotSize * forwardRate;
  assert.strictEqual(rawComm, 0.035, 'Mathematical raw commission must be exactly $0.035');

  // Project rounding convention is Number((val).toFixed(2)) -> rounds to cents
  const roundedComm = Number(rawComm.toFixed(2));
  assert.strictEqual(roundedComm, 0.04, 'Project toFixed(2) rounding convention rounds $0.035 to $0.04');

  const forwardEntryComm = Number((lotSize * forwardRate).toFixed(2));
  assert.strictEqual(forwardEntryComm, 0.04, 'Forward 0.01 lot entry commission must be $0.04');

  const friction = PaperExecutionService.calculateFillsWithFriction(
    2650.0,
    'LONG',
    'XAU/USD',
    1, // 1 oz
    riskConfig,
    false,
    lotSize
  );
  assert.strictEqual(friction.commissionFee, 0.04, 'Execution service 0.01 lot commission must be $0.04');
});

// -------------------------------------------------------------------------
// TEST 4: Replay commission matches Forward commission for the same lot size
// -------------------------------------------------------------------------
runTest('4. Replay commission matches Forward commission for the same lot size', () => {
  const testLotSizes = [1.00, 0.50, 0.25, 0.10, 0.05, 0.01];

  for (const lots of testLotSizes) {
    const forwardRate = ForwardPaperEngine.FROZEN_PARAMS.commissionPerLotPerSide;
    const fwdEntry = Number((lots * forwardRate).toFixed(2));
    const fwdExit = Number((lots * forwardRate).toFixed(2));
    const fwdTotal = Number((fwdEntry + fwdExit).toFixed(2));

    const replayEntryFriction = PaperExecutionService.calculateFillsWithFriction(
      2650.0,
      'LONG',
      'XAU/USD',
      lots * 100,
      riskConfig,
      false,
      lots
    );
    const replayExitFriction = PaperExecutionService.calculateFillsWithFriction(
      2660.0,
      'SHORT',
      'XAU/USD',
      lots * 100,
      riskConfig,
      false,
      lots
    );
    const replayTotal = Number((replayEntryFriction.commissionFee + replayExitFriction.commissionFee).toFixed(2));

    assert.strictEqual(
      replayEntryFriction.commissionFee,
      fwdEntry,
      `Entry commission for ${lots} lot must match between Replay (${replayEntryFriction.commissionFee}) and Forward (${fwdEntry})`
    );
    assert.strictEqual(
      replayExitFriction.commissionFee,
      fwdExit,
      `Exit commission for ${lots} lot must match between Replay (${replayExitFriction.commissionFee}) and Forward (${fwdExit})`
    );
    assert.strictEqual(
      replayTotal,
      fwdTotal,
      `Total execution commission for ${lots} lot must match between Replay (${replayTotal}) and Forward (${fwdTotal})`
    );
  }
});

// -------------------------------------------------------------------------
// TEST 5: No conversion accidentally treats ounces as lots
// -------------------------------------------------------------------------
runTest('5. No conversion accidentally treats ounces as lots', () => {
  // If 100 ounces (1.00 lot) were accidentally treated as 100 lots:
  // Commission would be 100 * $3.50 = $350.00 (100x error).
  // If 1.00 lot were accidentally treated as 1.00 ounce:
  // Commission would be 1.00 / 100 * $3.50 = $0.035 (100x undercharge).
  
  const mockOrder: PaperOrder = {
    paperOrderId: 'ORD-TEST-COMMISSION',
    setupId: 'SETUP-COMMISSION-1',
    symbol: 'XAU/USD',
    timeframe: '15m',
    direction: 'LONG',
    setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
    executionMode: 'MARKET',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    filledAt: null,
    closedAt: null,
    plannedEntryPrice: 2650.0,
    executedEntryPrice: null,
    stopLoss: 2640.0,
    takeProfit: 2670.0,
    positionSize: 100, // 100 ounces
    lotSize: 1.0,     // 1.00 lot
    positionSizeDisplay: '1.00 lots (100 oz)',
    initialRisk: 1000,
    riskAmount: 1000,
    riskPercent: 1.0,
    plannedReward: 2000,
    plannedRR: 2.0,
    currentPrice: null,
    unrealizedPnL: 0,
    realizedPnL: null,
    rMultiple: null,
    closeReason: null,
    rejectionReason: null,
    rejectionDetails: null,
    marketDataTimestamp: null,
    marketDataSource: 'Twelve Data API',
    setupSnapshot: {} as any,
    evidenceSnapshot: {},
  };

  const fill = PaperExecutionService.executeWithCandle(mockOrder, mockCandle, riskConfig);
  assert.strictEqual(fill.filled, true);
  assert.strictEqual(fill.commissionFee, 3.50, '1.00 lot (100 oz) must be charged exactly $3.50, neither $350 nor $0.035');
  assert.strictEqual(fill.newPosition?.lotSize, 1.0, 'newPosition must preserve lotSize = 1.0');
  assert.strictEqual(fill.newPosition?.accumulatedFees, 3.50, 'accumulatedFees must record entry fee = $3.50');
});

// -------------------------------------------------------------------------
// TEST 6: Replay full lifecycle verifies Entry & Exit commissions and no double-counting
// -------------------------------------------------------------------------
runTest('6. Replay full lifecycle verifies Entry & Exit commissions and no double-counting', () => {
  const candles: Candle[] = [
    {
      timestamp: Date.UTC(2026, 8, 1, 10, 0, 0),
      datetime: '2026-09-01 10:00:00',
      open: 2650,
      high: 2652,
      low: 2648,
      close: 2650,
      volume: 100,
      isVerified: true,
    },
    {
      timestamp: Date.UTC(2026, 8, 1, 10, 15, 0),
      datetime: '2026-09-01 10:15:00',
      open: 2650,
      high: 2675, // Hits TP at 2670
      low: 2649,
      close: 2672,
      volume: 120,
      isVerified: true,
    },
  ];

  const engine = new HistoricalReplayEngine({
    initialBalance: 100_000,
    riskConfig: {
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: true,
      spreadMarkupPips: 0,
      slippageDisabled: true,
      slippagePips: 0,
    },
  });

  const testStrategy: IReplayStrategy = {
    id: 'TEST-COMM',
    name: 'Commission Test Strategy',
    evaluate: (ctx: ReplayCandleContext): SetupRecord[] => {
      if (ctx.currentIndex === 0) {
        return [
          {
            setupId: 'SETUP-COMM-0',
            symbol: 'XAU/USD',
            timeframe: '15m',
            direction: 'BULLISH',
            setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
            status: 'VALIDATED_CANDIDATE',
            statusReason: 'VALIDATED',
            evidence: {
              liquidityLevel: 2645,
              liquiditySource: 'SESSION_LOW',
              sweepDetected: true,
              sweepTimestamp: ctx.timestamp,
              sweepDatetime: new Date(ctx.timestamp).toISOString(),
              sweepHighOrLow: 2645,
              structureEvent: 'CHOCH',
              structureTimestamp: ctx.timestamp,
              structureDatetime: new Date(ctx.timestamp).toISOString(),
              brokenLevel: 2652,
              displacementDetected: true,
              displacementTimestamp: ctx.timestamp,
              displacementDatetime: new Date(ctx.timestamp).toISOString(),
              displacementBodyRatio: 0.75,
              fvgDetected: true,
              fvgUpper: 2652,
              fvgLower: 2649,
              fvgTimestamp: ctx.timestamp,
              fvgDatetime: new Date(ctx.timestamp).toISOString(),
              retestDetected: true,
              retestTimestamp: ctx.timestamp,
              retestDatetime: new Date(ctx.timestamp).toISOString(),
              retestPrice: 2650,
              retestHolds: true,
            },
            risk: {
              entryReference: 2650,
              entryType: 'CALCULATED',
              entryMethod: 'LIMIT_RETEST',
              stopLossReference: 2640, // $10 stop -> for $1000 risk = 100 oz = 1.00 lot
              stopLossType: 'CALCULATED',
              stopLossMethod: 'SWING_LOW',
              targetReference: 2670,
              targetType: 'CALCULATED',
              targetSource: 'LIQUIDITY_POOL',
              riskDistance: 10,
              rewardDistance: 20,
              riskRewardRatio: 2.0,
              minimumRequiredRR: 2.0,
            },
            validation: {
              dataVerified: true,
              marketRegime: 'TRENDING_BULLISH',
              volatilityState: 'NORMAL',
              multiTimeframeContext: 'aligned',
              conditionsPassed: ['all'],
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
              invalidationCondition: 'Price breaks 2640',
              isInvalidated: false,
            },
            provenance: {
              fact: ['Twelve Data verified M15 bar'],
              calculation: ['RR = 2.0'],
              modelOutput: ['TEST'],
            },
            originatingCandleTimestamp: ctx.timestamp,
            originatingEventKey: `P7B-RETEST-${ctx.timestamp}`,
            createdAt: new Date(ctx.timestamp).toISOString(),
            lastUpdated: new Date(ctx.timestamp).toISOString(),
            lifecycleSequence: ['SETUP_FORMING', 'VALIDATED_CANDIDATE'],
          },
        ];
      }
      return [];
    },
  };

  engine.loadDataset(candles);
  engine.setStrategy(testStrategy);

  // Step 0: Candle 0 -> Setup evaluated -> Order submitted and filled (Entry)
  engine.stepForward();

  const openPositions = engine.getOpenPositions();
  assert.strictEqual(openPositions.length, 1, 'Position should be open after Step 0');
  const pos = openPositions[0];
  assert.strictEqual(pos.lotSize, 1.0, 'Position lotSize must be 1.0 lot');
  assert.strictEqual(pos.positionSize, 100, 'Position positionSize must be 100 oz');
  assert.strictEqual(pos.accumulatedFees, 3.50, 'Entry commission must be exactly $3.50 (1.0 lot * $3.50)');

  const openJournal = engine.getJournal().find((j) => j.eventType === 'POSITION_OPENED');
  assert.strictEqual(openJournal?.commission, 3.50, 'POSITION_OPENED event commission must be $3.50');

  // Step 1: Candle 1 -> Hits TP -> Position closed (Exit)
  engine.stepForward();

  const closedTrades = engine.getClosedTrades();
  assert.strictEqual(closedTrades.length, 1, 'Should have 1 closed trade');
  const trade = closedTrades[0];

  assert.strictEqual(trade.closeReason, 'TAKE_PROFIT', 'Trade should close at TAKE_PROFIT');
  assert.strictEqual(trade.totalFees, 7.00, 'Total fees must be $7.00 ($3.50 entry + $3.50 exit)');

  const closeJournal = engine.getJournal().find((j) => j.eventType === 'POSITION_CLOSED');
  assert.strictEqual(closeJournal?.commission, 7.00, 'POSITION_CLOSED event commission must record total fees ($7.00)');
  assert.strictEqual(closeJournal?.details?.entryCommission, 3.50, 'Details entry commission must be $3.50');
  assert.strictEqual(closeJournal?.details?.exitCommission, 3.50, 'Details exit commission must be $3.50');
});

// -------------------------------------------------------------------------
// TEST 7: Existing friction tests remain valid
// -------------------------------------------------------------------------
runTest('7. Existing friction tests remain valid', () => {
  const p = ForwardPaperEngine.FROZEN_PARAMS;
  assert.strictEqual(p.contractOuncesPerLot, 100);
  assert.strictEqual(p.commissionPerLotPerSide, 3.50);
  assert.strictEqual(p.spreadMarkupPips, 1.0);
  assert.strictEqual(p.slippagePips, 0.5);

  const equity = 100_000;
  const riskAmount = (equity * p.riskPerTradePercent) / 100;
  const distance = 2.0;
  const ounces = riskAmount / distance; // 500 oz
  const lots = ounces / p.contractOuncesPerLot; // 5.0 lots
  assert.strictEqual(lots, 5.0);

  const roundTripComm = Number((lots * (p.commissionPerLotPerSide * 2)).toFixed(2));
  assert.strictEqual(roundTripComm, 35.0);

  const friction = PaperExecutionService.calculateFillsWithFriction(
    2500.0,
    'LONG',
    'XAU/USD',
    ounces,
    {
      commissionDisabled: false,
      commissionPerLot: p.commissionPerLotPerSide,
      spreadDisabled: false,
      spreadMarkupPips: p.spreadMarkupPips,
      slippageDisabled: false,
      slippagePips: p.slippagePips,
    },
    false,
    lots
  );

  assert.strictEqual(friction.commissionFee, 17.50, 'Entry commission for 5.0 lots must be $17.50');
  assert.strictEqual(friction.spreadPips, 1.0);
  assert.strictEqual(friction.slippagePips, 0.5);
});

console.log('\n================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('================================================================\n');
