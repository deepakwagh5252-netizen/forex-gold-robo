import { PaperAccount, PaperAccountState, RiskBlockReason } from '../../types/paper-trading';

export const INITIAL_PAPER_CAPITAL = 1_000_000;
export const DETERMINISTIC_ACCOUNT_ID = 'PAPER-ACT-001';

export const DEFAULT_PAPER_ACCOUNT: PaperAccount = {
  accountId: DETERMINISTIC_ACCOUNT_ID,
  accountCurrency: 'USD',
  mode: 'PAPER ONLY',
  paperTradingEnabled: false, // Default: DISABLED
  state: 'PAPER_DISABLED',
  riskBlockReason: null,
  initialCapital: INITIAL_PAPER_CAPITAL,
  currentEquity: INITIAL_PAPER_CAPITAL,
  availableBalance: INITIAL_PAPER_CAPITAL,
  usedMargin: 0,
  realizedPnL: 0,
  unrealizedPnL: 0,
  dailyPnL: 0,
  dailyStartingEquity: INITIAL_PAPER_CAPITAL,
  peakEquity: INITIAL_PAPER_CAPITAL,
  currentDrawdown: 0,
  drawdownPercent: 0,
  dailyLossPercent: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  // Compatibility aliases
  isTradingEnabled: false,
  circuitBreakerTripped: false,
  circuitBreakerReason: null,
  dailyRealizedPnL: 0,
  lastResetAt: '2026-01-01T00:00:00.000Z',
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
};

const STORAGE_KEY = 'forex_gold_robo_paper_account_v1';

export class PaperAccountService {
  private account: PaperAccount;
  private listeners: ((account: PaperAccount) => void)[] = [];

  constructor() {
    this.account = this.loadPersistedAccount();
  }

