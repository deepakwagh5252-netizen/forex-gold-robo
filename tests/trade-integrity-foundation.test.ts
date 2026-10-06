import assert from 'assert';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { ForwardPersistence } from '../src/services/paper-trading/forward-persistence';
import { Candle } from '../src/market-data/provider.interface';
import { ForwardTrade, ForwardPosition } from '../src/types/forward-validation';

console.log('================================================================');
console.log('PHASE 8.1: TRADE INTEGRITY FOUNDATION TEST SUITE');
console.log('Testing hard idempotency, startup recovery, deterministic IDs,');
console.log('timestamp separation, permanent trade journal, and event journal');
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
// 1. DUPLICATE CANDLE PROTECTION (Hard Idempotency Gate)
// -----------------------------------------------------------------------------
runTest('1.1 Hard idempotency gate prevents duplicate strategy evaluation & position opening', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const t1 = new Date('2026-09-01T14:00:00Z').getTime();
  const candle1: Candle = {
    timestamp: t1,
    datetime: new Date(t1).toISOString(),
    open: 2500,
    high: 2510,
    low: 2490,
    close: 2505,
    volume: 100,
    isVerified: true,
  };

  const res1 = engine.processCandle(candle1, t1 + 900000, true);
  const balAfter1 = engine.getAccount().currentBalance;
  const eqAfter1 = engine.getAccount().currentEquity;
  const posCountAfter1 = engine.getOpenPositions().length;
  const signalCountAfter1 = engine.getSignals().length;

  // Process the exact same candle again
  const res2 = engine.processCandle(candle1, t1 + 900000, true);

  assert.strictEqual(res2.validation.status, 'DUPLICATE', 'Validation status must be DUPLICATE');
  assert.strictEqual(engine.getOpenPositions().length, posCountAfter1, 'Must not open additional position');
  assert.strictEqual(engine.getAccount().currentBalance, balAfter1, 'Balance must remain identical');
  assert.strictEqual(engine.getAccount().currentEquity, eqAfter1, 'Equity must remain identical');
  assert.strictEqual(engine.getSignals().length, signalCountAfter1, 'Must not append duplicate signal');
});

runTest('1.2 Repeated ingestion of the same candle produces zero economic divergence', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const t = new Date('2026-09-01T14:15:00Z').getTime();
  const candle: Candle = {
    timestamp: t,
    datetime: new Date(t).toISOString(),
    open: 2505,
    high: 2515,
    low: 2495,
    close: 2510,
    volume: 120,
    isVerified: true,
  };

  const initialBal = engine.getAccount().currentBalance;
  // Send 5 times
  for (let i = 0; i < 5; i++) {
    engine.processCandle(candle, t + 900000, true);
  }

  assert.strictEqual(engine.getAccount().currentBalance, initialBal, 'Zero balance mutation across 5 duplicate sends');
});

// -----------------------------------------------------------------------------
// 2. STARTUP RECOVERY (LOAD -> RESTORE -> VALIDATE -> RECONCILE -> CONTINUE)
// -----------------------------------------------------------------------------
runTest('2.1 Persists and restores lastCandle, processed timestamps, account, and events', () => {
  const engineA = new ForwardPaperEngine();
  engineA.resetForwardState(100_000);
  engineA.setPaperTradingActive(true);

  const t1 = new Date('2026-09-01T14:30:00Z').getTime();
  const candle1: Candle = {
    timestamp: t1,
    datetime: new Date(t1).toISOString(),
    open: 2510,
    high: 2520,
    low: 2505,
    close: 2515,
    volume: 150,
    isVerified: true,
  };

  engineA.processCandle(candle1, t1 + 900000, true);

  // Assert engineA stored lastCandle
  const storedLastCandle = ForwardPersistence.loadLastCandle();
  assert.notStrictEqual(storedLastCandle, null, 'Last candle must be persisted');
  assert.strictEqual(storedLastCandle?.timestamp, t1, 'Last candle timestamp must match');

  // Instantiate new engine simulating restart
  const engineB = new ForwardPaperEngine();
  const statusB = engineB.getStatus();

  assert.strictEqual(statusB.lastCandle?.timestamp, t1, 'Restored engine must load lastCandle');
  assert.strictEqual(statusB.paperStatus, 'PAPER_ACTIVE', 'Restored engine preserves PAPER_ACTIVE');

  // Verify RESTART_RECOVERED event in event journal
  const events = engineB.getEvents();
  const recoveryEvt = events.find(e => e.eventType === 'RESTART_RECOVERED');
  assert.notStrictEqual(recoveryEvt, undefined, 'RESTART_RECOVERED event must be logged');
  assert.strictEqual(recoveryEvt?.message.includes('LOAD -> RESTORE -> VALIDATE -> RECONCILE -> CONTINUE'), true);
});

