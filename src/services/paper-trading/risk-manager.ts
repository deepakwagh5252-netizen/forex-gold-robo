import { 
  PaperAccount, 
  PaperRiskConfig, 
  PaperRejectionReason,
  RiskEngineDecision 
} from '../../types/paper-trading';
import { SetupRecord } from '../../types/scanner';
import { PositionSizer, SizingResult } from './position-sizer';

export const DEFAULT_PAPER_RISK_CONFIG: PaperRiskConfig = {
  riskPerTradePercent: 1.0,
  maxOpenPositions: 3,
  minimumRR: 2.0,
  minRiskReward: 2.0,
  maximumDailyLossPercent: 3.0,
  maxDailyLossPercent: 3.0,
  maximumDrawdownPercent: 10.0,
  maxAccountDrawdownPercent: 10.0,
  commissionPerLot: null, // default null: NOT CONFIGURED
  commissionDisabled: false,
  slippagePips: null, // default null: NOT CONFIGURED
  slippageDisabled: false,
  spreadMarkupPips: null, // default null: NOT CONFIGURED
  spreadDisabled: false,
  contractSpecifications: {
    'XAU/USD': null, // Default: NOT CONFIGURED (Section 4 & 7)
    'EUR/USD': null,
    'GBP/USD': null,
    'USD/JPY': null,
  },
  requireContractSpec: true,
};

const RISK_CONFIG_STORAGE_KEY = 'forex_gold_robo_paper_risk_config_v1';

export interface RiskEvaluationResult {
  isEligible: boolean;
  decision: RiskEngineDecision;
  rejectionReason: PaperRejectionReason | null;
  rejectionDetails: string | null;
  sizing: SizingResult | null;
}

export class RiskEngine {
  protected config: PaperRiskConfig;

  constructor(initialConfig: Partial<PaperRiskConfig> = {}) {
    this.config = this.loadPersistedConfig(initialConfig);
  }