  private loadPersistedAccount(): PaperAccount {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PaperAccount;
          // Ensure structure integrity
          if (parsed && typeof parsed.currentEquity === 'number' && parsed.mode === 'PAPER ONLY') {
            return {
              ...DEFAULT_PAPER_ACCOUNT,
              ...parsed,
              accountId: DETERMINISTIC_ACCOUNT_ID,
              paperTradingEnabled: Boolean(parsed.paperTradingEnabled ?? parsed.isTradingEnabled ?? false),
              isTradingEnabled: Boolean(parsed.paperTradingEnabled ?? parsed.isTradingEnabled ?? false),
              state: parsed.state || (parsed.paperTradingEnabled ? 'PAPER_ENABLED' : 'PAPER_DISABLED'),
            };
          }
        }
      }
    } catch {
      // Fallback to default
    }
    return { ...DEFAULT_PAPER_ACCOUNT };
  }

  private persist(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.account));
      }
    } catch {
      // Ignore persistence errors in restricted environments
    }
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const copy = this.getAccount();
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch {
        // Ignore listener error
      }
    }
  }

  subscribe(listener: (account: PaperAccount) => void): () => void {
    this.listeners.push(listener);
    listener(this.getAccount());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getAccount(): PaperAccount {
    return { ...this.account };
  }

  setTradingEnabled(enabled: boolean): PaperAccount {
    const now = new Date().toISOString();
    this.account.paperTradingEnabled = enabled;
    this.account.isTradingEnabled = enabled;
    this.account.updatedAt = now;
    this.account.lastUpdatedAt = now;

    if (!enabled) {
      this.account.state = 'PAPER_DISABLED';
    } else {
      if (this.account.riskBlockReason) {
        this.account.state = 'RISK_BLOCKED';
      } else {
        this.account.state = 'PAPER_ENABLED';
      }
    }

    this.persist();
    return this.getAccount();
  }

  setRiskBlock(blocked: boolean, reason: RiskBlockReason | null = null): PaperAccount {
    const now = new Date().toISOString();
    this.account.riskBlockReason = blocked ? reason : null;
    this.account.circuitBreakerTripped = blocked;
    this.account.circuitBreakerReason = blocked && reason ? reason : null;
    this.account.updatedAt = now;
    this.account.lastUpdatedAt = now;

    if (blocked) {
      this.account.state = 'RISK_BLOCKED';
    } else {
      this.account.state = this.account.paperTradingEnabled ? 'PAPER_ENABLED' : 'PAPER_DISABLED';
    }

    this.persist();
    return this.getAccount();
  }

  resetAccount(newCapital: number = INITIAL_PAPER_CAPITAL): PaperAccount {
    const now = new Date().toISOString();
    this.account = {
      ...DEFAULT_PAPER_ACCOUNT,
      initialCapital: newCapital,
      currentEquity: newCapital,
      availableBalance: newCapital,
      dailyStartingEquity: newCapital,
      peakEquity: newCapital,
      createdAt: now,
      updatedAt: now,
      lastResetAt: now,
      lastUpdatedAt: now,
    };
    this.persist();
    return this.getAccount();
  }

  /**
   * Updates unrealized P&L from active open positions and recalculates equity & drawdowns.
   */
  updateUnrealizedPnL(
    totalUnrealized: number, 
    maxDailyLossPercent: number = 3.0, 
    maxDrawdownPercent: number = 10.0
  ): PaperAccount {
    const now = new Date().toISOString();
    this.account.unrealizedPnL = Number(totalUnrealized.toFixed(2));
    this.account.currentEquity = Number((this.account.availableBalance + this.account.unrealizedPnL).toFixed(2));

    // Peak equity update
    if (this.account.currentEquity > this.account.peakEquity) {
      this.account.peakEquity = this.account.currentEquity;
    }

    // Drawdown calculation
    if (this.account.peakEquity > 0) {
      const dd = Math.max(0, this.account.peakEquity - this.account.currentEquity);
      this.account.currentDrawdown = Number(dd.toFixed(2));
      this.account.drawdownPercent = Number(((dd / this.account.peakEquity) * 100).toFixed(2));
    }

    // Daily loss calculation
    const dailyStarting = this.account.dailyStartingEquity || this.account.initialCapital;
    if (dailyStarting > 0) {
      const dailyPnL = Number((this.account.currentEquity - dailyStarting).toFixed(2));
      this.account.dailyPnL = dailyPnL;
      const dailyLossAmount = Math.max(0, dailyStarting - this.account.currentEquity);
      this.account.dailyLossPercent = Number(((dailyLossAmount / dailyStarting) * 100).toFixed(2));
    }

    // Circuit breaker checks
    const currentDailyLossPercent = this.account.dailyLossPercent ?? 0;
    const currentDrawdownPercent = this.account.drawdownPercent ?? 0;

    if (currentDailyLossPercent >= maxDailyLossPercent) {
      this.account.state = 'RISK_BLOCKED';
      this.account.riskBlockReason = 'DAILY_LOSS_LIMIT_REACHED';
      this.account.circuitBreakerTripped = true;
      this.account.circuitBreakerReason = 'DAILY_LOSS_LIMIT_REACHED';
    } else if (currentDrawdownPercent >= maxDrawdownPercent) {
      this.account.state = 'RISK_BLOCKED';
      this.account.riskBlockReason = 'MAX_DRAWDOWN_REACHED';
      this.account.circuitBreakerTripped = true;
      this.account.circuitBreakerReason = 'MAX_DRAWDOWN_REACHED';
    } else {
      this.account.riskBlockReason = null;
      this.account.circuitBreakerTripped = false;
      this.account.circuitBreakerReason = null;
      this.account.state = this.account.paperTradingEnabled ? 'PAPER_ENABLED' : 'PAPER_DISABLED';
    }

    this.account.updatedAt = now;
    this.account.lastUpdatedAt = now;
    this.persist();
    return this.getAccount();
  }

  /**
   * Applies realized P&L from a closed position.
   */
  applyRealizedPnL(pnl: number, isWin: boolean): PaperAccount {
    const now = new Date().toISOString();
    this.account.realizedPnL = Number((this.account.realizedPnL + pnl).toFixed(2));
    this.account.dailyRealizedPnL = Number(((this.account.dailyRealizedPnL || 0) + pnl).toFixed(2));
    this.account.dailyPnL = Number((this.account.dailyPnL + pnl).toFixed(2));
    this.account.availableBalance = Number((this.account.availableBalance + pnl).toFixed(2));
    this.account.currentEquity = Number((this.account.availableBalance + this.account.unrealizedPnL).toFixed(2));

    if (this.account.currentEquity > this.account.peakEquity) {
      this.account.peakEquity = this.account.currentEquity;
    }

    this.account.totalTrades += 1;
    if (isWin) {
      this.account.winningTrades += 1;
    } else {
      this.account.losingTrades += 1;
    }

    this.account.updatedAt = now;
    this.account.lastUpdatedAt = now;
    this.persist();
    return this.getAccount();
  }

  setUsedMargin(margin: number): void {
    this.account.usedMargin = Number(margin.toFixed(2));
    this.persist();
  }
}

export const paperAccountService = new PaperAccountService();