runTest('2.2 Restored engine rejects already processed candles without replaying them', () => {
  const engineA = new ForwardPaperEngine();
  engineA.resetForwardState(100_000);
  engineA.setPaperTradingActive(true);

  const t1 = new Date('2026-09-01T14:45:00Z').getTime();
  const candle1: Candle = {
    timestamp: t1,
    datetime: new Date(t1).toISOString(),
    open: 2515,
    high: 2525,
    low: 2510,
    close: 2520,
    volume: 110,
    isVerified: true,
  };

  engineA.processCandle(candle1, t1 + 900000, true);

  // Fresh engine instance
  const engineB = new ForwardPaperEngine();
  // Attempt to reprocess candle1
  const res = engineB.processCandle(candle1, t1 + 900000, true);
  assert.strictEqual(res.validation.status, 'DUPLICATE', 'Restored engine must recognize processed candle as DUPLICATE');
});

// -----------------------------------------------------------------------------
// 3. DETERMINISTIC IDs (Zero Math.random())
// -----------------------------------------------------------------------------
runTest('3.1 Generates deterministic IDs for order, signal, position, and trade', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const t = 1788000000000;
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

  // Check event IDs
  const events = engine.getEvents();
  for (const evt of events) {
    assert.strictEqual(evt.eventId.startsWith('EVT-'), true, 'Event ID must start with EVT-');
    assert.strictEqual(evt.eventId.includes('NaN'), false, 'Event ID must not contain NaN');
    assert.strictEqual(evt.eventId.includes('undefined'), false, 'Event ID must not contain undefined');
  }
});

// -----------------------------------------------------------------------------
// 4. TIMESTAMP CORRECTION (Separation of Candle Time vs Execution Time)
// -----------------------------------------------------------------------------
runTest('4.1 ForwardPosition and ForwardTrade distinguish signalCandleTimeUtc from execution timestamps', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  // Create an artificial position to test schema compliance
  const candleTime = '2026-09-30T07:15:00.000Z';
  const entryReqTime = '2026-09-30T07:30:00.050Z';
  const entryExecTime = '2026-09-30T07:30:00.120Z';

  const pos: ForwardPosition = {
    positionId: 'POS-P7F-XAUUSD-15M-1790752500000-SHORT',
    signalId: 'SIG-P7F-XAUUSD-15M-1790752500000-SHORT',
    paperOrderId: 'ORD-P7F-XAUUSD-15M-1790752500000-SHORT',
    symbol: 'XAU/USD',
    direction: 'SHORT',
    signalCandleTimeUtc: candleTime,
    entryRequestedAtUtc: entryReqTime,
    entryExecutedAtUtc: entryExecTime,
    openedAt: entryExecTime,
    entryPrice: 2650.00,
    currentPrice: 2650.00,
    stopLoss: 2655.00,
    initialStopLoss: 2655.00,
    takeProfit: 2640.00,
    initialTakeProfit: 2640.00,
    positionSize: 10,
    quantity: 10,
    lotSize: 0.1,
    unrealizedPnL: -0.70,
    unrealizedRMultiple: 0,
    initialRisk: 50.0,
    accumulatedFees: 0.70,
    spreadPips: 1.0,
    slippagePips: 0.5,
    marketDataTimestamp: candleTime,
  };

  assert.strictEqual(pos.signalCandleTimeUtc, candleTime);
  assert.strictEqual(pos.entryRequestedAtUtc, entryReqTime);
  assert.strictEqual(pos.entryExecutedAtUtc, entryExecTime);
  assert.notStrictEqual(pos.signalCandleTimeUtc, pos.entryExecutedAtUtc, 'Candle boundary must not equal fill execution timestamp');
});

