import { PaperTradeJournalEntry } from '../../types/paper-trading';

const STORAGE_KEY = 'forex_gold_robo_paper_journal_v1';

export class TradeJournalService {
  private entries: PaperTradeJournalEntry[] = [];
  private listeners: ((entries: PaperTradeJournalEntry[]) => void)[] = [];

  constructor() {
    this.entries = this.loadPersistedJournal();
  }

  private loadPersistedJournal(): PaperTradeJournalEntry[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PaperTradeJournalEntry[];
          if (Array.isArray(parsed)) {
            return parsed;
          }
        }
      }
    } catch {
      // Fallback
    }
    return [];
  }

  private persist(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
      }
    } catch {
      // Ignore in restricted environments
    }
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const copy = this.getEntries();
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch {
        // Ignore listener error
      }
    }
  }

  subscribe(listener: (entries: PaperTradeJournalEntry[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.getEntries());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getEntries(): PaperTradeJournalEntry[] {
    return [...this.entries];
  }

  getEntryById(journalId: string): PaperTradeJournalEntry | null {
    return this.entries.find((e) => e.journalId === journalId) ?? null;
  }

  getEntryByOrderId(paperOrderId: string): PaperTradeJournalEntry | null {
    return this.entries.find((e) => e.paperOrderId === paperOrderId) ?? null;
  }

  getEntriesBySetupId(setupId: string): PaperTradeJournalEntry[] {
    return this.entries.filter((e) => e.setupId === setupId);
  }

  /**
   * Appends a completed trade to the immutable journal.
   */
  recordTrade(entry: PaperTradeJournalEntry): void {
    // Prevent duplicate entries for same paper order
    if (this.entries.some((e) => e.paperOrderId === entry.paperOrderId)) {
      return;
    }
    this.entries.unshift(entry); // Newest first
    this.persist();
  }

  clearJournal(): void {
    this.entries = [];
    this.persist();
  }

  getAnalytics() {
    const totalTrades = this.entries.length;
    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRatePercent: 0,
        netPnL: 0,
        averageRMultiple: 0,
        profitFactor: 0,
        largestWinPnL: 0,
        largestLossPnL: 0,
      };
    }

    let winningTrades = 0;
    let losingTrades = 0;
    let netPnL = 0;
    let totalR = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let largestWinPnL = 0;
    let largestLossPnL = 0;

    for (const trade of this.entries) {
      netPnL += trade.realizedPnL;
      totalR += trade.rMultiple;

      if (trade.realizedPnL > 0) {
        winningTrades += 1;
        grossProfit += trade.realizedPnL;
        if (trade.realizedPnL > largestWinPnL) {
          largestWinPnL = trade.realizedPnL;
        }
      } else if (trade.realizedPnL < 0) {
        losingTrades += 1;
        grossLoss += Math.abs(trade.realizedPnL);
        if (trade.realizedPnL < largestLossPnL) {
          largestLossPnL = trade.realizedPnL;
        }
      }
    }

    const winRatePercent = Number(((winningTrades / totalTrades) * 100).toFixed(1));
    const averageRMultiple = Number((totalR / totalTrades).toFixed(2));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 999 : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRatePercent,
      netPnL: Number(netPnL.toFixed(2)),
      averageRMultiple,
      profitFactor,
      largestWinPnL: Number(largestWinPnL.toFixed(2)),
      largestLossPnL: Number(largestLossPnL.toFixed(2)),
    };
  }
}

export const tradeJournalService = new TradeJournalService();
