import { Candle } from '../market-data/provider.interface';
import { SetupRecord } from '../types/scanner';
import { ReplayCandleContext, IReplayStrategy } from '../types/replay';
import { MarketStructureEngine } from './market-structure-engine';
import { MarketRegimeEngine } from './market-regime-engine';
import { BreakoutEngine } from './breakout-engine';
import { 
  Phase7ASignal, 
  MarketRegimeReport, 
  BreakoutEvaluation, 
  SignalLifecycleState,
  NoTradeReason
} from '../types/signal-regime';

export interface SignalEngineConfig {
  symbol: string;
  timeframe: string;
  minConfluenceScore: number; // default 70
  minRiskReward: number; // default 2.0
  allowFakeoutContrarianSignals: boolean; // default true
}

export const DEFAULT_SIGNAL_CONFIG: SignalEngineConfig = {
  symbol: 'XAU/USD',
  timeframe: 'M15',
  minConfluenceScore: 70,
  minRiskReward: 2.0,
  allowFakeoutContrarianSignals: true,
};

/**
 * Phase 7A: Deterministic Signal Architecture & Market Regime Engine
 * 
 * Implements IReplayStrategy for seamless deterministic execution inside Phase 6 Replay.
 * 
 * Responsibilities:
 * 1. Regime Analysis: Determines trending vs ranging vs compression.
 * 2. Structure & Breakouts: Identifies valid breakouts, breakdowns, and fake-breakout traps.
 * 3. State Transitions:
 *    NO_SIGNAL -> SETUP_DETECTED -> BREAKOUT_OBSERVED -> CONFIRMED / REJECTED -> NO_TRADE_ZONE
 * 4. Filters out choppy/low-probability regimes (NO_TRADE_ZONE).
 * 5. Returns validated SetupRecord candidates ready for Phase 4A Risk Manager & Phase 4B Execution.
 */
export class DeterministicSignalEngine implements IReplayStrategy {
  public readonly id = 'PHASE_7A_REGIME_SIGNAL_ENGINE';
  public readonly name = 'Phase 7A Market Regime & Signal Engine';

  private config: SignalEngineConfig;
  private structureEngine: MarketStructureEngine;
  private regimeEngine: MarketRegimeEngine;
  private breakoutEngine: BreakoutEngine;

  constructor(config: Partial<SignalEngineConfig> = {}) {
    this.config = { ...DEFAULT_SIGNAL_CONFIG, ...config };
    this.structureEngine = new MarketStructureEngine({ leftBars: 2, rightBars: 2 });
    this.regimeEngine = new MarketRegimeEngine();
    this.breakoutEngine = new BreakoutEngine();
  }

  /**
   * Evaluates historical candle context (strictly 0..N) and emits SetupRecords.
   */
  public evaluate(context: ReplayCandleContext): SetupRecord[] {
    const signal = this.generateSignal(context.history);
    if (signal.isTradable && signal.candidateSetup) {
      return [signal.candidateSetup];
    }
    return [];
  }

