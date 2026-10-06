import {
  TelegramDataWarningPayload,
  TelegramEngineStatusPayload,
  TelegramRiskLockPayload,
  TelegramTradeClosedPayload,
  TelegramTradeOpenedPayload,
  TelegramTradeRejectedPayload,
} from '../../types/telegram';

export class TelegramMessageFormatter {
  /**
   * Formats duration between two ISO UTC strings or timestamps into human-readable string.
   */
  public static formatDuration(openedAt: string, closedAt: string): string {
    try {
      const start = new Date(openedAt).getTime();
      const end = new Date(closedAt).getTime();
      const diffMs = Math.max(0, end - start);
      const minutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (hours > 0) {
        return `${hours}h ${remainingMinutes}m`;
      }
      return `${minutes}m`;
    } catch {
      return '15m';
    }
  }

  /**
   * TRADE OPENED Template
   */
  public static formatTradeOpened(p: TelegramTradeOpenedPayload): string {
    return [
      '🟢 XAU/USD PAPER TRADE OPENED',
      '',
      `Direction: ${p.direction}`,
      `Entry: $${p.entryPrice.toFixed(2)}`,
      `Stop Loss: $${p.stopLoss.toFixed(2)}`,
      `Take Profit: $${p.takeProfit.toFixed(2)}`,
      `Size: ${p.lotSize} lots (${p.positionSize} oz)`,
      `Risk: $${p.initialRisk.toFixed(2)} (1.0%)`,
      `Regime: ${p.regime}`,
      `Session: ${p.session}`,
      `Time UTC: ${p.timeUTC}`,
      `Trade ID: ${p.tradeId}`,
    ].join('\n');
  }

  /**
   * TRADE CLOSED Template
   */
  public static formatTradeClosed(p: TelegramTradeClosedPayload): string {
    const formattedPnL = p.netPnL < 0
      ? `-$${Math.abs(p.netPnL).toFixed(2)}`
      : `+$${p.netPnL.toFixed(2)}`;
    const duration = this.formatDuration(p.openedAt, p.closedAt);
    return [
      '🔴 XAU/USD PAPER TRADE CLOSED',
      '',
      `Direction: ${p.direction}`,
      `Entry: $${p.entryPrice.toFixed(2)}`,
      `Exit: $${p.exitPrice.toFixed(2)}`,
      `P&L: ${formattedPnL} (${p.rMultiple.toFixed(2)}R)`,
      `Commission: $${p.commission.toFixed(2)}`,
      `Spread: ${p.spreadPips} pips`,
      `Slippage: ${p.slippagePips} pips`,
      `Close Reason: ${p.closeReason}`,
      `Duration: ${duration}`,
      `Trade ID: ${p.tradeId}`,
      `Time UTC: ${p.timeUTC}`,
    ].join('\n');
  }

  /**
   * TRADE REJECTED Template
   */
  public static formatTradeRejected(p: TelegramTradeRejectedPayload): string {
    return [
      '⚠️ XAU/USD TRADE REJECTED',
      '',
      `Direction: ${p.direction}`,
      `Reason: ${p.reason}`,
      `Regime: ${p.regime}`,
      `Session: ${p.session}`,
      `Time UTC: ${p.timeUTC}`,
      `Signal ID: ${p.signalId}`,
    ].join('\n');
  }

  /**
   * RISK LOCK Template
   */
  public static formatRiskLock(p: TelegramRiskLockPayload): string {
    const formattedDailyPnL = p.dailyPnL < 0
      ? `-$${Math.abs(p.dailyPnL).toFixed(2)}`
      : `+$${p.dailyPnL.toFixed(2)}`;
    return [
      '🛑 PAPER TRADING RISK LOCK',
      '',
      `Reason: ${p.reason}`,
      `Current Equity: $${p.currentEquity.toFixed(2)}`,
      `Drawdown: ${p.drawdownPercent.toFixed(2)}% ($${p.drawdownAmount.toFixed(2)})`,
      `Daily P&L: ${formattedDailyPnL} (${p.dailyLossPercent.toFixed(2)}%)`,
      `Time UTC: ${p.timeUTC}`,
    ].join('\n');
  }

  /**
   * DATA FAILURE Template
   */
  public static formatDataWarning(p: TelegramDataWarningPayload): string {
    return [
      '⚠️ XAU/USD DATA WARNING',
      '',
      `Reason: ${p.reason}`,
      `Last Valid Candle: ${p.lastValidCandle}`,
      `Time UTC: ${p.timeUTC}`,
    ].join('\n');
  }

  /**
   * ENGINE STATUS Template
   */
  public static formatEngineStatus(p: TelegramEngineStatusPayload): string {
    if (p.isOnline) {
      return [
        '🟢 FOREX & GOLD ROBO ONLINE',
        '',
        'Mode: PAPER ONLY',
        `Symbol: ${p.symbol || 'XAU/USD'}`,
        `Timeframe: ${p.timeframe || 'M15'}`,
        `Filter: ${p.filter || 'AB FROZEN'}`,
        `Time UTC: ${p.timeUTC}`,
      ].join('\n');
    }

    return [
      '🔴 FOREX & GOLD ROBO ALERT',
      '',
      'Engine stopped/error.',
      '',
      `Reason: ${p.reason || 'Unexpected engine halt'}`,
      `Last Valid Candle: ${p.lastValidCandle || 'N/A'}`,
      `Time UTC: ${p.timeUTC}`,
    ].join('\n');
  }

  /**
   * TEST NOTIFICATION Template
   */
  public static formatTestNotification(timeUTC: string): string {
    return [
      'ℹ️ XAU/USD TELEGRAM NOTIFICATION TEST',
      '',
      'Status: Operational',
      'Mode: PAPER NOTIFICATIONS ONLY',
      'Trading Engine Impact: ZERO (Read-Only Test)',
      `Time UTC: ${timeUTC}`,
    ].join('\n');
  }
}
