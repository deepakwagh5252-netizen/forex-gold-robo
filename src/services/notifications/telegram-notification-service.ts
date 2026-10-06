import {
  TelegramDataWarningPayload,
  TelegramEngineStatusPayload,
  TelegramNotificationStatus,
  TelegramRiskLockPayload,
  TelegramSendResult,
  TelegramTradeClosedPayload,
  TelegramTradeOpenedPayload,
  TelegramTradeRejectedPayload,
} from '../../types/telegram';
import { TelegramMessageFormatter } from './telegram-message-formatter';
import { ForwardPaperEngine, forwardPaperEngine } from '../paper-trading/forward-paper-engine';
import { ForwardPosition, ForwardSignal, ForwardTrade, ForwardAccountState } from '../../types/forward-validation';

const STORAGE_KEYS = {
  SENT_EVENTS: 'forex_gold_robo_telegram_sent_events',
};

export class TelegramNotificationService {
  private sentEventIds: Set<string> = new Set();
  private lastDataWarningReason: string | null = null;
  private lastRiskLockReason: string | null = null;
  private isOnlineSent = false;
  private engineUnsubscribers: (() => void)[] = [];

  constructor() {
    this.loadPersistedSentEvents();
  }

  private loadPersistedSentEvents(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SENT_EVENTS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.sentEventIds = new Set(arr);
        }
      }
    } catch {
      // Graceful fallback
    }
  }

  private saveSentEvents(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      // Limit storage to last 1000 event IDs to prevent unbounded growth
      const arr = Array.from(this.sentEventIds).slice(-1000);
      localStorage.setItem(STORAGE_KEYS.SENT_EVENTS, JSON.stringify(arr));
    } catch {
      // Graceful fallback
    }
  }

  /**
   * Internal transport layer: Dispatches message to server proxy endpoint.
   * Completely isolates Telegram credentials from frontend code.
   */
  private async dispatchMessage(text: string, eventId: string): Promise<TelegramSendResult> {
    // 1. Client-side deduplication check
    if (this.sentEventIds.has(eventId)) {
      return {
        success: true,
        sent: false,
        status: 'CONNECTED',
        error: `DUPLICATE_SUPPRESSED: Event ${eventId} was already sent.`,
      };
    }

    try {
      // Detect environment: Browser vs Server/Node
      if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch('/api/notifications/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, eventId }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          return {
            success: false,
            sent: false,
            status: 'ERROR',
            error: errData.error || `HTTP ${res.status}: Failed to send message`,
          };
        }

        const data: TelegramSendResult = await res.json();
        if (data.sent) {
          this.sentEventIds.add(eventId);
          this.saveSentEvents();
        }
        return data;
      } else {
        // Node / Server environment fallback
        try {
          // Dynamic require or import of server service if running on Node
          const { telegramServerService } = await import('../../../server/telegram-service');
          const result = await telegramServerService.sendMessage(text, eventId);
          if (result.sent) {
            this.sentEventIds.add(eventId);
          }
          return result;
        } catch {
          return {
            success: false,
            sent: false,
            status: 'NOT_CONFIGURED',
            error: 'Server transport unavailable in current runtime.',
          };
        }
      }
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Telegram dispatch timed out' : (err.message || 'Network error');
      return {
        success: false,
        sent: false,
        status: 'ERROR',
        error: errorMsg,
      };
    }
  }

  /**
   * Retrieves sanitized notification status from backend.
   */
  public async getStatus(): Promise<TelegramNotificationStatus> {
    try {
      if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const res = await fetch('/api/notifications/telegram/status');
        if (res.ok) {
          return await res.json();
        }
      } else {
        const { telegramServerService } = await import('../../../server/telegram-service');
        return telegramServerService.getStatus();
      }
    } catch {
      // Fallback
    }

    return {
      status: 'NOT_CONFIGURED',
      isConfigured: false,
      lastSentAt: null,
      lastError: null,
      totalSentCount: 0,
    };
  }

  /**
   * EVENT 1: TRADE OPENED
   */
  public async sendTradeOpened(payload: TelegramTradeOpenedPayload): Promise<TelegramSendResult> {
    const text = TelegramMessageFormatter.formatTradeOpened(payload);
    const eventId = `TRADE_OPEN_${payload.tradeId}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * EVENT 2: TRADE CLOSED
   */
  public async sendTradeClosed(payload: TelegramTradeClosedPayload): Promise<TelegramSendResult> {
    const text = TelegramMessageFormatter.formatTradeClosed(payload);
    const eventId = `TRADE_CLOSE_${payload.tradeId}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * EVENT 3: TRADE REJECTED (Meaningful candidate signals only)
   */
  public async sendTradeRejected(payload: TelegramTradeRejectedPayload): Promise<TelegramSendResult> {
    const text = TelegramMessageFormatter.formatTradeRejected(payload);
    const eventId = `SIGNAL_REJECT_${payload.signalId}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * EVENT 4: RISK LOCK
   * Suppresses duplicate alerts for the same lock state.
   */
  public async sendRiskLock(payload: TelegramRiskLockPayload): Promise<TelegramSendResult> {
    if (this.lastRiskLockReason === payload.reason) {
      return {
        success: true,
        sent: false,
        status: 'CONNECTED',
        error: 'DUPLICATE_SUPPRESSED: Risk lock alert already sent for current condition.',
      };
    }

    this.lastRiskLockReason = payload.reason;
    const text = TelegramMessageFormatter.formatRiskLock(payload);
    const eventId = `RISK_LOCK_${Date.now()}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * EVENT 5: DATA FAILURE / WARNING
   * Stateful suppression: Sends once when an issue occurs, suppresses repeated warnings until recovery/change.
   */
  public async sendDataWarning(payload: TelegramDataWarningPayload): Promise<TelegramSendResult> {
    const warningKey = `${payload.reason}_${payload.lastValidCandle}`;
    if (this.lastDataWarningReason === warningKey) {
      return {
        success: true,
        sent: false,
        status: 'CONNECTED',
        error: 'DUPLICATE_SUPPRESSED: Data warning already sent for current candle.',
      };
    }

    this.lastDataWarningReason = warningKey;
    const text = TelegramMessageFormatter.formatDataWarning(payload);
    const eventId = `DATA_WARN_${Date.now()}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * Resets data warning suppression state upon successful candle recovery.
   */
  public resetDataWarningState(): void {
    this.lastDataWarningReason = null;
  }

  /**
   * Resets risk lock suppression state upon account reset or recovery.
   */
  public resetRiskLockState(): void {
    this.lastRiskLockReason = null;
  }

  /**
   * EVENT 6: ENGINE STATUS (Online on startup, Alert on unexpected stop)
   */
  public async sendEngineStatus(payload: TelegramEngineStatusPayload): Promise<TelegramSendResult> {
    if (payload.isOnline && this.isOnlineSent) {
      return {
        success: true,
        sent: false,
        status: 'CONNECTED',
        error: 'DUPLICATE_SUPPRESSED: Online status already sent for current session.',
      };
    }

    if (payload.isOnline) {
      this.isOnlineSent = true;
    }

    const text = TelegramMessageFormatter.formatEngineStatus(payload);
    const eventId = payload.isOnline ? `STATUS_ONLINE_${Date.now()}` : `STATUS_ALERT_${Date.now()}`;
    return this.dispatchMessage(text, eventId);
  }

  /**
   * Test notification trigger (strictly manual, read-only test)
   */
  public async sendTestNotification(): Promise<TelegramSendResult> {
    try {
      if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const res = await fetch('/api/notifications/telegram/test', { method: 'POST' });
        return await res.json();
      } else {
        const { telegramServerService } = await import('../../../server/telegram-service');
        const nowUtc = new Date().toISOString();
        const testText = TelegramMessageFormatter.formatTestNotification(nowUtc);
        return telegramServerService.sendMessage(testText, `TEST-${Date.now()}`);
      }
    } catch (err: any) {
      return {
        success: false,
        sent: false,
        status: 'ERROR',
        error: err.message || 'Error triggering test notification',
      };
    }
  }

  /**
   * Attaches this notification service to the ForwardPaperEngine.
   * Consumes events purely from external listeners:
   * ZERO modification of trading logic, risk calculations, or order execution.
   */
  public attachToEngine(engine: ForwardPaperEngine): () => void {
    // 1. Initial engine status announcement
    this.sendEngineStatus({
      isOnline: true,
      symbol: 'XAU/USD',
      timeframe: 'M15',
      filter: 'AB FROZEN',
      timeUTC: new Date().toISOString(),
    }).catch(() => {});

    // 2. Position Opened Listener
    const unsubPosition = engine.onPositionOpened((pos: ForwardPosition, sig: ForwardSignal) => {
      this.sendTradeOpened({
        tradeId: pos.positionId,
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        lotSize: pos.lotSize,
        positionSize: pos.positionSize,
        initialRisk: pos.initialRisk,
        regime: sig.marketRegime,
        session: sig.session,
        timeUTC: pos.openedAt,
      }).catch(() => {});
    });

    // 3. Trade Closed Listener
    const unsubTrade = engine.onTrade((trade: ForwardTrade) => {
      this.sendTradeClosed({
        tradeId: trade.tradeId,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        netPnL: trade.netPnL,
        rMultiple: trade.rMultiple,
        commission: trade.commission,
        spreadPips: ForwardPaperEngine.FROZEN_PARAMS.spreadMarkupPips,
        slippagePips: ForwardPaperEngine.FROZEN_PARAMS.slippagePips,
        closeReason: trade.closeReason,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        timeUTC: trade.closedAt,
      }).catch(() => {});
    });

    // 4. Signal Evaluated Listener (Rejected candidates only)
    const unsubSignal = engine.onSignal((sig: ForwardSignal) => {
      // Only notify for meaningful candidates that were rejected
      const isCandidateRejection =
        sig.decision === 'FILTERED' ||
        sig.decision === 'RISK_REJECTED' ||
        sig.decision === 'CAPACITY_REJECTED';

      if (isCandidateRejection) {
        this.sendTradeRejected({
          signalId: sig.signalId,
          direction: sig.direction,
          reason: sig.decisionReason,
          regime: sig.marketRegime,
          session: sig.session,
          timeUTC: sig.candleTimestampUTC,
        }).catch(() => {});
      }
    });

    // 5. Risk Lock Listener
    const unsubRiskLock = engine.onRiskLock((reason: string, account: ForwardAccountState) => {
      const peak = account.peakEquity || 100_000;
      const drawdownAmount = Math.max(0, peak - account.currentEquity);
      const drawdownPercent = peak > 0 ? (drawdownAmount / peak) * 100 : 0;
      const dailyPnL = account.currentEquity - account.dailyStartingEquity;
      const dailyLossPercent = account.dailyStartingEquity > 0 ? (Math.abs(Math.min(0, dailyPnL)) / account.dailyStartingEquity) * 100 : 0;

      this.sendRiskLock({
        reason,
        currentEquity: account.currentEquity,
        drawdownPercent,
        drawdownAmount,
        dailyPnL,
        dailyLossPercent,
        timeUTC: new Date().toISOString(),
      }).catch(() => {});
    });

    // 6. Data Warning Listener
    const unsubDataWarning = engine.onDataWarning((reason: string, lastValidCandle?: string) => {
      this.sendDataWarning({
        reason,
        lastValidCandle: lastValidCandle || 'N/A',
        timeUTC: new Date().toISOString(),
      }).catch(() => {});
    });

    // 7. Status Change Listener (to reset warning states when data becomes safe)
    const unsubStatus = engine.onStatusChange((status) => {
      if (status.dataStatus === 'DATA_SAFE') {
        this.resetDataWarningState();
      }
    });

    const cleanup = () => {
      unsubPosition();
      unsubTrade();
      unsubSignal();
      unsubRiskLock();
      unsubDataWarning();
      unsubStatus();
    };

    this.engineUnsubscribers.push(cleanup);
    return cleanup;
  }

  public detachAll(): void {
    for (const unsub of this.engineUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.engineUnsubscribers = [];
  }
}

export const telegramNotificationService = new TelegramNotificationService();
// Automatically attach outbound notification listener to the singleton forward paper engine
telegramNotificationService.attachToEngine(forwardPaperEngine);

