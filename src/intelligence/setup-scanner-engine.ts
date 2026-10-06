import { Candle } from '../market-data/provider.interface';
import { 
  XauUsdMarketIntelligence, 
  LiquiditySweep, 
  StructureEvent, 
  DisplacementCandle, 
  FairValueGap, 
  LiquidityLevel,
  SwingPoint
} from '../types/intelligence';
import { 
  SetupRecord, 
  SetupState, 
  SetupDirection, 
  SetupFamily, 
  SetupConfluence, 
  ScannerConfig, 
  ScannerSummary,
  MultiTimeframeContext,
  ConfluenceResult,
  SetupProvenance,
  CurrentScannerState,
  CurrentSetupSnapshot
} from '../types/scanner';

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  minRiskReward: 2.0,
  maxLookbackBars: 50,
  maxRetestWaitBars: 20,
  sweepTolerancePips: 0.5,
  stopLossBufferUsd: 0.50, // 50 cents buffer beyond structural peak/trough for Gold
};

export class SetupScannerEngine {
  // Deterministic in-memory registry of known setups by setup ID
  private setupRegistry: Map<string, SetupRecord> = new Map();

  /**
   * Resets registry (primarily for deterministic testing or session reset)
   */
  public clearRegistry(): void {
    this.setupRegistry.clear();
  }

  /**
   * Returns all setups stored in the registry
   */
  public getRegistry(): SetupRecord[] {
    return Array.from(this.setupRegistry.values());
  }

  /**
   * Scans verified XAU/USD market intelligence and returns deterministic setup records
   */
  public scan(
    intel: XauUsdMarketIntelligence, 
    candles: Candle[], 
    config: Partial<ScannerConfig> = {}
  ): ScannerSummary {
    const finalConfig: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG, ...config };

    // Strict candle completeness check: only completed & verified candles can confirm setups
    const completedCandles = (candles || []).filter(c => 
      c.isVerified !== false && (c as { isComplete?: boolean }).isComplete !== false
    );

    if (!intel || intel.status !== 'VERIFIED' || completedCandles.length < 10) {
      const emptySnapshot: CurrentSetupSnapshot = {
        currentScannerState: 'INSUFFICIENT VERIFIED DATA',
        activeSetupId: null,
        setupFamily: null,
        timeframe: intel?.timeframe || 'M15',
        direction: null,
        entry: null,
        stopLoss: null,
        target: null,
        riskRewardRatio: null,
        confluenceComponents: this.getEmptyValidation('insufficient_data', '').confluence,
        lifecycleState: 'NO_SETUP',
        lastEvidenceTimestamp: null,
        lastEvidenceDatetime: null,
        statusReason: 'INSUFFICIENT VERIFIED DATA: Minimum 10 completed verified candles required',
        dataVerified: false,
      };

      return {
        symbol: 'XAU/USD',
        timeframe: intel?.timeframe || 'M15',
        status: 'INSUFFICIENT_DATA',
        currentScannerState: 'INSUFFICIENT VERIFIED DATA',
        currentSetup: {
          setupId: 'NONE',
          symbol: 'XAU/USD',
          timeframe: intel?.timeframe || 'M15',
          direction: 'BULLISH',
          setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          status: 'NO_SETUP',
          statusReason: 'NO SETUP: Insufficient verified market data (minimum 10 completed verified candles required)',
          lifecycleSequence: ['NO_SETUP'],
          evidence: this.getEmptyEvidence(),
          risk: this.getEmptyRisk(finalConfig.minRiskReward),
          validation: this.getEmptyValidation('insufficient_data', 'Insufficient verified tick data available'),
          provenance: {
            fact: [`Completed verified candles available: ${completedCandles.length} (minimum 10 required)`],
            calculation: [],
            modelOutput: ['INSUFFICIENT VERIFIED DATA'],
          },
          originatingCandleTimestamp: 0,
          originatingEventKey: 'NONE',
        },
        candidates: [],
        validatedCount: 0,
        formingCount: 0,
        watchCount: 0,
        invalidatedCount: 0,
        expiredCount: 0,
        scannedAt: new Date().toISOString(),
        minRiskRewardThreshold: finalConfig.minRiskReward,
        dataVerified: false,
        paperTradeCreated: false,
        activeSetupId: null,
        lastEvidenceTimestamp: null,
        snapshot: emptySnapshot,
      };
    }

    const multiTfContext = this.evaluateMultiTimeframeContext(intel);
    const rawCandidates: SetupRecord[] = [];

    // Scan Family A: LIQUIDITY SWEEP REVERSAL
    const sweepCandidates = this.scanLiquiditySweepReversals(intel, completedCandles, finalConfig, multiTfContext);
    rawCandidates.push(...sweepCandidates);

    // Scan Family B: BREAKOUT + RETEST
    const breakoutCandidates = this.scanBreakoutRetests(intel, completedCandles, finalConfig, multiTfContext);
    rawCandidates.push(...breakoutCandidates);

    // Strictly deduplicate candidates by setupId to guarantee unique keys across scanner
    const candidatesMap = new Map<string, SetupRecord>();
    for (const c of rawCandidates) {
      if (!candidatesMap.has(c.setupId)) {
        candidatesMap.set(c.setupId, c);
      }
    }
    const candidates: SetupRecord[] = Array.from(candidatesMap.values());

    // Check expiration for active setups in registry that are no longer triggering or whose window ended
    this.evaluateExpirations(completedCandles, finalConfig);

    // Sync candidates from registry records so updated states (such as EXPIRED) are reflected
    for (let i = 0; i < candidates.length; i++) {
      const reg = this.setupRegistry.get(candidates[i].setupId);
      if (reg) {
        candidates[i] = reg;
      }
    }

    // Count states
    let validatedCount = 0;
    let formingCount = 0;
    let watchCount = 0;
    let invalidatedCount = 0;
    let expiredCount = 0;

    for (const c of candidates) {
      if (c.status === 'VALIDATED_CANDIDATE') validatedCount++;
      else if (c.status === 'SETUP_FORMING') formingCount++;
      else if (c.status === 'WATCH') watchCount++;
      else if (c.status === 'INVALIDATED') invalidatedCount++;
      else if (c.status === 'EXPIRED') expiredCount++;
    }

    // Determine current active setup for display
    const validatedCandidate = candidates.find(c => c.status === 'VALIDATED_CANDIDATE');
    const formingCandidate = candidates.find(c => c.status === 'SETUP_FORMING');
    const watchCandidate = candidates.find(c => c.status === 'WATCH');
    const invalidatedCandidate = candidates.find(c => c.status === 'INVALIDATED');

