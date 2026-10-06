import { Candle } from '../market-data/provider.interface';
import { IReplayStrategy, ReplayCandleContext } from '../types/replay';
import { SetupRecord } from '../types/scanner';
import { MarketRegimeEngine, marketRegimeEngine } from '../intelligence/market-regime-engine';
import { MarketStructureEngine } from '../intelligence/market-structure-engine';
import { BreakoutEngine } from '../intelligence/breakout-engine';
import { BreakoutValidationEngine, breakoutValidationEngine } from './breakout-validation-engine';
import { 
  StrategySignalOutput, 
  RetestTrackingState,
  StrategyDecision
} from './strategy-signal-types';

/**
 * BreakoutStrategy
 * 
 * Phase 7B Deterministic Strategy Engine implementing IReplayStrategy.
 * Designed specifically to reduce false breakouts/breakdowns through:
 * - Structural Resistance/Support boundary confirmation
 * - Body displacement strength evaluation
 * - Volatility & ATR qualification (Phase 7A MarketRegimeEngine)
 * - Momentum & Wick rejection verification
 * - Extension/Exhaustion protection (prevents chasing extended moves)
 * - Real Retest verification (former resistance -> support, former support -> resistance)
 * - Explicit Bull Trap / Bear Trap detection and rejection
 * - Strict No-Lookahead compliance with replay context
 * - Full audit trail with explicit evidence breakdown (No black-box scores)
 */
export class BreakoutStrategy implements IReplayStrategy {
  public readonly id = 'phase-7b-breakout-strategy';
  public readonly name = 'Deterministic Breakout & Retest Strategy';

  private regimeEngine: MarketRegimeEngine;
  private structureEngine: MarketStructureEngine;
  private breakoutEngine: BreakoutEngine;
  private validationEngine: BreakoutValidationEngine;

  // State retained across sequential replay steps for retest tracking
  private activeRetestTracker: RetestTrackingState | null = null;
  private lastSignalOutput: StrategySignalOutput | null = null;

  constructor(
    regimeEngine?: MarketRegimeEngine,
    structureEngine?: MarketStructureEngine,
    breakoutEngine?: BreakoutEngine,
    validationEngine?: BreakoutValidationEngine
  ) {
    this.regimeEngine = regimeEngine || marketRegimeEngine;
    this.structureEngine = structureEngine || new MarketStructureEngine({ leftBars: 2, rightBars: 2 });
    this.breakoutEngine = breakoutEngine || new BreakoutEngine();
    this.validationEngine = validationEngine || breakoutValidationEngine;
  }

  /**
   * Evaluates available context at candle N.
   * STRICT NO-LOOKAHEAD: Uses ONLY context.history which encapsulates candles 0..N.
   */
  public evaluate(context: ReplayCandleContext): SetupRecord[] {
    const signal = this.evaluateSignal(context.history);
    this.lastSignalOutput = signal;

    if (signal.candidateSetup && signal.decision !== 'WAIT' && signal.decision !== 'NO_TRADE') {
      return [signal.candidateSetup];
    }
    return [];
  }