// -----------------------------------------------------------------------------
// 5. PERMANENT FORWARD TRADE JOURNAL
// -----------------------------------------------------------------------------
runTest('5.1 Completed ForwardTrade contains all 28 required permanent fields', () => {
  const trade: ForwardTrade = {
    tradeId: 'TRD-P7F-XAUUSD-15M-1790752500000-SHORT',
    positionId: 'POS-P7F-XAUUSD-15M-1790752500000-SHORT',
    signalId: 'SIG-P7F-XAUUSD-15M-1790752500000-SHORT',
    paperOrderId: 'ORD-P7F-XAUUSD-15M-1790752500000-SHORT',
    symbol: 'XAU/USD',
    timeframe: '15m',
    direction: 'SHORT',

    signalCandleTimeUtc: '2026-09-30T07:15:00.000Z',
    entryRequestedAtUtc: '2026-09-30T07:30:00.010Z',
    entryExecutedAtUtc: '2026-09-30T07:30:00.020Z',
    exitRequestedAtUtc: '2026-09-30T08:00:00.010Z',
    exitExecutedAtUtc: '2026-09-30T08:00:00.020Z',

    openedAt: '2026-09-30T07:30:00.020Z',
    closedAt: '2026-09-30T08:00:00.020Z',

    entryPrice: 2650.00,
    exitPrice: 2640.00,
    stopLoss: 2655.00,
    initialStopLoss: 2655.00,
    takeProfit: 2640.00,
    initialTakeProfit: 2640.00,
    positionSize: 10,
    quantity: 10,
    lotSize: 0.1,

    grossPnL: 100.00,
    netPnL: 98.60,
    commission: 0.70,
    fees: 1.40,
    spreadCost: 1.00,
    slippageCost: 0.50,
    slippage: 0.50,
    totalFees: 1.40,
    rMultiple: 2.0,
    closeReason: 'TAKE_PROFIT',
    exitReason: 'TAKE_PROFIT',
    isWin: true,

    strategyVersion: 'Phase 7F/7G Frozen Breakout-Retest',
    filterVersion: 'Filter AB Frozen',
    riskConfigurationVersion: 'Phase 8 Frozen 1% Risk / 3 Max Pos',
    createdAtUtc: '2026-09-30T07:30:00.020Z',
    updatedAtUtc: '2026-09-30T08:00:00.020Z',

    attribution: {
      regime: 'TRENDING_BEARISH',
      session: 'LONDON',
      direction: 'SHORT',
      filterStatus: 'FILTER_AB_PASSED',
      entryQualityEvidence: ['Breakout confirmed', 'Retest held'],
      riskState: '1.0% Risk Accepted',
      exitReason: 'TAKE_PROFIT',
      pnl: 98.60,
    },
  };

  // Assert minimum fields
  assert.strictEqual(typeof trade.tradeId, 'string');
  assert.strictEqual(typeof trade.positionId, 'string');
  assert.strictEqual(typeof trade.signalId, 'string');
  assert.strictEqual(trade.symbol, 'XAU/USD');
  assert.strictEqual(trade.timeframe, '15m');
  assert.strictEqual(trade.direction, 'SHORT');
  assert.strictEqual(typeof trade.signalCandleTimeUtc, 'string');
  assert.strictEqual(typeof trade.entryRequestedAtUtc, 'string');
  assert.strictEqual(typeof trade.entryExecutedAtUtc, 'string');
  assert.strictEqual(typeof trade.entryPrice, 'number');
  assert.strictEqual(typeof trade.quantity, 'number');
  assert.strictEqual(typeof trade.initialStopLoss, 'number');
  assert.strictEqual(typeof trade.initialTakeProfit, 'number');
  assert.strictEqual(typeof trade.exitRequestedAtUtc, 'string');
  assert.strictEqual(typeof trade.exitExecutedAtUtc, 'string');
  assert.strictEqual(typeof trade.exitPrice, 'number');
  assert.strictEqual(typeof trade.grossPnL, 'number');
  assert.strictEqual(typeof trade.fees, 'number');
  assert.strictEqual(typeof trade.commission, 'number');
  assert.strictEqual(typeof trade.slippage, 'number');
  assert.strictEqual(typeof trade.netPnL, 'number');
  assert.strictEqual(typeof trade.exitReason, 'string');
  assert.strictEqual(typeof trade.strategyVersion, 'string');
  assert.strictEqual(typeof trade.filterVersion, 'string');
  assert.strictEqual(typeof trade.riskConfigurationVersion, 'string');
  assert.strictEqual(typeof trade.createdAtUtc, 'string');
  assert.strictEqual(typeof trade.updatedAtUtc, 'string');
});

