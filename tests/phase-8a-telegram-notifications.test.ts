import * as assert from 'assert';
import { TelegramMessageFormatter } from '../src/services/notifications/telegram-message-formatter';
import { telegramServerService } from '../server/telegram-service';
import { TelegramNotificationService } from '../src/services/notifications/telegram-notification-service';
import { ForwardPaperEngine } from '../src/services/paper-trading/forward-paper-engine';
import { Candle } from '../src/market-data/provider.interface';
import {
  TelegramTradeOpenedPayload,
  TelegramTradeClosedPayload,
  TelegramTradeRejectedPayload,
  TelegramRiskLockPayload,
  TelegramDataWarningPayload,
  TelegramEngineStatusPayload,
} from '../src/types/telegram';

console.log('================================================================');
console.log('PHASE 8A: TELEGRAM NOTIFICATIONS TEST SUITE');
console.log('Testing outbound trade notifications, reliability & zero-order isolation');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res
        .then(() => {
          console.log(`[PASS] ${name}`);
          passCount++;
        })
        .catch((err) => {
          console.error(`[FAIL] ${name}:`, err.message);
          failCount++;
        });
    } else {
      console.log(`[PASS] ${name}`);
      passCount++;
    }
  } catch (err: any) {
    console.error(`[FAIL] ${name}:`, err.message);
    failCount++;
  }
}