    let currentSetup: SetupRecord | null = null;
    let currentScannerState: CurrentScannerState = 'NO_VALIDATED_SETUP';

    if (validatedCandidate) {
      currentSetup = validatedCandidate;
      currentScannerState = 'VALIDATED_CANDIDATE';
    } else if (formingCandidate) {
      currentSetup = formingCandidate;
      currentScannerState = 'SETUP_FORMING';
    } else if (watchCandidate) {
      currentSetup = watchCandidate;
      currentScannerState = 'WATCH';
    } else if (invalidatedCandidate && candidates.length > 0 && candidates.every(c => c.status === 'INVALIDATED' || c.status === 'EXPIRED')) {
      currentSetup = invalidatedCandidate;
      currentScannerState = 'INVALIDATED';
    } else {
      currentScannerState = 'NO_VALIDATED_SETUP';
      const primaryReason = candidates.length > 0 
        ? candidates[0].statusReason 
        : 'NO VALIDATED SETUP: Missing confirmed liquidity sweep and no structure breakout';
      currentSetup = {
        setupId: 'NO_ACTIVE_SETUP',
        symbol: 'XAU/USD',
        timeframe: intel.timeframe,
        direction: 'BULLISH',
        setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        status: 'NO_SETUP',
        statusReason: primaryReason,
        lifecycleSequence: ['NO_SETUP'],
        evidence: this.getEmptyEvidence(),
        risk: this.getEmptyRisk(finalConfig.minRiskReward),
        validation: this.getEmptyValidation(multiTfContext, primaryReason),
        provenance: {
          fact: [`Completed verified candles: ${completedCandles.length}`, 'Feed provider: Twelve Data'],
          calculation: [],
          modelOutput: ['State: NO_VALIDATED_SETUP', primaryReason],
        },
        originatingCandleTimestamp: 0,
        originatingEventKey: 'NONE',
      };
    }

    // Calculate last evidence timestamp
    let lastEvidenceTimestamp: number | null = null;
    if (currentSetup) {
      const e = currentSetup.evidence;
      const timestamps = [
        e.retestTimestamp,
        e.fvgTimestamp,
        e.displacementTimestamp,
        e.structureTimestamp,
        e.sweepTimestamp,
      ].filter((t): t is number => typeof t === 'number' && t > 0);
      if (timestamps.length > 0) {
        lastEvidenceTimestamp = Math.max(...timestamps);
      }
    }

    const snapshot: CurrentSetupSnapshot = {
      currentScannerState,
      activeSetupId: currentSetup?.setupId !== 'NO_ACTIVE_SETUP' && currentSetup?.setupId !== 'NONE' ? currentSetup.setupId : null,
      setupFamily: currentSetup?.status !== 'NO_SETUP' ? currentSetup.setupFamily : null,
      timeframe: intel.timeframe,
      direction: currentSetup?.status !== 'NO_SETUP' ? currentSetup.direction : null,
      entry: currentSetup?.risk.entryReference || null,
      stopLoss: currentSetup?.risk.stopLossReference || null,
      target: currentSetup?.risk.targetReference || null,
      riskRewardRatio: currentSetup?.risk.riskRewardRatio || null,
      confluenceComponents: currentSetup?.validation.confluence || this.getEmptyValidation(multiTfContext, '').confluence,
      lifecycleState: currentSetup?.status || 'NO_SETUP',
      lastEvidenceTimestamp,
      lastEvidenceDatetime: lastEvidenceTimestamp ? new Date(lastEvidenceTimestamp).toISOString() : null,
      statusReason: currentSetup?.statusReason || 'NO VALIDATED SETUP: Missing confirmed setup criteria',
      dataVerified: true,
    };