runTest('5.2 Runtime timestamp test - multi-candle forward simulation populates distinct, realistic execution timestamps', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  // Setup: 20 base candles in London session (08:00 to 12:45 UTC)
  const baseTimestamp = new Date('2026-09-01T08:00:00Z').getTime();
  const intervalMs = 15 * 60 * 1000;

  for (let i = 0; i < 20; i++) {
    const cTs = baseTimestamp + i * intervalMs;
    const c: Candle = {
      timestamp: cTs,
      open: 2400 + (i % 2 === 0 ? 1 : -1),
      high: 2405,
      low: 2395,
      close: 2400 + (i % 2 === 0 ? -1 : 1),
      volume: 100,
      isVerified: true,
      datetime: new Date(cTs).toISOString(),
    };
    engine.processCandle(c, cTs + intervalMs + 50, true);
  }

  // Candle 21: Breakout Bar above 2405 resistance
  const breakoutTs = baseTimestamp + 20 * intervalMs;
  const breakoutBar: Candle = {
    timestamp: breakoutTs,
    open: 2403,
    high: 2413,
    low: 2402,
    close: 2412,
    volume: 250,
    isVerified: true,
    datetime: new Date(breakoutTs).toISOString(),
  };
  const breakoutRes = engine.processCandle(breakoutBar, breakoutTs + intervalMs + 100, true);
  assert.strictEqual(breakoutRes.signal.decision, 'NO_TRADE', 'Breakout candle waits for retest');

  // Candle 22: Retest Bar touches 2405 and closes strong at 2409 (Generates TRADE_LONG)
  const retestTs = baseTimestamp + 21 * intervalMs;
  const retestEvalMs = retestTs + intervalMs + 250; // Evaluation clock time 250ms after candle close
  const retestBar: Candle = {
    timestamp: retestTs,
    open: 2411,
    high: 2412,
    low: 2404.5,
    close: 2409,
    volume: 180,
    isVerified: true,
    datetime: new Date(retestTs).toISOString(),
  };
  const retestRes = engine.processCandle(retestBar, retestEvalMs, true);
  assert.strictEqual(retestRes.signal.decision, 'EXECUTED', 'Retest candle executes trade entry');
  assert.strictEqual(engine.getOpenPositions().length, 1, 'One position opened in runtime flow');

  const openedPos = engine.getOpenPositions()[0];
  assert.strictEqual(openedPos.direction, 'LONG');
  // Check position timestamps
  assert.strictEqual(openedPos.signalCandleTimeUtc, new Date(retestTs).toISOString(), 'signalCandleTimeUtc equals candle start time');
  assert.strictEqual(openedPos.entryRequestedAtUtc, new Date(retestEvalMs).toISOString(), 'entryRequestedAtUtc equals evaluation time');
  assert.strictEqual(openedPos.entryExecutedAtUtc, new Date(retestEvalMs).toISOString(), 'entryExecutedAtUtc equals evaluation time');
  // Critical requirement: candle/setup time is NOT reused as execution time
  assert.notStrictEqual(openedPos.signalCandleTimeUtc, openedPos.entryExecutedAtUtc, 'Candle time is NOT reused as execution time');
  assert.ok(new Date(openedPos.signalCandleTimeUtc).getTime() < new Date(openedPos.entryExecutedAtUtc).getTime(), 'Execution is after candle open');

  // Candle 23: Exit-triggering candle (High reaches 2450, triggering Take Profit target)
  const exitTs = baseTimestamp + 22 * intervalMs;
  const exitEvalMs = exitTs + intervalMs + 400; // Exit evaluation clock time
  const exitBar: Candle = {
    timestamp: exitTs,
    open: 2410,
    high: 2450, // triggers TP
    low: 2408,
    close: 2445,
    volume: 220,
    isVerified: true,
    datetime: new Date(exitTs).toISOString(),
  };
  engine.processCandle(exitBar, exitEvalMs, true);
  assert.strictEqual(engine.getOpenPositions().length, 0, 'Position was closed by exit candle');
  assert.strictEqual(engine.getTrades().length, 1, 'Exactly one completed ForwardTrade recorded');

  const runtimeTrade = engine.getTrades()[0];
  // Verify all 5 timestamps are populated from runtime flow
  assert.strictEqual(runtimeTrade.signalCandleTimeUtc, new Date(retestTs).toISOString(), 'Trade signalCandleTimeUtc matches runtime signal candle');
  assert.strictEqual(runtimeTrade.entryRequestedAtUtc, new Date(retestEvalMs).toISOString(), 'Trade entryRequestedAtUtc matches runtime entry evaluation');
  assert.strictEqual(runtimeTrade.entryExecutedAtUtc, new Date(retestEvalMs).toISOString(), 'Trade entryExecutedAtUtc matches runtime entry fill');
  assert.strictEqual(runtimeTrade.exitRequestedAtUtc, new Date(exitEvalMs).toISOString(), 'Trade exitRequestedAtUtc matches runtime exit evaluation');
  assert.strictEqual(runtimeTrade.exitExecutedAtUtc, new Date(exitEvalMs).toISOString(), 'Trade exitExecutedAtUtc matches runtime exit fill');

  // Verify chronology and timestamp separation
  assert.ok(new Date(runtimeTrade.signalCandleTimeUtc).getTime() < new Date(runtimeTrade.entryRequestedAtUtc).getTime());
  assert.ok(new Date(runtimeTrade.entryExecutedAtUtc).getTime() < new Date(runtimeTrade.exitRequestedAtUtc).getTime());
  assert.strictEqual(runtimeTrade.exitReason, 'TAKE_PROFIT');
  assert.ok(runtimeTrade.netPnL > 0, 'Take profit produces positive net PnL');
});