async function runAllTests() {
  // -------------------------------------------------------------------------
  // TEST 1: FORMATTER TEMPLATES - TRADE OPENED
  // -------------------------------------------------------------------------
  runTest('FORMATTER - TRADE OPENED template matches exact specification', () => {
    const payload: TelegramTradeOpenedPayload = {
      tradeId: 'POS-FWD-1787616000000-101',
      direction: 'LONG',
      entryPrice: 2505.50,
      stopLoss: 2495.50,
      takeProfit: 2525.50,
      lotSize: 0.10,
      positionSize: 10,
      initialRisk: 1000,
      regime: 'TRENDING_BULLISH',
      session: 'LONDON',
      timeUTC: '2026-09-29T10:00:00.000Z',
    };

    const text = TelegramMessageFormatter.formatTradeOpened(payload);
    assert.ok(text.includes('🟢 XAU/USD PAPER TRADE OPENED'), 'Must have correct header');
    assert.ok(text.includes('Direction: LONG'), 'Must include direction');
    assert.ok(text.includes('Entry: $2505.50'), 'Must include formatted entry');
    assert.ok(text.includes('Stop Loss: $2495.50'), 'Must include formatted stop loss');
    assert.ok(text.includes('Take Profit: $2525.50'), 'Must include formatted take profit');
    assert.ok(text.includes('Size: 0.1 lots (10 oz)'), 'Must include lot size and oz');
    assert.ok(text.includes('Risk: $1000.00 (1.0%)'), 'Must include 1.0% risk');
    assert.ok(text.includes('Regime: TRENDING_BULLISH'), 'Must include regime');
    assert.ok(text.includes('Session: LONDON'), 'Must include session');
    assert.ok(text.includes('Time UTC: 2026-09-29T10:00:00.000Z'), 'Must include UTC time');
    assert.ok(text.includes('Trade ID: POS-FWD-1787616000000-101'), 'Must include trade ID');
  });

  // -------------------------------------------------------------------------
  // TEST 2: FORMATTER TEMPLATES - TRADE CLOSED
  // -------------------------------------------------------------------------
  runTest('FORMATTER - TRADE CLOSED template matches exact specification', () => {
    const payload: TelegramTradeClosedPayload = {
      tradeId: 'TRD-FWD-1787616000000-202',
      direction: 'LONG',
      entryPrice: 2505.50,
      exitPrice: 2525.50,
      netPnL: 193.00,
      rMultiple: 1.93,
      commission: 7.00,
      spreadPips: 1.0,
      slippagePips: 0.5,
      closeReason: 'TAKE_PROFIT',
      openedAt: '2026-09-29T10:00:00.000Z',
      closedAt: '2026-09-29T11:30:00.000Z',
      timeUTC: '2026-09-29T11:30:00.000Z',
    };

    const text = TelegramMessageFormatter.formatTradeClosed(payload);
    assert.ok(text.includes('🔴 XAU/USD PAPER TRADE CLOSED'), 'Must have correct header');
    assert.ok(text.includes('Direction: LONG'));
    assert.ok(text.includes('Entry: $2505.50'));
    assert.ok(text.includes('Exit: $2525.50'));
    assert.ok(text.includes('P&L: +$193.00 (1.93R)'));
    assert.ok(text.includes('Commission: $7.00'));
    assert.ok(text.includes('Spread: 1 pips'));
    assert.ok(text.includes('Slippage: 0.5 pips'));
    assert.ok(text.includes('Close Reason: TAKE_PROFIT'));
    assert.ok(text.includes('Duration: 1h 30m'));
    assert.ok(text.includes('Trade ID: TRD-FWD-1787616000000-202'));
  });

  // -------------------------------------------------------------------------
  // TEST 3: FORMATTER TEMPLATES - TRADE REJECTED
  // -------------------------------------------------------------------------
  runTest('FORMATTER - TRADE REJECTED template matches exact specification', () => {
    const payload: TelegramTradeRejectedPayload = {
      signalId: 'SIG-FWD-1787616000000-303',
      direction: 'SHORT',
      reason: 'FILTER_A_REJECTED: Short breakdown during TRENDING_BEARISH regime',
      regime: 'TRENDING_BEARISH',
      session: 'LONDON',
      timeUTC: '2026-09-29T12:00:00.000Z',
    };

    const text = TelegramMessageFormatter.formatTradeRejected(payload);
    assert.ok(text.includes('⚠️ XAU/USD TRADE REJECTED'), 'Must have correct header');
    assert.ok(text.includes('Direction: SHORT'));
    assert.ok(text.includes('Reason: FILTER_A_REJECTED'));
    assert.ok(text.includes('Regime: TRENDING_BEARISH'));
    assert.ok(text.includes('Session: LONDON'));
    assert.ok(text.includes('Time UTC: 2026-09-29T12:00:00.000Z'));
    assert.ok(text.includes('Signal ID: SIG-FWD-1787616000000-303'));
  });

  // -------------------------------------------------------------------------
  // TEST 4: FORMATTER TEMPLATES - RISK LOCK
  // -------------------------------------------------------------------------
  runTest('FORMATTER - RISK LOCK template matches exact specification', () => {
    const payload: TelegramRiskLockPayload = {
      reason: 'DAILY_LOSS_LIMIT_REACHED: Daily loss 3.12% exceeds max limit of 3.0%',
      currentEquity: 96880.00,
      drawdownPercent: 3.12,
      drawdownAmount: 3120.00,
      dailyPnL: -3120.00,
      dailyLossPercent: 3.12,
      timeUTC: '2026-09-29T14:00:00.000Z',
    };

    const text = TelegramMessageFormatter.formatRiskLock(payload);
    assert.ok(text.includes('🛑 PAPER TRADING RISK LOCK'), 'Must have correct header');
    assert.ok(text.includes('Reason: DAILY_LOSS_LIMIT_REACHED'));
    assert.ok(text.includes('Current Equity: $96880.00'));
    assert.ok(text.includes('Drawdown: 3.12% ($3120.00)'));
    assert.ok(text.includes('Daily P&L: -$3120.00 (3.12%)'));
    assert.ok(text.includes('Time UTC: 2026-09-29T14:00:00.000Z'));
  });

  // -------------------------------------------------------------------------
  // TEST 5: FORMATTER TEMPLATES - DATA FAILURE & ENGINE STATUS
  // -------------------------------------------------------------------------
  runTest('FORMATTER - DATA WARNING & ENGINE STATUS templates match exact specification', () => {
    const dataWarning = TelegramMessageFormatter.formatDataWarning({
      reason: 'OHLC_HIGH_LESS_THAN_CLOSE',
      lastValidCandle: '2026-09-29T13:45:00.000Z',
      timeUTC: '2026-09-29T14:00:00.000Z',
    });
    assert.ok(dataWarning.includes('⚠️ XAU/USD DATA WARNING'));
    assert.ok(dataWarning.includes('Reason: OHLC_HIGH_LESS_THAN_CLOSE'));
    assert.ok(dataWarning.includes('Last Valid Candle: 2026-09-29T13:45:00.000Z'));

    const onlineStatus = TelegramMessageFormatter.formatEngineStatus({
      isOnline: true,
      symbol: 'XAU/USD',
      timeframe: 'M15',
      filter: 'AB FROZEN',
      timeUTC: '2026-09-29T10:00:00.000Z',
    });
    assert.ok(onlineStatus.includes('🟢 FOREX & GOLD ROBO ONLINE'));
    assert.ok(onlineStatus.includes('Mode: PAPER ONLY'));
    assert.ok(onlineStatus.includes('Filter: AB FROZEN'));

    const alertStatus = TelegramMessageFormatter.formatEngineStatus({
      isOnline: false,
      reason: 'Heartbeat timeout',
      lastValidCandle: '2026-09-29T13:45:00.000Z',
      timeUTC: '2026-09-29T14:00:00.000Z',
    });
    assert.ok(alertStatus.includes('🔴 FOREX & GOLD ROBO ALERT'));
    assert.ok(alertStatus.includes('Engine stopped/error.'));
  });

  // -------------------------------------------------------------------------
  // TEST 6: SECURITY - NO CREDENTIALS LEAKED IN STATUS OR API
  // -------------------------------------------------------------------------
  runTest('SECURITY - Status endpoint and service never leak bot tokens or chat IDs', () => {
    const status = telegramServerService.getStatus();
    assert.strictEqual(typeof status.status, 'string');
    assert.strictEqual(typeof status.isConfigured, 'boolean');
    assert.strictEqual((status as any).token, undefined, 'Must not expose token');
    assert.strictEqual((status as any).chatId, undefined, 'Must not expose chatId');
    assert.strictEqual((status as any).TELEGRAM_BOT_TOKEN, undefined);
    assert.strictEqual((status as any).TELEGRAM_CHAT_ID, undefined);
  });

  // -------------------------------------------------------------------------
  // TEST 7: UNCONFIGURED FALLBACK - SAFE CONTINUATION
  // -------------------------------------------------------------------------
  runTest('SECURITY - Missing credentials return NOT_CONFIGURED without crashing or throwing', async () => {
    // If not configured, sendMessage returns NOT_CONFIGURED
    const origToken = process.env.TELEGRAM_BOT_TOKEN;
    const origChatId = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    try {
      const res = await telegramServerService.sendMessage('Test Message', 'EVENT-TEST-1');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.sent, false);
      assert.strictEqual(res.status, 'NOT_CONFIGURED');
      assert.ok(res.error?.includes('TELEGRAM_NOT_CONFIGURED'));
    } finally {
      if (origToken) process.env.TELEGRAM_BOT_TOKEN = origToken;
      if (origChatId) process.env.TELEGRAM_CHAT_ID = origChatId;
    }
  });

  // -------------------------------------------------------------------------
  // TEST 8: IDEMPOTENCY & DEDUPLICATION (Server Side)
  // -------------------------------------------------------------------------
  runTest('IDEMPOTENCY - Duplicate eventId is safely suppressed on server', async () => {
    // Test that the same eventId is recorded and rejected on duplicate call
    const service = telegramServerService;
    // Set mock env for test
    process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_12345';
    process.env.TELEGRAM_CHAT_ID = 'mock_chat_id_67890';

    const testEventId = `TEST_IDEMPOTENT_${Date.now()}`;
    (service as any).sentEventIds.add(testEventId);

    const dupRes = await service.sendMessage('Repeat message', testEventId);
    assert.strictEqual(dupRes.success, true);
    assert.strictEqual(dupRes.sent, false, 'Duplicate must not be sent');
    assert.ok(dupRes.error?.includes('DUPLICATE_SUPPRESSED'), 'Must indicate suppression');
  });

  // -------------------------------------------------------------------------
  // TEST 9: RATE CONTROL - REPEATED DATA WARNING SUPPRESSION
  // -------------------------------------------------------------------------
  runTest('RATE CONTROL - Repeated data failure on consecutive candles is suppressed', async () => {
    const notifService = new TelegramNotificationService();
    
    // First warning for a bad candle
    const res1 = await notifService.sendDataWarning({
      reason: 'CANDLE_STALE',
      lastValidCandle: '2026-09-29T10:00:00.000Z',
      timeUTC: '2026-09-29T10:15:00.000Z',
    });

    // Consecutive candle has the same failure
    const res2 = await notifService.sendDataWarning({
      reason: 'CANDLE_STALE',
      lastValidCandle: '2026-09-29T10:00:00.000Z',
      timeUTC: '2026-09-29T10:30:00.000Z',
    });

    assert.strictEqual(res2.sent, false, 'Repeated data warning must be suppressed');
    assert.ok(res2.error?.includes('DUPLICATE_SUPPRESSED'));

    // Upon data recovery, suppression is cleared
    notifService.resetDataWarningState();

    // Now a new data warning can fire
    const res3 = await notifService.sendDataWarning({
      reason: 'CANDLE_STALE',
      lastValidCandle: '2026-09-29T10:00:00.000Z',
      timeUTC: '2026-09-29T11:00:00.000Z',
    });
    // Should not be suppressed due to previous warning
    assert.notStrictEqual(res3.error, 'DUPLICATE_SUPPRESSED: Data warning already sent for current candle.');
  });

  // -------------------------------------------------------------------------
  // TEST 10: RATE CONTROL - REPEATED RISK LOCK SUPPRESSION
  // -------------------------------------------------------------------------
  runTest('RATE CONTROL - Repeated risk lock alert for same condition is suppressed', async () => {
    const notifService = new TelegramNotificationService();

    const lockPayload: TelegramRiskLockPayload = {
      reason: 'MAX_DRAWDOWN_LIMIT_EXCEEDED (10.0%)',
      currentEquity: 89000,
      drawdownPercent: 11.0,
      drawdownAmount: 11000,
      dailyPnL: -2000,
      dailyLossPercent: 2.0,
      timeUTC: new Date().toISOString(),
    };

    // First risk lock alert
    await notifService.sendRiskLock(lockPayload);

    // Second risk lock alert with identical reason
    const res2 = await notifService.sendRiskLock(lockPayload);
    assert.strictEqual(res2.sent, false);
    assert.ok(res2.error?.includes('DUPLICATE_SUPPRESSED'));
  });

  // -------------------------------------------------------------------------
  // TEST 11: REJECTION NOTIFICATION FILTER - MEANINGFUL SIGNALS ONLY
  // -------------------------------------------------------------------------
  runTest('FILTERING - Idle bars (NO_TRADE) do not generate rejection spam', () => {
    const notifService = new TelegramNotificationService();
    let rejectionSentCount = 0;
    (notifService as any).dispatchMessage = async (text: string, eventId: string) => {
      if (eventId.startsWith('SIGNAL_REJECT_')) {
        rejectionSentCount++;
      }
      return { success: true, sent: true, status: 'CONNECTED' };
    };

    const engine = new ForwardPaperEngine();
    notifService.attachToEngine(engine);

    // Idle candle without breakout should NOT trigger sendTradeRejected
    const idleCandle: Candle = {
      timestamp: 1787616000000,
      datetime: '2026-09-29T10:00:00.000Z',
      open: 2500,
      high: 2501,
      low: 2499,
      close: 2500.5,
      volume: 10,
      isVerified: true,
    };

    engine.processCandle(idleCandle);
    assert.strictEqual(rejectionSentCount, 0, 'Idle NO_TRADE signals must never trigger Telegram rejections');
    notifService.detachAll();
  });

  // -------------------------------------------------------------------------
  // TEST 12: ONE-WAY PAPER-ONLY GUARANTEE
  // -------------------------------------------------------------------------
  runTest('ONE-WAY GUARANTEE - Notification services have zero trade execution capability', () => {
    const forbiddenMethods = [
      'placeOrder',
      'marketOrder',
      'limitOrder',
      'modifyOrder',
      'cancelOrder',
      'closePosition',
      'enableLiveTrading',
      'executeTrade',
      'sendOrder',
    ];

    const notifService = new TelegramNotificationService();
    for (const method of forbiddenMethods) {
      assert.strictEqual((notifService as any)[method], undefined, `TelegramNotificationService must not have ${method}`);
      assert.strictEqual((telegramServerService as any)[method], undefined, `telegramServerService must not have ${method}`);
    }
  });

  // -------------------------------------------------------------------------
  // TEST 13: FAILURE ISOLATION - ENGINE UNAFFECTED BY TELEGRAM ERRORS
  // -------------------------------------------------------------------------
  runTest('FAILURE ISOLATION - Telegram network failures never halt or alter engine execution', () => {
    const engine = new ForwardPaperEngine();
    const notifService = new TelegramNotificationService();

    // Mock dispatchMessage to simulate network explosion
    (notifService as any).dispatchMessage = async () => {
      throw new Error('Telegram network socket destroyed');
    };

    notifService.attachToEngine(engine);

    const initialEquity = engine.getAccount().currentEquity;
    assert.strictEqual(initialEquity, 100_000);

    // Process candle with failing notification service attached
    const candle: Candle = {
      timestamp: 1787616000000,
      datetime: '2026-09-29T10:00:00.000Z',
      open: 2500,
      high: 2505,
      low: 2495,
      close: 2502,
      volume: 50,
      isVerified: true,
    };

    // Engine execution must NOT throw
    assert.doesNotThrow(() => {
      engine.processCandle(candle);
    }, 'Engine must proceed unaffected when Telegram fails');

    assert.strictEqual(engine.getStatus().engineStatus, 'RUNNING');
    notifService.detachAll();
  });

  // Wait a moment for any async runTest completions
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log('\n================================================================');
  console.log(`PHASE 8A TEST RESULTS: ${passCount} / ${passCount + failCount} PASSED`);
  if (failCount === 0) {
    console.log('ALL PHASE 8A ACCEPTANCE TESTS PASSED SUCCESSFULLY.');
  } else {
    console.error(`FAILED: ${failCount} tests failed.`);
    process.exit(1);
  }
  console.log('================================================================\n');
}

runAllTests().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
