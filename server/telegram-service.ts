import { TelegramConnectionStatus, TelegramSendResult } from '../src/types/telegram';

export class TelegramServerService {
  private lastSentAt: string | null = null;
  private lastError: string | null = null;
  private totalSentCount = 0;
  private sentEventIds = new Set<string>();

  /**
   * Checks whether Telegram bot token and chat ID are configured in server environment.
   */
  public isConfigured(): boolean {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    return Boolean(token && token.trim().length > 0 && chatId && chatId.trim().length > 0);
  }

  /**
   * Retrieves sanitized connection status. Never exposes token or chat ID!
   */
  public getStatus(): {
    status: TelegramConnectionStatus;
    isConfigured: boolean;
    lastSentAt: string | null;
    lastError: string | null;
    totalSentCount: number;
  } {
    const configured = this.isConfigured();
    let status: TelegramConnectionStatus = 'NOT_CONFIGURED';

    if (!configured) {
      status = 'NOT_CONFIGURED';
    } else if (this.lastError) {
      status = 'ERROR';
    } else {
      status = 'CONNECTED';
    }

    return {
      status,
      isConfigured: configured,
      lastSentAt: this.lastSentAt,
      lastError: this.lastError,
      totalSentCount: this.totalSentCount,
    };
  }

  /**
   * Sends an outbound notification message to Telegram.
   * Strictly enforces:
   * - Bounded timeout (5000ms)
   * - Duplicate prevention via eventId
   * - Bounded retries (max 2 retries)
   * - Graceful failure fallback (never crashes process)
   */
  public async sendMessage(
    text: string,
    eventId?: string
  ): Promise<TelegramSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        sent: false,
        status: 'NOT_CONFIGURED',
        error: 'TELEGRAM_NOT_CONFIGURED: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing from server environment.',
      };
    }

    // Duplicate event prevention (Idempotency)
    if (eventId && this.sentEventIds.has(eventId)) {
      return {
        success: true,
        sent: false,
        status: 'CONNECTED',
        error: `DUPLICATE_SUPPRESSED: Event ${eventId} was already sent.`,
      };
    }

    const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID!.trim();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    let attempts = 0;
    const maxAttempts = 3; // 1 initial + 2 retries
    let lastErr: string | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          this.lastSentAt = new Date().toISOString();
          this.lastError = null;
          this.totalSentCount++;
          if (eventId) {
            this.sentEventIds.add(eventId);
            if (this.sentEventIds.size > 2000) {
              const oldest = this.sentEventIds.values().next().value;
              if (oldest) this.sentEventIds.delete(oldest);
            }
          }
          return {
            success: true,
            sent: true,
            status: 'CONNECTED',
            messageId: data?.result?.message_id ? String(data.result.message_id) : undefined,
          };
        } else {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.description || `HTTP ${response.status}: ${response.statusText}`;
          lastErr = `Telegram API Error: ${errMsg}`;
          // Don't retry client errors like bad token or chat not found (4xx)
          if (response.status >= 400 && response.status < 500) {
            break;
          }
        }
      } catch (err: any) {
        lastErr = err.name === 'AbortError' ? 'Telegram request timed out after 5000ms' : (err.message || 'Network error');
      }

      // Short delay before retry
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    this.lastError = lastErr;
    return {
      success: false,
      sent: false,
      status: 'ERROR',
      error: lastErr || 'Failed to send Telegram notification',
    };
  }
}

export const telegramServerService = new TelegramServerService();