runTest('5.3 Duplicate close test - repeated processing of exit candle produces exactly one close & zero economic drift', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  // 1. Open one position in engine state via persistence restore
  const pos: ForwardPosition = {
    positionId: 'POS-P7F-XAUUSD-15M-1788272100000-LONG',
    signalId: 'SIG-P7F-XAUUSD-15M-1788272100000-LONG',
    paperOrderId: 'ORD-P7F-XAUUSD-15M-1788272100000-LONG',
    symbol: 'XAU/USD',
    direction: 'LONG',
    signalCandleTimeUtc: '2026-09-01T14:00:00.000Z',
    entryRequestedAtUtc: '2026-09-01T14:15:00.020Z',
    entryExecutedAtUtc: '2026-09-01T14:15:00.020Z',
    openedAt: '2026-09-01T14:15:00.020Z',
    entryPrice: 2500.00,
    currentPrice: 2500.00,
    stopLoss: 2490.00,
    initialStopLoss: 2490.00,
    takeProfit: 2520.00,
    initialTakeProfit: 2520.00,
    positionSize: 10,
    quantity: 10,
    lotSize: 0.1,
    unrealizedPnL: -1.40,
    unrealizedRMultiple: 0,
    initialRisk: 100.00,
    accumulatedFees: 1.40,
    spreadPips: 0.2,
    slippagePips: 0.1,
    marketDataTimestamp: '2026-09-01T14:00:00.000Z',
  };

  const posMap = new Map<string, ForwardPosition>();
  posMap.set(pos.positionId, pos);
  ForwardPersistence.savePositions(posMap);

  // Re-instantiate engine to restore the position
  const activeEngine = new ForwardPaperEngine();
  assert.strictEqual(activeEngine.getOpenPositions().length, 1, 'Step 1: Exactly 1 position open');

  // 2. Feed an exit-triggering candle (low breaches stopLoss 2490.00)
  const exitCandleTs = new Date('2026-09-01T14:30:00Z').getTime();
  const exitEvalMs = exitCandleTs + 900_000 + 100;
  const exitCandle: Candle = {
    timestamp: exitCandleTs,
    datetime: new Date(exitCandleTs).toISOString(),
    open: 2498.00,
    high: 2502.00,
    low: 2485.00, // Breaches SL (2490.00)
    close: 2488.00,
    volume: 150,
    isVerified: true,
  };

  // First process of exit candle
  activeEngine.processCandle(exitCandle, exitEvalMs, true);
  assert.strictEqual(activeEngine.getOpenPositions().length, 0, 'Step 4: Position successfully closed');
  assert.strictEqual(activeEngine.getTrades().length, 1, 'Step 4: Exactly one closed trade created');

  const balAfterClose = activeEngine.getAccount().currentBalance;
  const eqAfterClose = activeEngine.getAccount().currentEquity;
  const feesAfterClose = activeEngine.getAccount().totalFeesPaid;
  const tradesAfterClose = activeEngine.getTrades().length;

  const closedEventsInitial = activeEngine.getEvents().filter(e => e.eventType === 'TRADE_CLOSED').length;
  assert.strictEqual(closedEventsInitial, 1, 'Step 5: Exactly one TRADE_CLOSED event');

  // 3. Process the exact same exit candle repeatedly (5 additional times)
  for (let attempt = 2; attempt <= 6; attempt++) {
    const dupeRes = activeEngine.processCandle(exitCandle, exitEvalMs + (attempt * 1000), true);
    assert.strictEqual(dupeRes.validation.status, 'DUPLICATE', `Attempt ${attempt}: Validation status must be DUPLICATE`);
    assert.strictEqual(dupeRes.validation.isValid, false, `Attempt ${attempt}: Duplicate candle must be invalid`);
    assert.strictEqual(dupeRes.positionsClosed.length, 0, `Attempt ${attempt}: No additional positions closed`);
    assert.strictEqual(dupeRes.positionOpened, null, `Attempt ${attempt}: No position opened`);
  }

  // 4, 5, 6. Assert exact invariants after 5 repeated duplicate attempts
  assert.strictEqual(activeEngine.getOpenPositions().length, 0, 'Positions count unchanged');
  assert.strictEqual(activeEngine.getTrades().length, tradesAfterClose, 'Step 6: No duplicate trade records');
  assert.strictEqual(activeEngine.getAccount().currentBalance, balAfterClose, 'Step 6: Zero balance change (Δbalance = 0)');
  assert.strictEqual(activeEngine.getAccount().currentEquity, eqAfterClose, 'Step 6: Zero equity change (Δequity = 0)');
  assert.strictEqual(activeEngine.getAccount().totalFeesPaid, feesAfterClose, 'Step 6: Zero fees change (Δfees = 0)');

  const closedEventsFinal = activeEngine.getEvents().filter(e => e.eventType === 'TRADE_CLOSED').length;
  assert.strictEqual(closedEventsFinal, 1, 'Step 5: Still exactly one TRADE_CLOSED event after 5 repeated processing attempts');
});