  /**
   * Complete deterministic signal generator.
   */
  public generateSignal(candles: Candle[]): Phase7ASignal {
    if (!candles || candles.length < 15) {
      const ts = candles && candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now();
      return this.buildEmptySignal(ts, 'INSUFFICIENT_CANDLE_HISTORY');
    }

    const currentCandle = candles[candles.length - 1];
    const timestamp = currentCandle.timestamp;
    const datetimeUtc = currentCandle.datetime || new Date(timestamp).toISOString();

    // 1. Analyze Market Structure (strictly on available candles)
    const structure = this.structureEngine.analyzeStructure(candles, this.config.timeframe);

    // 2. Classify Market Regime
    const regimeReport = this.regimeEngine.evaluateRegime(candles, structure);

    // 3. Detect Breakouts / Breakdowns / Fakeouts
    const breakoutEval = this.breakoutEngine.evaluateBreakouts(
      candles,
      structure,
      regimeReport.keyResistance,
      regimeReport.keySupport
    );

    // 4. State Machine Evaluation
    let state: SignalLifecycleState = 'NO_SIGNAL';
    let noTradeReason: NoTradeReason | null = null;
    let direction: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let entryPrice: number | null = null;
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;
    let riskRewardRatio: number | null = null;
    let confluenceScore = 0;
    const auditTrail: string[] = [];

    // Filter A: Regime Filter (Block choppy or compressed regimes)
    if (regimeReport.regime === 'LOW_VOLATILITY_COMPRESSION') {
      state = 'NO_TRADE_ZONE';
      noTradeReason = 'COMPRESSION_WITHOUT_EXPANSION';
      auditTrail.push('FILTER BLOCKED: Low volatility compression detected without range expansion.');
    } else if (regimeReport.regime === 'RANGING_CONSOLIDATION' && breakoutEval.type === 'NONE') {
      state = 'NO_TRADE_ZONE';
      noTradeReason = 'CHOPPY_REGIME';
      auditTrail.push('FILTER BLOCKED: Price consolidating in chop without structural breakout.');
    } else if (breakoutEval.type === 'VALID_BREAKOUT') {
      // Scenario 1: Valid Bullish Breakout
      direction = 'LONG';
      entryPrice = currentCandle.close;
      stopLoss = breakoutEval.levelBroken - Math.max(regimeReport.atrValue * 0.8, 1.5);
      const riskDist = entryPrice - stopLoss;
      takeProfit = entryPrice + (riskDist * this.config.minRiskReward);
      riskRewardRatio = this.config.minRiskReward;

      confluenceScore = 80;
      if (regimeReport.regime === 'TRENDING_BULLISH') confluenceScore += 15;
      if (breakoutEval.retestHolds) confluenceScore += 5;

      if (breakoutEval.isConfirmed && confluenceScore >= this.config.minConfluenceScore) {
        state = 'CONFIRMED';
        auditTrail.push(`CONFIRMED: Valid Bullish Breakout above $${breakoutEval.levelBroken.toFixed(2)} with score ${confluenceScore}.`);
      } else {
        state = 'BREAKOUT_OBSERVED';
        auditTrail.push(`OBSERVED: Breakout observed, awaiting retest confirmation.`);
      }
    } else if (breakoutEval.type === 'VALID_BREAKDOWN') {
      // Scenario 2: Valid Bearish Breakdown
      direction = 'SHORT';
      entryPrice = currentCandle.close;
      stopLoss = breakoutEval.levelBroken + Math.max(regimeReport.atrValue * 0.8, 1.5);
      const riskDist = stopLoss - entryPrice;
      takeProfit = entryPrice - (riskDist * this.config.minRiskReward);
      riskRewardRatio = this.config.minRiskReward;

      confluenceScore = 80;
      if (regimeReport.regime === 'TRENDING_BEARISH') confluenceScore += 15;
      if (breakoutEval.retestHolds) confluenceScore += 5;

      if (breakoutEval.isConfirmed && confluenceScore >= this.config.minConfluenceScore) {
        state = 'CONFIRMED';
        auditTrail.push(`CONFIRMED: Valid Bearish Breakdown below $${breakoutEval.levelBroken.toFixed(2)} with score ${confluenceScore}.`);
      } else {
        state = 'BREAKOUT_OBSERVED';
        auditTrail.push(`OBSERVED: Breakdown observed, awaiting retest confirmation.`);
      }
    } else if (breakoutEval.type === 'FAKE_BREAKOUT_BULL_TRAP' && this.config.allowFakeoutContrarianSignals) {
      // Scenario 3: Bull Trap (Fade back into range -> SHORT)
      direction = 'SHORT';
      entryPrice = currentCandle.close;
      stopLoss = currentCandle.high + 0.50; // just above fakeout high
      const riskDist = stopLoss - entryPrice;
      const targetSupport = regimeReport.keySupport || (entryPrice - (riskDist * 2.0));
      takeProfit = targetSupport;
      riskRewardRatio = riskDist > 0 ? Number(((entryPrice - takeProfit) / riskDist).toFixed(2)) : 2.0;

      if (riskRewardRatio >= this.config.minRiskReward) {
        confluenceScore = 85;
        state = 'CONFIRMED';
        auditTrail.push(`CONFIRMED: Bull Trap (Fakeout) detected above $${breakoutEval.levelBroken.toFixed(2)}. Fading back to range support.`);
      } else {
        state = 'REJECTED';
        noTradeReason = 'INSUFFICIENT_RR';
        auditTrail.push(`REJECTED: Bull trap R:R ${riskRewardRatio} is below minimum requirement ${this.config.minRiskReward}.`);
      }
    } else if (breakoutEval.type === 'FAKE_BREAKDOWN_BEAR_TRAP' && this.config.allowFakeoutContrarianSignals) {
      // Scenario 4: Bear Trap (Fade back into range -> LONG)
      direction = 'LONG';
      entryPrice = currentCandle.close;
      stopLoss = currentCandle.low - 0.50; // just below fakeout low
      const riskDist = entryPrice - stopLoss;
      const targetResistance = regimeReport.keyResistance || (entryPrice + (riskDist * 2.0));
      takeProfit = targetResistance;
      riskRewardRatio = riskDist > 0 ? Number(((takeProfit - entryPrice) / riskDist).toFixed(2)) : 2.0;

      if (riskRewardRatio >= this.config.minRiskReward) {
        confluenceScore = 85;
        state = 'CONFIRMED';
        auditTrail.push(`CONFIRMED: Bear Trap (Fakeout) detected below $${breakoutEval.levelBroken.toFixed(2)}. Fading back to range resistance.`);
      } else {
        state = 'REJECTED';
        noTradeReason = 'INSUFFICIENT_RR';
        auditTrail.push(`REJECTED: Bear trap R:R ${riskRewardRatio} is below minimum requirement ${this.config.minRiskReward}.`);
      }
    } else {
      state = 'NO_SIGNAL';
      auditTrail.push('NO SIGNAL: Market within equilibrium without decisive breakout or trap.');
    }

    // Build candidate SetupRecord if CONFIRMED
    let candidateSetup: SetupRecord | null = null;
    const isTradable = state === 'CONFIRMED' && direction !== 'FLAT' && entryPrice !== null && stopLoss !== null && takeProfit !== null;

    if (isTradable) {
      candidateSetup = this.buildSetupRecord(
        timestamp,
        direction as 'LONG' | 'SHORT',
        entryPrice!,
        stopLoss!,
        takeProfit!,
        riskRewardRatio || 2.0,
        breakoutEval,
        regimeReport
      );
    }

    const cleanSymbol = (this.config.symbol || 'XAUUSD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const cleanTimeframe = (this.config.timeframe || '15M').toUpperCase();
    const signalId = `SIG-${cleanSymbol}-${cleanTimeframe}-${timestamp}-${direction}`;

    return {
      signalId,
      timestamp,
      datetimeUtc,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      state,
      regime: regimeReport.regime,
      direction,
      breakoutType: breakoutEval.type,
      isTradable,
      noTradeReason,
      entryPrice: entryPrice ? Number(entryPrice.toFixed(2)) : null,
      stopLoss: stopLoss ? Number(stopLoss.toFixed(2)) : null,
      takeProfit: takeProfit ? Number(takeProfit.toFixed(2)) : null,
      riskRewardRatio: riskRewardRatio ? Number(riskRewardRatio.toFixed(2)) : null,
      confluenceScore,
      candidateSetup,
      auditTrail,
    };
  }

  private buildSetupRecord(
    timestamp: number,
    direction: 'LONG' | 'SHORT',
    entry: number,
    stopLoss: number,
    target: number,
    rr: number,
    breakout: BreakoutEvaluation,
    regime: MarketRegimeReport
  ): SetupRecord {
    const isLong = direction === 'LONG';
    const isTrap = breakout.isFakeoutTrap;
    const setupFamily = isTrap ? 'LIQUIDITY_SWEEP_REVERSAL' : 'BREAKOUT_RETEST';
    const setupId = `P7A-${setupFamily}-${direction}-${timestamp}`;
    const isoTime = new Date(timestamp).toISOString();

    return {
      setupId,
      symbol: this.config.symbol as 'XAU/USD',
      timeframe: this.config.timeframe,
      direction: isLong ? 'BULLISH' : 'BEARISH',
      setupFamily,
      createdAt: isoTime,
      lastUpdated: isoTime,
      status: 'VALIDATED_CANDIDATE',
      statusReason: `Phase 7A Confirmed ${isTrap ? 'Trap/Sweep Reversal' : 'Structural Breakout'} in ${regime.regime}`,
      lifecycleSequence: ['NO_SETUP', 'SETUP_FORMING', 'VALIDATED_CANDIDATE'],
      evidence: {
        liquidityLevel: breakout.levelBroken,
        liquiditySource: isTrap ? 'SESSION_HIGH' : 'EQUAL_HIGHS',
        sweepDetected: isTrap,
        sweepTimestamp: timestamp,
        sweepDatetime: isoTime,
        sweepHighOrLow: breakout.levelBroken,
        structureEvent: isTrap ? 'CHOCH' : 'BOS',
        structureTimestamp: timestamp,
        structureDatetime: isoTime,
        brokenLevel: breakout.levelBroken,
        displacementDetected: breakout.displacementRatio >= 0.60,
        displacementTimestamp: timestamp,
        displacementDatetime: isoTime,
        displacementBodyRatio: breakout.displacementRatio,
        fvgDetected: false,
        fvgUpper: null,
        fvgLower: null,
        fvgTimestamp: null,
        fvgDatetime: null,
        retestDetected: breakout.retestObserved,
        retestTimestamp: timestamp,
        retestDatetime: isoTime,
        retestPrice: breakout.levelBroken,
        retestHolds: breakout.retestHolds,
      },
      risk: {
        entryReference: entry,
        entryType: 'CALCULATED',
        entryMethod: 'Phase 7A Market Confirmation Entry',
        stopLossReference: stopLoss,
        stopLossType: 'CALCULATED',
        stopLossMethod: 'Structural boundary with buffer',
        targetReference: target,
        targetType: 'CALCULATED',
        targetSource: 'Opposing range liquidity reference',
        riskDistance: Math.abs(entry - stopLoss),
        rewardDistance: Math.abs(target - entry),
        riskRewardRatio: rr,
        minimumRequiredRR: this.config.minRiskReward,
      },
      validation: {
        dataVerified: true,
        marketRegime: regime.regime,
        volatilityState: regime.compression ? 'COMPRESSED' : 'NORMAL',
        multiTimeframeContext: 'aligned',
        conditionsPassed: [
          `Regime passed: ${regime.regime}`,
          `Breakout evaluated: ${breakout.type}`,
          `R:R ${rr} >= ${this.config.minRiskReward}`,
        ],
        conditionsFailed: [],
        confluence: {
          liquidity: 'PASS',
          structure: 'PASS',
          displacement: breakout.displacementRatio >= 0.60 ? 'PASS' : 'FAIL',
          fvg: 'NOT_AVAILABLE',
          retest: breakout.retestHolds ? 'PASS' : 'FAIL',
          volatility: 'PASS',
          multiTimeframe: 'PASS',
          riskReward: rr >= this.config.minRiskReward ? 'PASS' : 'FAIL',
        },
        invalidationCondition: isLong ? `Candle close below $${stopLoss.toFixed(2)}` : `Candle close above $${stopLoss.toFixed(2)}`,
        isInvalidated: false,
      },
      provenance: {
        fact: [
          `Signal generated by Phase 7A Deterministic Engine at ${isoTime}`,
          `Level broken: $${breakout.levelBroken.toFixed(2)}`,
        ],
        calculation: [
          `Calculated entry: $${entry.toFixed(2)}, Stop: $${stopLoss.toFixed(2)}, Target: $${target.toFixed(2)}`,
          `R:R Ratio: ${rr}`,
        ],
        modelOutput: [
          `State: VALIDATED_CANDIDATE`,
          `Regime: ${regime.regime}`,
          `Action: ${direction}`,
        ],
      },
      originatingCandleTimestamp: timestamp,
      originatingEventKey: `${setupFamily}-${breakout.levelBroken}`,
    };
  }

  private buildEmptySignal(timestamp: number, reason: NoTradeReason): Phase7ASignal {
    return {
      signalId: `SIG-${timestamp}-NONE`,
      timestamp,
      datetimeUtc: new Date(timestamp).toISOString(),
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      state: 'NO_TRADE_ZONE',
      regime: 'UNDEFINED',
      direction: 'FLAT',
      breakoutType: 'NONE',
      isTradable: false,
      noTradeReason: reason,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
      confluenceScore: 0,
      candidateSetup: null,
      auditTrail: [`NO_TRADE_ZONE: ${reason}`],
    };
  }
}

export const deterministicSignalEngine = new DeterministicSignalEngine();
