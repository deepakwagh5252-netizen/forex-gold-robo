/**
 * Phase 8A: Telegram Trade Notifications Types
 * Strictly outbound one-way notification layer.
 * Zero real-money route, zero trade alteration capability.
 */

export type TelegramConnectionStatus = 'CONNECTED' | 'NOT_CONFIGURED' | 'ERROR';

export type TelegramNotificationEventType =
  | 'TRADE_OPENED'
  | 'TRADE_CLOSED'
  | 'TRADE_REJECTED'
  | 'RISK_LOCK'
  | 'DATA_WARNING'
  | 'ENGINE_ONLINE'
  | 'ENGINE_ALERT'
  | 'TEST_NOTIFICATION';

export interface TelegramNotificationStatus {
  status: TelegramConnectionStatus;
  isConfigured: boolean;
  lastSentAt: string | null;
  lastError: string | null;
  totalSentCount: number;
}

export interface TelegramTradeOpenedPayload {
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  positionSize: number;
  initialRisk: number;
  regime: string;
  session: string;
  timeUTC: string;
}

export interface TelegramTradeClosedPayload {
  tradeId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  netPnL: number;
  rMultiple: number;
  commission: number;
  spreadPips: number;
  slippagePips: number;
  closeReason: string;
  openedAt: string;
  closedAt: string;
  timeUTC: string;
}

export interface TelegramTradeRejectedPayload {
  signalId: string;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  reason: string;
  regime: string;
  session: string;
  timeUTC: string;
}

export interface TelegramRiskLockPayload {
  reason: string;
  currentEquity: number;
  drawdownPercent: number;
  drawdownAmount: number;
  dailyPnL: number;
  dailyLossPercent: number;
  timeUTC: string;
}

export interface TelegramDataWarningPayload {
  reason: string;
  lastValidCandle: string;
  timeUTC: string;
}

export interface TelegramEngineStatusPayload {
  isOnline: boolean;
  symbol?: string;
  timeframe?: string;
  filter?: string;
  reason?: string;
  lastValidCandle?: string;
  timeUTC: string;
}

export interface TelegramSendResult {
  success: boolean;
  sent: boolean;
  status: TelegramConnectionStatus;
  messageId?: string;
  error?: string;
}