  private loadPersistedConfig(override: Partial<PaperRiskConfig> = {}): PaperRiskConfig {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(RISK_CONFIG_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PaperRiskConfig;
          if (parsed && typeof parsed.riskPerTradePercent === 'number') {
            return {
              ...DEFAULT_PAPER_RISK_CONFIG,
              ...parsed,
              minimumRR: parsed.minimumRR ?? parsed.minRiskReward ?? 2.0,
              maximumDailyLossPercent: parsed.maximumDailyLossPercent ?? parsed.maxDailyLossPercent ?? 3.0,
              maximumDrawdownPercent: parsed.maximumDrawdownPercent ?? parsed.maxAccountDrawdownPercent ?? 10.0,
              ...override,
            };
          }
        }
      }
    } catch {
      // Fallback
    }
    return {
      ...DEFAULT_PAPER_RISK_CONFIG,
      ...override,
    };
  }

  private persistConfig(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(RISK_CONFIG_STORAGE_KEY, JSON.stringify(this.config));
      }
    } catch {
      // Ignore in restricted environments
    }
  }

  getConfig(): PaperRiskConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<PaperRiskConfig>): PaperRiskConfig {
    this.config = {
      ...this.config,
      ...updates,
      minimumRR: updates.minimumRR ?? updates.minRiskReward ?? this.config.minimumRR,
      minRiskReward: updates.minimumRR ?? updates.minRiskReward ?? this.config.minimumRR,
      maximumDailyLossPercent: updates.maximumDailyLossPercent ?? updates.maxDailyLossPercent ?? this.config.maximumDailyLossPercent,
      maxDailyLossPercent: updates.maximumDailyLossPercent ?? updates.maxDailyLossPercent ?? this.config.maximumDailyLossPercent,
      maximumDrawdownPercent: updates.maximumDrawdownPercent ?? updates.maxAccountDrawdownPercent ?? this.config.maximumDrawdownPercent,
      maxAccountDrawdownPercent: updates.maximumDrawdownPercent ?? updates.maxAccountDrawdownPercent ?? this.config.maximumDrawdownPercent,
      contractSpecifications: {
        ...this.config.contractSpecifications,
        ...(updates.contractSpecifications || {}),
      },
      commissionPerLot: updates.commissionPerLot !== undefined ? updates.commissionPerLot : this.config.commissionPerLot,
      commissionDisabled: updates.commissionDisabled !== undefined ? updates.commissionDisabled : this.config.commissionDisabled,
      spreadMarkupPips: updates.spreadMarkupPips !== undefined ? updates.spreadMarkupPips : this.config.spreadMarkupPips,
      spreadDisabled: updates.spreadDisabled !== undefined ? updates.spreadDisabled : this.config.spreadDisabled,
      slippagePips: updates.slippagePips !== undefined ? updates.slippagePips : this.config.slippagePips,
      slippageDisabled: updates.slippageDisabled !== undefined ? updates.slippageDisabled : this.config.slippageDisabled,
    };
    this.persistConfig();
    return this.getConfig();
  }

  /**
   * Deterministic calculation: Risk Amount
   * riskAmount = currentEquity * riskPerTradePercent / 100
   */
  static calculateRiskAmount(currentEquity: number, riskPerTradePercent: number): number {
    if (!currentEquity || currentEquity <= 0 || !riskPerTradePercent || riskPerTradePercent <= 0) {
      return 0;
    }
    return Number(((currentEquity * riskPerTradePercent) / 100).toFixed(2));
  }

  /**
   * Deterministic calculation: Risk Per Unit
   * For LONG or SHORT: riskPerUnit = ABS(entryPrice - stopLoss)
   * If entryPrice <= 0, stopLoss <= 0, or riskPerUnit <= 0 -> reject (never divide by zero)
   */
  static calculateRiskPerUnit(entryPrice: number, stopLoss: number): {
    riskPerUnit: number;
    isValid: boolean;
    error: string | null;
  } {
    if (entryPrice <= 0) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_RISK_DISTANCE: Entry price must be strictly positive' };
    }
    if (stopLoss <= 0) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_RISK_DISTANCE: Stop loss must be strictly positive' };
    }
    const distance = Math.abs(entryPrice - stopLoss);
    if (distance <= 1e-7 || entryPrice === stopLoss) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_RISK_DISTANCE' };
    }
    return { riskPerUnit: Number(distance.toFixed(4)), isValid: true, error: null };
  }

  /**
   * Deterministic calculation: R:R Validation
   * For LONG: risk = ABS(entry - stopLoss), reward = ABS(target - entry), RR = reward / risk
   * For SHORT: risk = ABS(entry - stopLoss), reward = ABS(entry - target), RR = reward / risk
   */
  static calculateRewardToRisk(
    entry: number,
    stopLoss: number,
    target: number,
    direction: 'LONG' | 'SHORT' = 'LONG'
  ): {
    risk: number;
    reward: number;
    rr: number;
    isValid: boolean;
    error: string | null;
  } {
    if (entry <= 0 || stopLoss <= 0 || target <= 0) {
      return { risk: 0, reward: 0, rr: 0, isValid: false, error: 'INVALID_PRICES' };
    }
    const risk = Math.abs(entry - stopLoss);
    const reward = direction === 'SHORT' ? Math.abs(entry - target) : Math.abs(target - entry);

    if (risk <= 1e-7 || reward <= 1e-7) {
      return { risk: 0, reward: 0, rr: 0, isValid: false, error: 'ZERO_RISK_OR_REWARD' };
    }

    const rr = Number((reward / risk).toFixed(2));
    return {
      risk: Number(risk.toFixed(4)),
      reward: Number(reward.toFixed(4)),
      rr,
      isValid: true,
      error: null,
    };
  }

  /**
   * Deterministic calculation: Maximum Daily Loss
   * maximumDailyLoss = dailyStartingEquity * maximumDailyLossPercent / 100
   * If dailyPnL <= -maximumDailyLoss -> DAILY_LOSS_LIMIT_REACHED
   */
  static calculateDailyLoss(
    dailyStartingEquity: number,
    currentEquity: number,
    maximumDailyLossPercent: number
  ): {
    dailyLossLimit: number;
    dailyLossAmount: number;
    dailyLossPercent: number;
    isLimitReached: boolean;
  } {
    const refEquity = dailyStartingEquity > 0 ? dailyStartingEquity : 1_000_000;
    const dailyLossLimit = Number(((refEquity * maximumDailyLossPercent) / 100).toFixed(2));
    const dailyPnL = currentEquity - refEquity;
    const isLimitReached = dailyPnL <= -dailyLossLimit;
    const dailyLossAmount = Math.max(0, -dailyPnL);
    const dailyLossPercent = Number(((dailyLossAmount / refEquity) * 100).toFixed(2));

    return {
      dailyLossLimit,
      dailyLossAmount,
      dailyLossPercent,
      isLimitReached,
    };
  }

  /**
   * Deterministic calculation: Maximum Drawdown
   * drawdownAmount = peakEquity - currentEquity
   * drawdownPercent = (drawdownAmount / peakEquity) * 100
   * If drawdownPercent >= maximumDrawdownPercent -> MAX_DRAWDOWN_REACHED
   */
  static calculateDrawdown(
    peakEquity: number,
    currentEquity: number,
    maximumDrawdownPercent: number
  ): {
    drawdownAmount: number;
    drawdownPercent: number;
    isLimitReached: boolean;
  } {
    const peak = peakEquity > 0 ? peakEquity : currentEquity;
    const drawdownAmount = Math.max(0, peak - currentEquity);
    const drawdownPercent = peak > 0 ? Number(((drawdownAmount / peak) * 100).toFixed(2)) : 0;
    const isLimitReached = drawdownPercent >= maximumDrawdownPercent;

    return {
      drawdownAmount: Number(drawdownAmount.toFixed(2)),
      drawdownPercent,
      isLimitReached,
    };
  }

  /**
   * Pure deterministic decision evaluation:
   * Returns:
   * - ALLOWED
   * - BLOCKED_DAILY_LOSS
   * - BLOCKED_MAX_DRAWDOWN
   * - BLOCKED_MAX_POSITIONS
   * - BLOCKED_PAPER_DISABLED
   * - BLOCKED_INVALID_RR
   * - BLOCKED_INVALID_RISK
   */
  evaluateOrderEligibility(
    setup: SetupRecord,
    account: PaperAccount,
    openPositionsCount: number
  ): RiskEvaluationResult {
    const isEnabled = Boolean(account.paperTradingEnabled ?? account.isTradingEnabled ?? false);
    const minRR = this.config.minimumRR ?? this.config.minRiskReward ?? 2.0;
    const maxDailyLossPct = this.config.maximumDailyLossPercent ?? this.config.maxDailyLossPercent ?? 3.0;
    const maxDrawdownPct = this.config.maximumDrawdownPercent ?? this.config.maxAccountDrawdownPercent ?? 10.0;
    const maxPositions = this.config.maxOpenPositions ?? 3;
    const riskPct = this.config.riskPerTradePercent ?? 1.0;

    // 1. Paper trading enabled check
    if (!isEnabled) {
      return {
        isEligible: false,
        decision: 'BLOCKED_PAPER_DISABLED',
        rejectionReason: 'PAPER_TRADING_DISABLED',
        rejectionDetails: 'Paper trading is currently disabled. User must explicitly enable PAPER TRADING.',
        sizing: null,
      };
    }

    // 2. Daily loss limit check
    const dailyRef = account.dailyStartingEquity || account.initialCapital || 1_000_000;
    const dailyLossEval = RiskEngine.calculateDailyLoss(dailyRef, account.currentEquity, maxDailyLossPct);
    if (dailyLossEval.isLimitReached) {
      return {
        isEligible: false,
        decision: 'BLOCKED_DAILY_LOSS',
        rejectionReason: 'DAILY_LOSS_LIMIT_REACHED',
        rejectionDetails: `Daily loss limit reached (${dailyLossEval.dailyLossPercent}% >= ${maxDailyLossPct}%). BLOCKED_DAILY_LOSS.`,
        sizing: null,
      };
    }

    // 3. Maximum account drawdown check
    const peak = account.peakEquity || account.initialCapital || 1_000_000;
    const ddEval = RiskEngine.calculateDrawdown(peak, account.currentEquity, maxDrawdownPct);
    if (ddEval.isLimitReached) {
      return {
        isEligible: false,
        decision: 'BLOCKED_MAX_DRAWDOWN',
        rejectionReason: 'MAX_DRAWDOWN_REACHED',
        rejectionDetails: `Maximum account drawdown limit reached (${ddEval.drawdownPercent}% >= ${maxDrawdownPct}%). BLOCKED_MAX_DRAWDOWN.`,
        sizing: null,
      };
    }

    // 4. Maximum open positions count check
    if (openPositionsCount >= maxPositions) {
      return {
        isEligible: false,
        decision: 'BLOCKED_MAX_POSITIONS',
        rejectionReason: 'POSITION_LIMIT_REACHED',
        rejectionDetails: `Maximum open positions limit of ${maxPositions} reached (Current: ${openPositionsCount}).`,
        sizing: null,
      };
    }

    // 5. Risk distance validity check
    const entryPrice = setup.risk.entryReference ?? 0;
    const stopLossPrice = setup.risk.stopLossReference ?? 0;
    const targetPrice = setup.risk.targetReference ?? 0;
    const tradeDirection: 'LONG' | 'SHORT' = setup.direction === 'BULLISH' ? 'LONG' : 'SHORT';

    const riskDistanceEval = RiskEngine.calculateRiskPerUnit(entryPrice, stopLossPrice);
    if (!riskDistanceEval.isValid) {
      return {
        isEligible: false,
        decision: 'BLOCKED_INVALID_RISK',
        rejectionReason: 'INVALID_RISK',
        rejectionDetails: riskDistanceEval.error || 'INVALID_RISK_DISTANCE',
        sizing: null,
      };
    }

    // 6. Minimum R:R ratio check
    const rrEval = RiskEngine.calculateRewardToRisk(
      entryPrice,
      stopLossPrice,
      targetPrice,
      tradeDirection
    );
    if (!rrEval.isValid || rrEval.rr < minRR) {
      return {
        isEligible: false,
        decision: 'BLOCKED_INVALID_RR',
        rejectionReason: 'RR_BELOW_MINIMUM',
        rejectionDetails: `Setup R:R ratio (${rrEval.rr}) is below minimum requirement of ${minRR.toFixed(2)}.`,
        sizing: null,
      };
    }

    // 7. Setup status check
    if (setup.status !== 'VALIDATED_CANDIDATE' || setup.validation?.isInvalidated) {
      return {
        isEligible: false,
        decision: 'BLOCKED_INVALID_RISK',
        rejectionReason: 'NO_VALIDATED_SETUP',
        rejectionDetails: `Setup status ${setup.status} is not eligible for execution.`,
        sizing: null,
      };
    }

    // 8. Deterministic position sizing & contract specification check
    const sizing = PositionSizer.calculate({
      currentEquity: account.currentEquity,
      riskPercent: riskPct,
      entryPrice: entryPrice,
      stopLossPrice: stopLossPrice,
      symbol: setup.symbol,
      riskConfig: this.config,
    });

    if (!sizing.isValid) {
      return {
        isEligible: false,
        decision: 'BLOCKED_INVALID_RISK',
        rejectionReason: sizing.rejectionReason,
        rejectionDetails: sizing.error,
        sizing,
      };
    }

    return {
      isEligible: true,
      decision: 'ALLOWED',
      rejectionReason: null,
      rejectionDetails: null,
      sizing,
    };
  }
}

// Alias for seamless backward compatibility
export class RiskManager extends RiskEngine {}

export const riskEngine = new RiskEngine();
export const riskManager = new RiskManager();