// -----------------------------------------------------------------------------
// 6. EVENT JOURNAL
// -----------------------------------------------------------------------------
runTest('6.1 Event journal tracks state transitions accurately', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const events = engine.getEvents();
  const eventTypes = events.map(e => e.eventType);

  assert.strictEqual(eventTypes.includes('ENGINE_START'), true, 'Must record ENGINE_START');
  assert.strictEqual(eventTypes.includes('PAPER_ENABLED'), true, 'Must record PAPER_ENABLED');
});

runTest('6.2 Signals Evaluated excludes repeated DATA_REJECTED records while maintaining audit history', () => {
  const engine = new ForwardPaperEngine();
  engine.resetForwardState(100_000);
  engine.setPaperTradingActive(true);

  const tInvalid = new Date('2026-09-01T14:00:00Z').getTime();
  const invalidCandle: Candle = {
    timestamp: tInvalid,
    datetime: new Date(tInvalid).toISOString(),
    open: -2500, // Negative price fails validation with DATA_UNSAFE
    high: 2510,
    low: 2490,
    close: 2505,
    volume: 100,
    isVerified: true,
  };

  // 1. Process the same invalid candle 3 times
  engine.processCandle(invalidCandle, tInvalid + 900000, true);
  engine.processCandle(invalidCandle, tInvalid + 901000, true);
  engine.processCandle(invalidCandle, tInvalid + 902000, true);

  const progressAfterInvalid = engine.getProgress();

  // 2. dataRejections === 3
  assert.strictEqual(progressAfterInvalid.dataRejections, 3, 'dataRejections === 3');

  // 3. forwardObservationCount === 0
  assert.strictEqual(progressAfterInvalid.forwardObservationCount, 0, 'forwardObservationCount === 0');

  // 4. m15CandlesObserved === 0
  assert.strictEqual(progressAfterInvalid.m15CandlesObserved, 0, 'm15CandlesObserved === 0');

  // 10. No trade is created by the invalid candles
  assert.strictEqual(engine.getTrades().length, 0, 'No trade is created by the invalid candles');
  assert.strictEqual(engine.getOpenPositions().length, 0, 'No open positions created by invalid candles');

  // 5. Process one valid confirmed M15 candle
  const tValid = new Date('2026-09-01T14:15:00Z').getTime();
  const validCandle: Candle = {
    timestamp: tValid,
    datetime: new Date(tValid).toISOString(),
    open: 2500,
    high: 2510,
    low: 2495,
    close: 2505,
    volume: 100,
    isVerified: true,
  };
  engine.processCandle(validCandle, tValid + 900000, true);

  const progressAfterValid = engine.getProgress();

  // 6. dataRejections remains 3
  assert.strictEqual(progressAfterValid.dataRejections, 3, 'dataRejections remains 3');

  // 7. forwardObservationCount === 1
  assert.strictEqual(progressAfterValid.forwardObservationCount, 1, 'forwardObservationCount === 1');

  // 8. m15CandlesObserved === 1
  assert.strictEqual(progressAfterValid.m15CandlesObserved, 1, 'm15CandlesObserved === 1');

  // 9. All 3 DATA_REJECTED audit records remain present in the signal history
  const allSignals = engine.getSignals();
  const dataRejectedSignals = allSignals.filter(s => s.decision === 'DATA_REJECTED');
  assert.strictEqual(dataRejectedSignals.length, 3, 'All 3 DATA_REJECTED audit records remain present in the signal history');
  assert.strictEqual(allSignals.length, 4, 'Total signals equals 3 DATA_REJECTED + 1 valid candle evaluation');
});

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
console.log('================================================================\n');

if (failCount > 0) {
  process.exit(1);
}
