import {
  ForwardAccountState,
  ForwardCandle,
  ForwardEquitySnapshot,
  ForwardPosition,
  ForwardSignal,
  ForwardSystemEvent,
  ForwardTrade,
} from '../../types/forward-validation';

export const FORWARD_STORAGE_KEYS = {
  ACCOUNT: 'forex_gold_robo_forward_account_v1',
  POSITIONS: 'forex_gold_robo_forward_positions_v1',
  SIGNALS: 'forex_gold_robo_forward_signals_v1',
  TRADES: 'forex_gold_robo_forward_trades_v1',
  CANDLES: 'forex_gold_robo_forward_candles_v1',
  EQUITY_SNAPSHOTS: 'forex_gold_robo_forward_equity_snapshots_v1',
  EVENTS: 'forex_gold_robo_forward_events_v1',
  PROCESSED_TIMESTAMPS: 'forex_gold_robo_forward_processed_timestamps_v1',
};

export const INITIAL_FORWARD_ACCOUNT: ForwardAccountState = {
  startingBalance: 100_000,
  currentBalance: 100_000,
  currentEquity: 100_000,
  peakEquity: 100_000,
  dailyStartingEquity: 100_000,
  dailyStartDayUTC: new Date().toISOString().substring(0, 10),
  realizedPnL: 0,
  unrealizedPnL: 0,
  totalFeesPaid: 0,
  paperTradingActive: false, // PAPER_DISABLED by default per Section 6
};

export class ForwardPersistence {
  private static isStorageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  public static loadAccount(): ForwardAccountState {
    if (!this.isStorageAvailable()) return { ...INITIAL_FORWARD_ACCOUNT };
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.ACCOUNT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.currentEquity === 'number') {
          return { ...INITIAL_FORWARD_ACCOUNT, ...parsed };
        }
      }
    } catch {
      // Fallback
    }
    return { ...INITIAL_FORWARD_ACCOUNT };
  }

  public static saveAccount(account: ForwardAccountState): void {
    if (!this.isStorageAvailable()) return;
    try {
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.ACCOUNT, JSON.stringify(account));
    } catch {
      // Ignore
    }
  }

  public static loadPositions(): Map<string, ForwardPosition> {
    const map = new Map<string, ForwardPosition>();
    if (!this.isStorageAvailable()) return map;
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.POSITIONS);
      if (raw) {
        const parsed = JSON.parse(raw) as ForwardPosition[];
        if (Array.isArray(parsed)) {
          for (const pos of parsed) {
            map.set(pos.positionId, pos);
          }
        }
      }
    } catch {
      // Fallback
    }
    return map;
  }

  public static savePositions(positions: Map<string, ForwardPosition>): void {
    if (!this.isStorageAvailable()) return;
    try {
      const arr = Array.from(positions.values());
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.POSITIONS, JSON.stringify(arr));
    } catch {
      // Ignore
    }
  }

  public static loadSignals(): ForwardSignal[] {
    if (!this.isStorageAvailable()) return [];
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.SIGNALS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return [];
  }

  public static saveSignals(signals: ForwardSignal[]): void {
    if (!this.isStorageAvailable()) return;
    try {
      // Keep up to 2000 recent signals to prevent unbounded localStorage growth
      const trimmed = signals.slice(-2000);
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.SIGNALS, JSON.stringify(trimmed));
    } catch {
      // Ignore
    }
  }

  public static loadTrades(): ForwardTrade[] {
    if (!this.isStorageAvailable()) return [];
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.TRADES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return [];
  }

  public static saveTrades(trades: ForwardTrade[]): void {
    if (!this.isStorageAvailable()) return;
    try {
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.TRADES, JSON.stringify(trades));
    } catch {
      // Ignore
    }
  }

  public static loadEquitySnapshots(): ForwardEquitySnapshot[] {
    if (!this.isStorageAvailable()) return [];
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.EQUITY_SNAPSHOTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return [];
  }

  public static saveEquitySnapshots(snapshots: ForwardEquitySnapshot[]): void {
    if (!this.isStorageAvailable()) return;
    try {
      const trimmed = snapshots.slice(-2000);
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.EQUITY_SNAPSHOTS, JSON.stringify(trimmed));
    } catch {
      // Ignore
    }
  }

  public static loadEvents(): ForwardSystemEvent[] {
    if (!this.isStorageAvailable()) return [];
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.EVENTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return [];
  }

  public static saveEvents(events: ForwardSystemEvent[]): void {
    if (!this.isStorageAvailable()) return;
    try {
      const trimmed = events.slice(-500);
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.EVENTS, JSON.stringify(trimmed));
    } catch {
      // Ignore
    }
  }

  public static loadProcessedTimestamps(): Set<number> {
    const set = new Set<number>();
    if (!this.isStorageAvailable()) return set;
    try {
      const raw = window.localStorage.getItem(FORWARD_STORAGE_KEYS.PROCESSED_TIMESTAMPS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const ts of parsed) set.add(ts);
        }
      }
    } catch {
      // Fallback
    }
    return set;
  }

  public static saveProcessedTimestamps(timestamps: Set<number>): void {
    if (!this.isStorageAvailable()) return;
    try {
      const arr = Array.from(timestamps).slice(-5000);
      window.localStorage.setItem(FORWARD_STORAGE_KEYS.PROCESSED_TIMESTAMPS, JSON.stringify(arr));
    } catch {
      // Ignore
    }
  }

  public static clearAll(): void {
    if (!this.isStorageAvailable()) return;
    try {
      for (const key of Object.values(FORWARD_STORAGE_KEYS)) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore
    }
  }
}