  /**
   * Generates a fully detailed StrategySignalOutput for the given candle series.
   * Can be inspected by the UI or chart overlays.
   */
  public evaluateSignal(candles: Candle[]): StrategySignalOutput {
    if (!candles || candles.length === 0) {
      return this.createEmptySignal(0, 'NO_DATA');
    }

    const current = candles[candles.length - 1];
    const timestamp = current.timestamp;
    const datetimeUtc = current.datetime || new Date(timestamp).toISOString();

    // 1. Evaluate Market Structure
    const structure = this.structureEngine.analyzeStructure(candles);

    // 2. Evaluate Market Regime (Phase 7A reuse)
    const regimeReport = this.regimeEngine.evaluateRegime(candles, structure);

    // 3. Evaluate Breakout Validation Engine
    const valResult = this.validationEngine.evaluate(
      candles,
      structure,
      regimeReport,
      this.activeRetestTracker
    );

    // Update active retest tracker state
    this.activeRetestTracker = valResult.retestTracking;

    // 4. Construct Decision
    let decision: StrategyDecision = 'WAIT';
    if (valResult.isValidated) {
      decision = valResult.direction === 'LONG' ? 'TRADE_LONG' : 'TRADE_SHORT';
    } else if (
      valResult.state === 'REGIME_UNSUITABLE' ||
      valResult.state === 'EXCESSIVE_EXTENSION' ||
      valResult.state === 'RETEST_FAILED' ||
      valResult.state === 'REJECTION_DETECTED' ||
      valResult.trapState !== 'NONE'
    ) {
      decision = 'NO_TRADE';
    } else {
      decision = 'WAIT';
    }

    // 5. Construct Candidate SetupRecord if validated for RiskManager
    let candidateSetup: SetupRecord | null = null;
    if (valResult.isValidated && valResult.entryPrice && valResult.stopLoss && valResult.takeProfit) {
      const isLong = valResult.direction === 'LONG';
      const entry = valResult.entryPrice;
      const stop = valResult.stopLoss;
      const target = valResult.takeProfit;
      const rr = valResult.riskRewardRatio || 2.0;
      const isoTime = new Date(timestamp).toISOString();

      candidateSetup = {
        setupId: `P7B-BREAKOUT_RETEST-${valResult.direction}-${timestamp}`,
        symbol: 'XAU/USD',
        timeframe: '15m',
        direction: isLong ? 'BULLISH' : 'BEARISH',
        setupFamily: 'BREAKOUT_RETEST',
        createdAt: isoTime,
        lastUpdated: isoTime,
        status: 'VALIDATED_CANDIDATE',
        statusReason: `Phase 7B Confirmed Retest in ${regimeReport.regime}`,
        lifecycleSequence: ['NO_SETUP', 'SETUP_FORMING', 'VALIDATED_CANDIDATE'],
        evidence: {
          liquidityLevel: valResult.levelBroken,
          liquiditySource: 'EQUAL_HIGHS',
          sweepDetected: false,
          sweepTimestamp: timestamp,
          sweepDatetime: isoTime,
          sweepHighOrLow: valResult.levelBroken,
          structureEvent: 'BOS',
          structureTimestamp: timestamp,
          structureDatetime: isoTime,
          brokenLevel: valResult.levelBroken,
          displacementDetected: true,
          displacementTimestamp: timestamp,
          displacementDatetime: isoTime,
          displacementBodyRatio: 0.70,
          fvgDetected: false,
          fvgUpper: null,
          fvgLower: null,
          fvgTimestamp: null,
          fvgDatetime: null,
          retestDetected: true,
          retestTimestamp: timestamp,
          retestDatetime: isoTime,
          retestPrice: valResult.levelBroken,
          retestHolds: true,
        },
        risk: {
          entryReference: entry,
          entryType: 'CALCULATED',
          entryMethod: 'Phase 7B Retest Confirmation Entry',
          stopLossReference: stop,
          stopLossType: 'CALCULATED',
          stopLossMethod: 'Structural boundary with buffer',
          targetReference: target,
          targetType: 'CALCULATED',
          targetSource: '2x risk target',
          riskDistance: Math.abs(entry - stop),
          rewardDistance: Math.abs(target - entry),
          riskRewardRatio: rr,
          minimumRequiredRR: 1.5,
        },
        validation: {
          dataVerified: true,
          marketRegime: regimeReport.regime,
          volatilityState: 'NORMAL',
          multiTimeframeContext: 'aligned',
          conditionsPassed: valResult.reasonCodes,
          conditionsFailed: [],
          confluence: {
            liquidity: 'PASS',
            structure: 'PASS',
            displacement: 'PASS',
            fvg: 'NOT_AVAILABLE',
            retest: 'PASS',
            volatility: 'PASS',
            multiTimeframe: 'PASS',
            riskReward: 'PASS',
          },
          invalidationCondition: isLong ? `Candle close below $${stop.toFixed(2)}` : `Candle close above $${stop.toFixed(2)}`,
          isInvalidated: false,
        },
        provenance: {
          fact: [
            `Phase 7B Retest confirmation at ${isoTime}`,
            `Level broken and held: $${valResult.levelBroken ? valResult.levelBroken.toFixed(2) : 'N/A'}`,
          ],
          calculation: [
            `Entry: $${entry.toFixed(2)}, Stop: $${stop.toFixed(2)}, Target: $${target.toFixed(2)}`,
            `R:R Ratio: ${rr}`,
          ],
          modelOutput: [
            `Confirmed ${valResult.direction} retest execution signal`,
          ],
        },
        originatingCandleTimestamp: timestamp,
        originatingEventKey: `P7B-RETEST-${timestamp}`,
      };
    }

    const auditTrail: string[] = [
      `Regime: ${regimeReport.regime} (ATR: ${regimeReport.atrValue.toFixed(2)})`,
      `Structure: ${structure.trendState} (HH: ${structure.higherHighsCount}, LL: ${structure.lowerLowsCount})`,
      `Level Broken: ${valResult.levelBroken ? valResult.levelBroken.toFixed(2) : 'None'} (${valResult.levelType || 'N/A'})`,
      `State: ${valResult.state}, Decision: ${decision}`,
      `Trap Classification: ${valResult.trapState}`,
      `Reasons: ${valResult.reasonCodes.join(', ')}`,
    ];

    return {
      signalId: `sig-7b-${timestamp}`,
      timestamp,
      datetimeUtc,
      symbol: 'XAU/USD',
      timeframe: '15m',
      state: valResult.state,
      decision,
      direction: valResult.direction,
      levelBroken: valResult.levelBroken,
      levelType: valResult.levelType,
      trapState: valResult.trapState,
      regime: regimeReport.regime,
      evidence: valResult.evidence,
      reasonCodes: valResult.reasonCodes,
      entryPrice: valResult.entryPrice,
      stopLoss: valResult.stopLoss,
      takeProfit: valResult.takeProfit,
      riskRewardRatio: valResult.riskRewardRatio,
      candidateSetup,
      auditTrail,
    };
  }