    return {
      symbol: 'XAU/USD',
      timeframe: intel.timeframe,
      status: validatedCount > 0 ? 'VALIDATED_CANDIDATES_FOUND' : 'NO_VALIDATED_SETUP',
      currentScannerState,
      currentSetup,
      candidates,
      validatedCount,
      formingCount,
      watchCount,
      invalidatedCount,
      expiredCount,
      scannedAt: new Date().toISOString(),
      minRiskRewardThreshold: finalConfig.minRiskReward,
      dataVerified: true,
      paperTradeCreated: false,
      activeSetupId: snapshot.activeSetupId,
      lastEvidenceTimestamp,
      snapshot,
    };
  }

  /**
   * Scans Family A: LIQUIDITY SWEEP REVERSAL
   */
  private scanLiquiditySweepReversals(
    intel: XauUsdMarketIntelligence,
    candles: Candle[],
    config: ScannerConfig,
    multiTfContext: MultiTimeframeContext
  ): SetupRecord[] {
    const results: SetupRecord[] = [];
    const sweeps = intel.liquiditySweeps || [];

    if (sweeps.length === 0) {
      return results;
    }

    // Evaluate each confirmed liquidity sweep (most recent first)
    const sortedSweeps = [...sweeps].sort((a, b) => b.sweepCandleTimestamp - a.sweepCandleTimestamp);

    const seenSweepIds = new Set<string>();
    for (let i = 0; i < sortedSweeps.length && results.length < 3; i++) {
      const sweep = sortedSweeps[i];
      const direction: SetupDirection = sweep.direction === 'BEARISH_SWEEP_OF_HIGHS' ? 'BEARISH' : 'BULLISH';
      const setupId = `SWEEP-REV-${direction}-${sweep.sweepCandleTimestamp}`;

      if (seenSweepIds.has(setupId)) {
        continue;
      }
      seenSweepIds.add(setupId);

      const conditionsPassed: string[] = ['Known liquidity level breached & closed inside (Sweep confirmed)'];
      const conditionsFailed: string[] = [];

      // 1. Structure Change (BOS or CHOCH in reversal direction)
      const matchingStructure = (intel.structureEvents || []).find(e => 
        e.direction === direction && 
        e.breakCandleTimestamp >= sweep.sweepCandleTimestamp
      );

      let structureConfluence: ConfluenceResult = 'FAIL';
      if (matchingStructure) {
        structureConfluence = 'PASS';
        conditionsPassed.push(`Structure change confirmed (${matchingStructure.type} ${direction} at $${matchingStructure.brokenLevel.toFixed(2)})`);
      } else {
        conditionsFailed.push(`Missing confirmed ${direction} structure change (BOS/CHOCH) post-sweep`);
      }

      // 2. Displacement in reversal direction
      const matchingDisplacement = (intel.displacements || []).find(d => 
        d.direction === direction && 
        d.timestamp >= sweep.sweepCandleTimestamp
      );

      let displacementConfluence: ConfluenceResult = 'FAIL';
      if (matchingDisplacement) {
        displacementConfluence = 'PASS';
        conditionsPassed.push(`Displacement confirmed (${matchingDisplacement.direction} body ${(matchingDisplacement.bodyToRangeRatio * 100).toFixed(0)}% of range)`);
      } else {
        conditionsFailed.push(`Missing displacement candle in ${direction} direction`);
      }

      // 3. FVG formed in reversal direction
      const matchingFvg = (intel.fairValueGaps || []).find(f => 
        f.direction === direction && 
        f.formationTimestamp >= sweep.sweepCandleTimestamp
      );

      let fvgConfluence: ConfluenceResult = 'FAIL';
      if (matchingFvg) {
        fvgConfluence = 'PASS';
        conditionsPassed.push(`Fair Value Gap confirmed ($${matchingFvg.lowerBoundary.toFixed(2)} - $${matchingFvg.upperBoundary.toFixed(2)})`);
      } else {
        conditionsFailed.push(`Missing Fair Value Gap in ${direction} direction post-sweep`);
      }

      // 4. Retest of FVG zone
      let retestDetected = false;
      let retestTimestamp: number | null = null;
      let retestDatetime: string | null = null;
      let retestPrice: number | null = null;
      let retestHolds = false;
      let isInvalidated = false;
      let invalidationReason: string | null = null;
      let invalidationTimestamp: number | null = null;

      // Stop loss beyond swept level + buffer
      let stopLossReference = direction === 'BEARISH'
        ? Number((sweep.sweepHighOrLow + config.stopLossBufferUsd).toFixed(2))
        : Number((sweep.sweepHighOrLow - config.stopLossBufferUsd).toFixed(2));

      // Entry reference at FVG touch
      let entryReference: number | null = null;
      if (matchingFvg) {
        entryReference = direction === 'BEARISH' 
          ? matchingFvg.lowerBoundary 
          : matchingFvg.upperBoundary;
      }

      // Target reference: Opposing structural liquidity
      const targetData = this.findOpposingTarget(intel, direction, entryReference || sweep.sweepHighOrLow);
      let targetReference = targetData.target;
      let targetSource = targetData.source;

      // Calculate R:R
      let riskDistance: number | null = null;
      let rewardDistance: number | null = null;
      let riskRewardRatio: number | null = null;
      let riskRewardConfluence: ConfluenceResult = 'FAIL';

      if (entryReference !== null && stopLossReference !== null && targetReference !== null) {
        riskDistance = Number(Math.abs(entryReference - stopLossReference).toFixed(2));
        rewardDistance = Number(Math.abs(targetReference - entryReference).toFixed(2));
        if (riskDistance > 0) {
          riskRewardRatio = Number((rewardDistance / riskDistance).toFixed(2));
          if (riskRewardRatio >= config.minRiskReward) {
            riskRewardConfluence = 'PASS';
            conditionsPassed.push(`R:R ${riskRewardRatio} >= ${config.minRiskReward}`);
          } else {
            conditionsFailed.push(`R:R ${riskRewardRatio} < ${config.minRiskReward} minimum requirement`);
          }
        }
      } else {
        conditionsFailed.push('Incomplete risk parameters (missing entry or opposing target)');
      }

      // Check candles subsequent to FVG for retest and invalidation
      if (matchingFvg) {
        const subsequentCandles = candles.filter(c => c.timestamp > matchingFvg.formationTimestamp);
        
        for (const bar of subsequentCandles) {
          // Invalidation check 1: Price closes beyond stop loss
          if (direction === 'BEARISH' && bar.close > stopLossReference) {
            isInvalidated = true;
            invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} beyond Stop Loss ($${stopLossReference})`;
            invalidationTimestamp = bar.timestamp;
            break;
          }
          if (direction === 'BULLISH' && bar.close < stopLossReference) {
            isInvalidated = true;
            invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} below Stop Loss ($${stopLossReference})`;
            invalidationTimestamp = bar.timestamp;
            break;
          }

          // Invalidation check 2: Price closes completely through FVG
          if (direction === 'BEARISH' && bar.close > matchingFvg.upperBoundary) {
            isInvalidated = true;
            invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} above FVG upper boundary ($${matchingFvg.upperBoundary.toFixed(2)})`;
            invalidationTimestamp = bar.timestamp;
            break;
          }
          if (direction === 'BULLISH' && bar.close < matchingFvg.lowerBoundary) {
            isInvalidated = true;
            invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} below FVG lower boundary ($${matchingFvg.lowerBoundary.toFixed(2)})`;
            invalidationTimestamp = bar.timestamp;
            break;
          }

          // Retest detection: price enters FVG
          if (!retestDetected) {
            if (direction === 'BEARISH' && bar.high >= matchingFvg.lowerBoundary) {
              retestDetected = true;
              retestTimestamp = bar.timestamp;
              retestDatetime = new Date(bar.timestamp).toISOString();
              retestPrice = bar.high;
              // Retest holds if close is back below or inside FVG
              retestHolds = bar.close <= matchingFvg.upperBoundary;
            } else if (direction === 'BULLISH' && bar.low <= matchingFvg.upperBoundary) {
              retestDetected = true;
              retestTimestamp = bar.timestamp;
              retestDatetime = new Date(bar.timestamp).toISOString();
              retestPrice = bar.low;
              retestHolds = bar.close >= matchingFvg.lowerBoundary;
            }
          }
        }
      }

      let retestConfluence: ConfluenceResult = 'FAIL';
      if (retestDetected && retestHolds && !isInvalidated) {
        retestConfluence = 'PASS';
        conditionsPassed.push(`Retest confirmed at $${retestPrice?.toFixed(2)} (held without invalidation)`);
      } else if (!retestDetected) {
        conditionsFailed.push('Retest of FVG zone pending');
      } else if (!retestHolds) {
        conditionsFailed.push('Retest failed to hold FVG boundary');
      }

      // Volatility confluence
      const volClassification = intel.volatility?.classification || 'UNDEFINED';
      const volConfluence: ConfluenceResult = (volClassification === 'NORMAL' || volClassification === 'HIGH') ? 'PASS' : 'PASS'; // Gold moves well in normal/high

      // Multi-timeframe confluence
      let multiTfConfluence: ConfluenceResult = 'PASS';
      if (multiTfContext === 'conflicting') {
        multiTfConfluence = 'FAIL';
        conditionsFailed.push('Multi-timeframe structure is conflicting');
      } else if (multiTfContext === 'insufficient_data') {
        multiTfConfluence = 'NOT_AVAILABLE';
      } else {
        conditionsPassed.push(`Multi-timeframe context: ${multiTfContext}`);
      }

      const confluence: SetupConfluence = {
        liquidity: 'PASS',
        structure: structureConfluence,
        displacement: displacementConfluence,
        fvg: fvgConfluence,
        retest: retestConfluence,
        volatility: volConfluence,
        multiTimeframe: multiTfConfluence,
        riskReward: riskRewardConfluence,
      };

      // Determine Setup State based on current scan
      let status: SetupState = 'NO_SETUP';
      let statusReason = '';

      if (isInvalidated) {
        status = 'INVALIDATED';
        statusReason = `INVALIDATED: ${invalidationReason}`;
        conditionsFailed.push(invalidationReason || 'Setup invalidated by price violation');
      } else if (
        confluence.liquidity === 'PASS' &&
        confluence.structure === 'PASS' &&
        confluence.displacement === 'PASS' &&
        confluence.fvg === 'PASS' &&
        confluence.retest === 'PASS' &&
        confluence.riskReward === 'PASS' &&
        confluence.multiTimeframe !== 'FAIL'
      ) {
        status = 'VALIDATED_CANDIDATE';
        statusReason = `VALIDATED CANDIDATE: All 9 quantitative criteria verified (R:R ${riskRewardRatio}, FVG retest held, structure confirmed)`;
      } else if (confluence.liquidity === 'PASS' && (confluence.structure === 'PASS' || confluence.displacement === 'PASS')) {
        status = 'SETUP_FORMING';
        statusReason = `SETUP FORMING: Sweep & partial structure confirmed; ${conditionsFailed.join('; ')}`;
      } else {
        status = 'WATCH';
        statusReason = `WATCH: Liquidity swept at $${sweep.levelSwept.toFixed(2)}; awaiting structure change and displacement`;
      }

      // Check existing setup registry to preserve lifecycle invariants & prevent duplicates
      const existingRecord = this.setupRegistry.get(setupId);
      let lifecycleSequence: SetupState[] = ['WATCH'];
      let createdAt = sweep.datetime;
      let measuredValue: number | null = null;
      let finalExpirationReason: string | null = null;
      let finalExpirationTimestamp: number | null = null;

      if (existingRecord) {
        createdAt = existingRecord.createdAt;
        lifecycleSequence = [...existingRecord.lifecycleSequence];

        // Terminal state 1: Once INVALIDATED, cannot move back to VALIDATED, FORMING, or WATCH
        if (existingRecord.status === 'INVALIDATED') {
          status = 'INVALIDATED';
          isInvalidated = true;
          invalidationReason = existingRecord.validation.invalidationReason || null;
          invalidationTimestamp = existingRecord.validation.invalidationTimestamp ?? null;
          measuredValue = existingRecord.validation.measuredValue ?? null;
          statusReason = existingRecord.statusReason;
        } 
        // Terminal state 2: Once EXPIRED, cannot silently become active again
        else if (existingRecord.status === 'EXPIRED') {
          status = 'EXPIRED';
          finalExpirationReason = existingRecord.expirationReason || null;
          finalExpirationTimestamp = existingRecord.expirationTimestamp || null;
          statusReason = existingRecord.statusReason;
        }
        // State 3: VALIDATED_CANDIDATE cannot regress backwards to WATCH or FORMING
        else if (existingRecord.status === 'VALIDATED_CANDIDATE') {
          if (isInvalidated) {
            status = 'INVALIDATED';
            if (!lifecycleSequence.includes('INVALIDATED')) {
              lifecycleSequence.push('INVALIDATED');
            }
          } else {
            status = 'VALIDATED_CANDIDATE';
            // Retain original stable entry, SL, target, and R:R
            if (existingRecord.risk.entryReference !== null) {
              entryReference = existingRecord.risk.entryReference;
              stopLossReference = existingRecord.risk.stopLossReference!;
              targetReference = existingRecord.risk.targetReference;
              riskDistance = existingRecord.risk.riskDistance;
              rewardDistance = existingRecord.risk.rewardDistance;
              riskRewardRatio = existingRecord.risk.riskRewardRatio;
            }
          }
        } 
        // State 4: Normal progression (WATCH -> SETUP_FORMING -> VALIDATED_CANDIDATE)
        else {
          if (status !== existingRecord.status) {
            lifecycleSequence.push(status);
          }
        }
      } else {
        lifecycleSequence = ['WATCH', status];
      }

      const provenance: SetupProvenance = {
        fact: [
          `Twelve Data verified M15 OHLCV bar feed`,
          `Originating candle timestamp: ${sweep.sweepCandleTimestamp} (${new Date(sweep.sweepCandleTimestamp).toISOString()})`,
          `Swept liquidity level: $${sweep.levelSwept.toFixed(2)} (${sweep.source})`,
          `Sweep peak/trough: $${sweep.sweepHighOrLow.toFixed(2)}`,
        ],
        calculation: [
          `Entry reference: $${entryReference?.toFixed(2) || 'N/A'} (FVG Retest)`,
          `Stop loss: $${stopLossReference?.toFixed(2) || 'N/A'} (Buffer: $${config.stopLossBufferUsd})`,
          `Opposing target: $${targetReference?.toFixed(2) || 'N/A'} (${targetSource || 'N/A'})`,
          `Risk distance: $${riskDistance?.toFixed(2) || 'N/A'} | Reward distance: $${rewardDistance?.toFixed(2) || 'N/A'}`,
          `Calculated R:R: ${riskRewardRatio !== null ? `${riskRewardRatio}:1` : 'N/A'} (Min: ${config.minRiskReward}:1)`,
        ],
        modelOutput: [
          `Setup Family: LIQUIDITY_SWEEP_REVERSAL`,
          `Direction: ${direction}`,
          `Lifecycle State: ${status}`,
          `Evaluation Reason: ${statusReason}`,
          `Multi-TF Context: ${multiTfContext.toUpperCase()}`,
        ],
      };

      const record: SetupRecord = {
        setupId,
        symbol: 'XAU/USD',
        timeframe: intel.timeframe,
        direction,
        setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
        createdAt,
        lastUpdated: new Date().toISOString(),
        status,
        statusReason,
        lifecycleSequence,
        evidence: {
          liquidityLevel: sweep.levelSwept,
          liquiditySource: sweep.source,
          sweepDetected: true,
          sweepTimestamp: sweep.sweepCandleTimestamp,
          sweepDatetime: sweep.datetime,
          sweepHighOrLow: sweep.sweepHighOrLow,
          structureEvent: matchingStructure?.type || null,
          structureTimestamp: matchingStructure?.breakCandleTimestamp || null,
          structureDatetime: matchingStructure?.datetime || null,
          brokenLevel: matchingStructure?.brokenLevel || null,
          displacementDetected: !!matchingDisplacement,
          displacementTimestamp: matchingDisplacement?.timestamp || null,
          displacementDatetime: matchingDisplacement?.datetime || null,
          displacementBodyRatio: matchingDisplacement?.bodyToRangeRatio || null,
          fvgDetected: !!matchingFvg,
          fvgUpper: matchingFvg?.upperBoundary || null,
          fvgLower: matchingFvg?.lowerBoundary || null,
          fvgTimestamp: matchingFvg?.formationTimestamp || null,
          fvgDatetime: matchingFvg?.datetime || null,
          retestDetected,
          retestTimestamp,
          retestDatetime,
          retestPrice,
          retestHolds,
        },
        risk: {
          entryReference,
          entryType: 'CALCULATED',
          entryMethod: `FVG ${direction === 'BEARISH' ? 'Lower Boundary' : 'Upper Boundary'} Retest`,
          stopLossReference,
          stopLossType: 'CALCULATED',
          stopLossMethod: `Beyond Swept Liquidity Peak ($${sweep.sweepHighOrLow.toFixed(2)}) + $${config.stopLossBufferUsd} Buffer`,
          targetReference,
          targetType: 'CALCULATED',
          targetSource,
          riskDistance,
          rewardDistance,
          riskRewardRatio,
          minimumRequiredRR: config.minRiskReward,
        },
        validation: {
          dataVerified: true,
          marketRegime: intel.marketStructure?.rangeState || 'TRENDING',
          volatilityState: volClassification,
          multiTimeframeContext: multiTfContext,
          conditionsPassed,
          conditionsFailed,
          confluence,
          invalidationCondition: direction === 'BEARISH'
            ? `Price candle closes above Stop Loss ($${stopLossReference}) or above FVG top ($${matchingFvg?.upperBoundary || stopLossReference})`
            : `Price candle closes below Stop Loss ($${stopLossReference}) or below FVG bottom ($${matchingFvg?.lowerBoundary || stopLossReference})`,
          isInvalidated,
          invalidationTimestamp,
          invalidationReason,
          measuredValue,
        },
        provenance,
        originatingCandleTimestamp: sweep.sweepCandleTimestamp,
        originatingEventKey: `SWEEP_${sweep.source}_${sweep.sweepCandleTimestamp}`,
        expirationReason: finalExpirationReason,
        expirationTimestamp: finalExpirationTimestamp,
      };

      // Store in registry and return single deduplicated candidate
      this.setupRegistry.set(setupId, record);
      results.push(record);
    }

    return results;
  }

  /**
   * Scans Family B: BREAKOUT + RETEST
   */
  private scanBreakoutRetests(
    intel: XauUsdMarketIntelligence,
    candles: Candle[],
    config: ScannerConfig,
    multiTfContext: MultiTimeframeContext
  ): SetupRecord[] {
    const results: SetupRecord[] = [];
    const structureEvents = intel.structureEvents || [];

    if (structureEvents.length === 0) {
      return results;
    }

    const sortedEvents = [...structureEvents].sort((a, b) => b.breakCandleTimestamp - a.breakCandleTimestamp);

    const seenBreakoutIds = new Set<string>();
    for (let i = 0; i < sortedEvents.length && results.length < 3; i++) {
      const event = sortedEvents[i];
      const direction: SetupDirection = event.direction;
      const setupId = `BRK-RETEST-${direction}-${event.breakCandleTimestamp}`;

      if (seenBreakoutIds.has(setupId)) {
        continue;
      }
      seenBreakoutIds.add(setupId);

      const conditionsPassed: string[] = [`Confirmed structure break (${event.type} ${direction} at $${event.brokenLevel.toFixed(2)})`];
      const conditionsFailed: string[] = [];

      // 1. Break has sufficient displacement
      const breakDisplacement = (intel.displacements || []).find(d => 
        d.direction === direction && 
        Math.abs(d.timestamp - event.breakCandleTimestamp) <= 3600000 * 2 // Within 2 bars
      );

      let displacementConfluence: ConfluenceResult = 'FAIL';
      if (breakDisplacement) {
        displacementConfluence = 'PASS';
        conditionsPassed.push(`Breakout displacement verified (${(breakDisplacement.bodyToRangeRatio * 100).toFixed(0)}% body)`);
      } else {
        conditionsFailed.push('Breakout lacked displacement candle');
      }

      // 2. Retest of broken structure level
      let retestDetected = false;
      let retestTimestamp: number | null = null;
      let retestDatetime: string | null = null;
      let retestPrice: number | null = null;
      let retestHolds = false;
      let isInvalidated = false;
      let invalidationReason: string | null = null;
      let invalidationTimestamp: number | null = null;

      // Find swing prior to break for stop loss
      const priorSwing = direction === 'BULLISH'
        ? intel.marketStructure?.lastSwingLow
        : intel.marketStructure?.lastSwingHigh;

      let stopLossReference = priorSwing
        ? Number((direction === 'BULLISH' ? priorSwing.price - config.stopLossBufferUsd : priorSwing.price + config.stopLossBufferUsd).toFixed(2))
        : Number((direction === 'BULLISH' ? event.brokenLevel - 5.0 : event.brokenLevel + 5.0).toFixed(2));

      let entryReference = Number(event.brokenLevel.toFixed(2));

      // Target reference: Opposing structural liquidity
      const targetData = this.findOpposingTarget(intel, direction, entryReference);
      let targetReference = targetData.target;
      let targetSource = targetData.source;

      // Calculate R:R
      let riskDistance: number | null = null;
      let rewardDistance: number | null = null;
      let riskRewardRatio: number | null = null;
      let riskRewardConfluence: ConfluenceResult = 'FAIL';

      if (entryReference !== null && stopLossReference !== null && targetReference !== null) {
        riskDistance = Number(Math.abs(entryReference - stopLossReference).toFixed(2));
        rewardDistance = Number(Math.abs(targetReference - entryReference).toFixed(2));
        if (riskDistance > 0) {
          riskRewardRatio = Number((rewardDistance / riskDistance).toFixed(2));
          if (riskRewardRatio >= config.minRiskReward) {
            riskRewardConfluence = 'PASS';
            conditionsPassed.push(`R:R ${riskRewardRatio} >= ${config.minRiskReward}`);
          } else {
            conditionsFailed.push(`R:R ${riskRewardRatio} < ${config.minRiskReward} minimum requirement`);
          }
        }
      }

      // Check subsequent candles for retest and invalidation
      const subsequentCandles = candles.filter(c => c.timestamp > event.breakCandleTimestamp);

      for (const bar of subsequentCandles) {
        // Invalidation: Price penetrates stop loss
        if (direction === 'BULLISH' && bar.close < stopLossReference) {
          isInvalidated = true;
          invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} below Stop Loss ($${stopLossReference})`;
          invalidationTimestamp = bar.timestamp;
          break;
        }
        if (direction === 'BEARISH' && bar.close > stopLossReference) {
          isInvalidated = true;
          invalidationReason = `Candle at ${new Date(bar.timestamp).toISOString()} closed at $${bar.close.toFixed(2)} above Stop Loss ($${stopLossReference})`;
          invalidationTimestamp = bar.timestamp;
          break;
        }

        // Retest detection: touches broken level within tolerance
        const tolerance = 0.50;
        if (!retestDetected) {
          if (direction === 'BULLISH' && bar.low <= entryReference + tolerance && bar.high >= entryReference - tolerance) {
            retestDetected = true;
            retestTimestamp = bar.timestamp;
            retestDatetime = new Date(bar.timestamp).toISOString();
            retestPrice = bar.low;
            retestHolds = bar.close >= entryReference - tolerance;
          } else if (direction === 'BEARISH' && bar.high >= entryReference - tolerance && bar.low <= entryReference + tolerance) {
            retestDetected = true;
            retestTimestamp = bar.timestamp;
            retestDatetime = new Date(bar.timestamp).toISOString();
            retestPrice = bar.high;
            retestHolds = bar.close <= entryReference + tolerance;
          }
        }
      }

      let retestConfluence: ConfluenceResult = 'FAIL';
      if (retestDetected && retestHolds && !isInvalidated) {
        retestConfluence = 'PASS';
        conditionsPassed.push(`Retest of broken level ($${entryReference}) confirmed and held`);
      } else if (!retestDetected) {
        conditionsFailed.push(`Retest of broken structure level ($${entryReference}) pending`);
      } else if (!retestHolds) {
        conditionsFailed.push(`Retest broke through level without holding`);
      }

      // Check for FVG formation accompanying break
      const breakFvg = (intel.fairValueGaps || []).find(f => 
        f.direction === direction && 
        Math.abs(f.formationTimestamp - event.breakCandleTimestamp) <= 3600000 * 3
      );
      const fvgConfluence: ConfluenceResult = breakFvg ? 'PASS' : 'NOT_AVAILABLE';

      // Multi-TF context
      let multiTfConfluence: ConfluenceResult = 'PASS';
      if (multiTfContext === 'conflicting') {
        multiTfConfluence = 'FAIL';
        conditionsFailed.push('Multi-timeframe structure is conflicting');
      } else if (multiTfContext === 'insufficient_data') {
        multiTfConfluence = 'NOT_AVAILABLE';
      }

      const confluence: SetupConfluence = {
        liquidity: 'PASS', // The broken structure itself was a major swing liquidity level
        structure: 'PASS',
        displacement: displacementConfluence,
        fvg: fvgConfluence,
        retest: retestConfluence,
        volatility: 'PASS',
        multiTimeframe: multiTfConfluence,
        riskReward: riskRewardConfluence,
      };

      let status: SetupState = 'NO_SETUP';
      let statusReason = '';

      if (isInvalidated) {
        status = 'INVALIDATED';
        statusReason = `INVALIDATED: ${invalidationReason}`;
      } else if (
        confluence.structure === 'PASS' &&
        confluence.displacement === 'PASS' &&
        confluence.retest === 'PASS' &&
        confluence.riskReward === 'PASS' &&
        confluence.multiTimeframe !== 'FAIL'
      ) {
        status = 'VALIDATED_CANDIDATE';
        statusReason = `VALIDATED CANDIDATE: Breakout and retest held with acceptable R:R (${riskRewardRatio})`;
      } else if (retestDetected) {
        status = 'SETUP_FORMING';
        statusReason = `SETUP FORMING: Retest occurring; ${conditionsFailed.join('; ')}`;
      } else {
        status = 'WATCH';
        statusReason = `WATCH: Structure break confirmed at $${event.brokenLevel.toFixed(2)}; awaiting retest`;
      }

      // Check existing setup registry to preserve lifecycle invariants & prevent duplicates
      const existingRecord = this.setupRegistry.get(setupId);
      let lifecycleSequence: SetupState[] = ['WATCH'];
      let createdAt = event.datetime;
      let measuredValue: number | null = null;
      let finalExpirationReason: string | null = null;
      let finalExpirationTimestamp: number | null = null;

      if (existingRecord) {
        createdAt = existingRecord.createdAt;
        lifecycleSequence = [...existingRecord.lifecycleSequence];

        // Terminal state 1: Once INVALIDATED, cannot move back to VALIDATED, FORMING, or WATCH
        if (existingRecord.status === 'INVALIDATED') {
          status = 'INVALIDATED';
          isInvalidated = true;
          invalidationReason = existingRecord.validation.invalidationReason || null;
          invalidationTimestamp = existingRecord.validation.invalidationTimestamp ?? null;
          measuredValue = existingRecord.validation.measuredValue ?? null;
          statusReason = existingRecord.statusReason;
        } 
        // Terminal state 2: Once EXPIRED, cannot silently become active again
        else if (existingRecord.status === 'EXPIRED') {
          status = 'EXPIRED';
          finalExpirationReason = existingRecord.expirationReason || null;
          finalExpirationTimestamp = existingRecord.expirationTimestamp || null;
          statusReason = existingRecord.statusReason;
        }
        // State 3: VALIDATED_CANDIDATE cannot regress backwards to WATCH or FORMING
        else if (existingRecord.status === 'VALIDATED_CANDIDATE') {
          if (isInvalidated) {
            status = 'INVALIDATED';
            if (!lifecycleSequence.includes('INVALIDATED')) {
              lifecycleSequence.push('INVALIDATED');
            }
          } else {
            status = 'VALIDATED_CANDIDATE';
            // Retain original stable entry, SL, target, and R:R
            if (existingRecord.risk.entryReference !== null) {
              entryReference = existingRecord.risk.entryReference;
              stopLossReference = existingRecord.risk.stopLossReference!;
              targetReference = existingRecord.risk.targetReference;
              riskDistance = existingRecord.risk.riskDistance;
              rewardDistance = existingRecord.risk.rewardDistance;
              riskRewardRatio = existingRecord.risk.riskRewardRatio;
            }
          }
        } 
        // State 4: Normal progression (WATCH -> SETUP_FORMING -> VALIDATED_CANDIDATE)
        else {
          if (status !== existingRecord.status) {
            lifecycleSequence.push(status);
          }
        }
      } else {
        lifecycleSequence = ['WATCH', status];
      }

      const provenance: SetupProvenance = {
        fact: [
          `Twelve Data verified M15 OHLCV bar feed`,
          `Originating break candle timestamp: ${event.breakCandleTimestamp} (${new Date(event.breakCandleTimestamp).toISOString()})`,
          `Broken structure level: $${event.brokenLevel.toFixed(2)} (${event.type})`,
          `Prior swing stop anchor: $${stopLossReference?.toFixed(2) || 'N/A'}`,
        ],
        calculation: [
          `Entry reference: $${entryReference?.toFixed(2) || 'N/A'} (Broken Structure Retest)`,
          `Stop loss: $${stopLossReference?.toFixed(2) || 'N/A'} (Buffer: $${config.stopLossBufferUsd})`,
          `Opposing target: $${targetReference?.toFixed(2) || 'N/A'} (${targetSource || 'N/A'})`,
          `Risk distance: $${riskDistance?.toFixed(2) || 'N/A'} | Reward distance: $${rewardDistance?.toFixed(2) || 'N/A'}`,
          `Calculated R:R: ${riskRewardRatio !== null ? `${riskRewardRatio}:1` : 'N/A'} (Min: ${config.minRiskReward}:1)`,
        ],
        modelOutput: [
          `Setup Family: BREAKOUT_RETEST`,
          `Direction: ${direction}`,
          `Lifecycle State: ${status}`,
          `Evaluation Reason: ${statusReason}`,
          `Multi-TF Context: ${multiTfContext.toUpperCase()}`,
        ],
      };

      const record: SetupRecord = {
        setupId,
        symbol: 'XAU/USD',
        timeframe: intel.timeframe,
        direction,
        setupFamily: 'BREAKOUT_RETEST',
        createdAt,
        lastUpdated: new Date().toISOString(),
        status,
        statusReason,
        lifecycleSequence,
        evidence: {
          liquidityLevel: event.brokenLevel,
          liquiditySource: `STRUCTURAL_SWING_${direction === 'BULLISH' ? 'HIGH' : 'LOW'}`,
          sweepDetected: false,
          sweepTimestamp: null,
          sweepDatetime: null,
          sweepHighOrLow: null,
          structureEvent: event.type,
          structureTimestamp: event.breakCandleTimestamp,
          structureDatetime: event.datetime,
          brokenLevel: event.brokenLevel,
          displacementDetected: !!breakDisplacement,
          displacementTimestamp: breakDisplacement?.timestamp || null,
          displacementDatetime: breakDisplacement?.datetime || null,
          displacementBodyRatio: breakDisplacement?.bodyToRangeRatio || null,
          fvgDetected: !!breakFvg,
          fvgUpper: breakFvg?.upperBoundary || null,
          fvgLower: breakFvg?.lowerBoundary || null,
          fvgTimestamp: breakFvg?.formationTimestamp || null,
          fvgDatetime: breakFvg?.datetime || null,
          retestDetected,
          retestTimestamp,
          retestDatetime,
          retestPrice,
          retestHolds,
        },
        risk: {
          entryReference,
          entryType: 'CALCULATED',
          entryMethod: `Broken Structure Level ($${entryReference.toFixed(2)}) Retest`,
          stopLossReference,
          stopLossType: 'CALCULATED',
          stopLossMethod: `Beyond Prior Structural Swing ($${stopLossReference.toFixed(2)})`,
          targetReference,
          targetType: 'CALCULATED',
          targetSource,
          riskDistance,
          rewardDistance,
          riskRewardRatio,
          minimumRequiredRR: config.minRiskReward,
        },
        validation: {
          dataVerified: true,
          marketRegime: intel.marketStructure?.rangeState || 'TRENDING',
          volatilityState: intel.volatility?.classification || 'NORMAL',
          multiTimeframeContext: multiTfContext,
          conditionsPassed,
          conditionsFailed,
          confluence,
          invalidationCondition: direction === 'BULLISH'
            ? `Price candle closes below Stop Loss ($${stopLossReference})`
            : `Price candle closes above Stop Loss ($${stopLossReference})`,
          isInvalidated,
          invalidationTimestamp,
          invalidationReason,
          measuredValue,
        },
        provenance,
        originatingCandleTimestamp: event.breakCandleTimestamp,
        originatingEventKey: `BREAK_${event.type}_${event.breakCandleTimestamp}`,
        expirationReason: finalExpirationReason,
        expirationTimestamp: finalExpirationTimestamp,
      };

      // Store in registry and return single deduplicated candidate
      this.setupRegistry.set(setupId, record);
      results.push(record);
    }

    return results;
  }

  /**
   * Finds opposing structural liquidity level for target calculation
   */
  private findOpposingTarget(
    intel: XauUsdMarketIntelligence, 
    direction: SetupDirection, 
    entry: number
  ): { target: number | null; source: string | null } {
    const levels = intel.liquidityLevels || [];
    const swings = intel.marketStructure;

    if (direction === 'BEARISH') {
      // Look for opposing support levels below entry
      const candidatesBelow = levels
        .filter(l => l.level < entry)
        .sort((a, b) => b.level - a.level); // Closest below first

      if (candidatesBelow.length > 0) {
        return { target: candidatesBelow[0].level, source: candidatesBelow[0].source };
      }

      // Fallback to lowest swing low
      if (swings?.swingLows && swings.swingLows.length > 0) {
        const lowsBelow = swings.swingLows.filter(s => s.price < entry);
        if (lowsBelow.length > 0) {
          const target = Math.min(...lowsBelow.map(s => s.price));
          return { target, source: 'PRIOR_SWING_LOW' };
        }
      }

      // PDL fallback
      if (intel.previousPeriodLevels?.pdl && intel.previousPeriodLevels.pdl < entry) {
        return { target: intel.previousPeriodLevels.pdl, source: 'PREVIOUS_DAY_LOW' };
      }
    } else {
      // BULLISH: look for opposing resistance levels above entry
      const candidatesAbove = levels
        .filter(l => l.level > entry)
        .sort((a, b) => a.level - b.level); // Closest above first

      if (candidatesAbove.length > 0) {
        return { target: candidatesAbove[0].level, source: candidatesAbove[0].source };
      }

      // Fallback to highest swing high
      if (swings?.swingHighs && swings.swingHighs.length > 0) {
        const highsAbove = swings.swingHighs.filter(s => s.price > entry);
        if (highsAbove.length > 0) {
          const target = Math.max(...highsAbove.map(s => s.price));
          return { target, source: 'PRIOR_SWING_HIGH' };
        }
      }

      // PDH fallback
      if (intel.previousPeriodLevels?.pdh && intel.previousPeriodLevels.pdh > entry) {
        return { target: intel.previousPeriodLevels.pdh, source: 'PREVIOUS_DAY_HIGH' };
      }
    }

    return { target: null, source: null };
  }

  /**
   * Evaluates and marks expired setups in the registry based on elapsed completed bars
   */
  private evaluateExpirations(completedCandles: Candle[], config: ScannerConfig): void {
    if (completedCandles.length === 0) return;
    const latestCandle = completedCandles[completedCandles.length - 1];

    for (const record of this.setupRegistry.values()) {
      if (record.status === 'WATCH' || record.status === 'SETUP_FORMING') {
        const barsElapsed = completedCandles.filter(c => c.timestamp > record.originatingCandleTimestamp).length;
        if (barsElapsed > config.maxRetestWaitBars) {
          record.status = 'EXPIRED';
          record.statusReason = `EXPIRED: ${barsElapsed} bars elapsed without required confirmation/retest (max ${config.maxRetestWaitBars} bars allowed)`;
          record.expirationTimestamp = latestCandle.timestamp;
          record.expirationReason = `${barsElapsed} bars elapsed without required confirmation/retest`;
          record.lastUpdated = new Date().toISOString();
          if (!record.lifecycleSequence.includes('EXPIRED')) {
            record.lifecycleSequence.push('EXPIRED');
          }
        }
      } else if (record.status === 'VALIDATED_CANDIDATE') {
        const barsElapsed = completedCandles.filter(c => c.timestamp > record.originatingCandleTimestamp).length;
        if (barsElapsed > config.maxLookbackBars) {
          record.status = 'EXPIRED';
          record.statusReason = `EXPIRED: ${barsElapsed} bars elapsed beyond max lookback window (${config.maxLookbackBars} bars)`;
          record.expirationTimestamp = latestCandle.timestamp;
          record.expirationReason = `${barsElapsed} bars elapsed beyond max lookback window`;
          record.lastUpdated = new Date().toISOString();
          if (!record.lifecycleSequence.includes('EXPIRED')) {
            record.lifecycleSequence.push('EXPIRED');
          }
        }
      }
    }
  }

  /**
   * Evaluates Multi-Timeframe context from verified facts
   */
  public evaluateMultiTimeframeContext(intel: XauUsdMarketIntelligence): MultiTimeframeContext {
    const facts = intel.multiTimeframeFacts || [];
    const activeFacts = facts.filter(f => f.hasData);

    if (activeFacts.length < 2) {
      return 'insufficient_data';
    }

    const trends = activeFacts.map(f => f.trend).filter(t => t !== 'UNDEFINED');
    if (trends.length < 2) {
      return 'insufficient_data';
    }

    const allBullish = trends.every(t => t === 'BULLISH');
    const allBearish = trends.every(t => t === 'BEARISH');

    if (allBullish || allBearish) {
      return 'aligned';
    }

    const hasBullish = trends.includes('BULLISH');
    const hasBearish = trends.includes('BEARISH');

    if (hasBullish && hasBearish) {
      return 'conflicting';
    }

    return 'mixed';
  }

  private getEmptyEvidence() {
    return {
      liquidityLevel: null,
      liquiditySource: null,
      sweepDetected: false,
      sweepTimestamp: null,
      sweepDatetime: null,
      sweepHighOrLow: null,
      structureEvent: null,
      structureTimestamp: null,
      structureDatetime: null,
      brokenLevel: null,
      displacementDetected: false,
      displacementTimestamp: null,
      displacementDatetime: null,
      displacementBodyRatio: null,
      fvgDetected: false,
      fvgUpper: null,
      fvgLower: null,
      fvgTimestamp: null,
      fvgDatetime: null,
      retestDetected: false,
      retestTimestamp: null,
      retestDatetime: null,
      retestPrice: null,
      retestHolds: false,
    };
  }

  private getEmptyRisk(minRR: number) {
    return {
      entryReference: null,
      entryType: 'CALCULATED' as const,
      entryMethod: 'NONE',
      stopLossReference: null,
      stopLossType: 'CALCULATED' as const,
      stopLossMethod: 'NONE',
      targetReference: null,
      targetType: 'CALCULATED' as const,
      targetSource: null,
      riskDistance: null,
      rewardDistance: null,
      riskRewardRatio: null,
      minimumRequiredRR: minRR,
    };
  }

  private getEmptyValidation(mtf: MultiTimeframeContext, reason: string) {
    return {
      dataVerified: false,
      marketRegime: 'UNDEFINED',
      volatilityState: 'UNDEFINED',
      multiTimeframeContext: mtf,
      conditionsPassed: [],
      conditionsFailed: [reason],
      confluence: {
        liquidity: 'FAIL' as const,
        structure: 'FAIL' as const,
        displacement: 'FAIL' as const,
        fvg: 'FAIL' as const,
        retest: 'FAIL' as const,
        volatility: 'FAIL' as const,
        multiTimeframe: mtf === 'insufficient_data' ? 'NOT_AVAILABLE' as const : 'FAIL' as const,
        riskReward: 'FAIL' as const,
      },
      invalidationCondition: 'Awaiting verified market intelligence feed',
      isInvalidated: false,
    };
  }
}

export const setupScannerEngine = new SetupScannerEngine();