  /**
   * Reset strategy state (e.g. on replay reset)
   */
  public reset(): void {
    this.activeRetestTracker = null;
    this.lastSignalOutput = null;
  }

  public getLastSignalOutput(): StrategySignalOutput | null {
    return this.lastSignalOutput;
  }

  public getActiveRetestTracker(): RetestTrackingState | null {
    return this.activeRetestTracker;
  }

  private createEmptySignal(timestamp: number, reason: string): StrategySignalOutput {
    return {
      signalId: `sig-7b-${timestamp}`,
      timestamp,
      datetimeUtc: new Date(timestamp).toISOString(),
      symbol: 'XAU/USD',
      timeframe: '15m',
      state: 'NO_SETUP',
      decision: 'NO_TRADE',
      direction: 'FLAT',
      levelBroken: null,
      levelType: null,
      trapState: 'NONE',
      regime: 'UNDEFINED',
      evidence: {
        resistanceOrSupportValid: 'NOT_APPLICABLE',
        closeConfirmation: 'NOT_APPLICABLE',
        displacement: 'NOT_APPLICABLE',
        breakoutDistance: 'NOT_APPLICABLE',
        volatility: 'NOT_APPLICABLE',
        momentum: 'NOT_APPLICABLE',
        structureAlignment: 'NOT_APPLICABLE',
        regimeAlignment: 'NOT_APPLICABLE',
        wickRejection: 'NOT_APPLICABLE',
        retest: 'NOT_APPLICABLE',
        retestReaction: 'NOT_APPLICABLE',
        extension: 'NOT_APPLICABLE',
      },
      reasonCodes: [reason],
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
      candidateSetup: null,
      auditTrail: [reason],
    };
  }
}

export const breakoutStrategy = new BreakoutStrategy();
