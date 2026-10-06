import { Candle } from '../src/market-data/provider.interface';
import { phase7EValidationService } from '../src/strategy/phase-7e-validation-service';
import { classifyTimestampSession } from '../src/strategy/session-classifier';

console.log('===============================================================');
console.log('PHASE 7E — ROBUSTNESS & EDGE DISCOVERY VALIDATION SUITE');
console.log('===============================================================');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    testsPassed++;
  } else {
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
    testsFailed++;
  }
}

/**
 * Creates the exact synthetic multi-regime dataset of 150 candles
 * across 6 distinct regimes (Compression, Trending Bullish, Ranging Consolidation,
 * Volatility Expansion, Trending Bearish).
 */
function createSyntheticMultiRegimeDataset(count: number = 150): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.UTC(2026, 8, 1, 0, 0, 0);
  let price = 2650;

  for (let i = 0; i < count; i++) {
    const timestamp = baseTime + i * 15 * 60 * 1000;
    let open = price;
    let high = price + 2;
    let low = price - 2;
    let close = price;

    if (i < 20) {
      // Regime: Compression
      high = price + 0.4;
      low = price - 0.4;
      close = price + 0.1;
      price = close;
    } else if (i >= 20 && i < 40) {
      // Regime: Trending Bullish
      open = price;
      close = price + 3.5;
      high = close + 0.5;
      low = open - 0.5;
      price = close;
    } else if (i >= 40 && i < 70) {
      // Regime: Ranging Consolidation
      const cycle = i % 4;
      if (cycle === 0) close = price + 2;
      else if (cycle === 1) close = price - 1.5;
      else if (cycle === 2) close = price - 2;
      else close = price + 1.5;
      high = Math.max(open, close) + 0.8;
      low = Math.min(open, close) - 0.8;
      price = close;
    } else if (i >= 70 && i < 90) {
      // Regime: Volatility Expansion
      open = price;
      close = price - 6;
      high = open + 1;
      low = close - 1;
      price = close;
    } else {
      // Regime: Trending Bearish
      open = price;
      close = price - 2.5;
      high = open + 0.5;
      low = close - 0.5;
      price = close;
    }

    candles.push({
      timestamp,
      datetime: new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1500,
      isVerified: true,
    });
  }

  return candles;
}

async function runTests() {
  const multiRegimeData = createSyntheticMultiRegimeDataset(150);

  // --------------------------------------------------------------------------
  // TEST 1: Partitioned Robustness Validation (Train / Calib / OOS)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Partitioned Robustness Validation (Part A) ---');
  const auditReport = phase7EValidationService.runRobustnessAudit(
    multiRegimeData,
    'Synthetic Multi-Regime 150-Candle Validation Series'
  );

  assert(auditReport.totalCandles === 150, 'Total candles equals 150');
  assert(auditReport.partitioning.train.candleCount === 75, 'Train partition contains 75 candles (50%)');
  assert(auditReport.partitioning.calibration.candleCount === 30, 'Calibration partition contains 30 candles (20%)');
  assert(auditReport.partitioning.oos.candleCount === 45, 'OOS partition contains 45 candles (30%)');
  assert(auditReport.partitioning.oos.executedTrades === 3, 'OOS executed trades equals 3');
  assert(auditReport.overallPerformance.executedTrades === 6, 'Total executed trades equals 6');
  assert(auditReport.overallPerformance.netPnL > 10000, `Total net P&L exceeds $10,000 ($${auditReport.overallPerformance.netPnL})`);
  assert(auditReport.partitioning.oos.netPnL > 5000, `OOS net P&L exceeds $5,000 ($${auditReport.partitioning.oos.netPnL})`);

  // --------------------------------------------------------------------------
  // TEST 2: Edge Decomposition (10 Components)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Edge Decomposition (Part B) ---');
  assert(auditReport.edgeDecomposition.length === 10, 'All 10 required setup & filter components evaluated');
  
  const compNames = auditReport.edgeDecomposition.map(c => c.componentName);
  assert(compNames.includes('BULLISH BREAKOUT'), 'Bullish Breakout component present');
  assert(compNames.includes('BEARISH BREAKDOWN'), 'Bearish Breakdown component present');
  assert(compNames.includes('CONFIRMED RETEST'), 'Confirmed Retest component present');
  assert(compNames.includes('FAILED RETEST'), 'Failed Retest filter present');
  assert(compNames.includes('BULL TRAP'), 'Bull Trap filter present');
  assert(compNames.includes('BEAR TRAP'), 'Bear Trap filter present');
  assert(compNames.includes('COMPRESSION FILTER'), 'Compression filter present');
  assert(compNames.includes('DISPLACEMENT FILTER'), 'Displacement filter present');
  assert(compNames.includes('EXTENSION FILTER'), 'Extension filter present');
  assert(compNames.includes('REGIME FILTER'), 'Regime filter present');

  const defensiveComps = auditReport.edgeDecomposition.filter(c => c.valueContributionType === 'DEFENSIVE_CAPITAL_PRESERVATION');
  assert(defensiveComps.length >= 5, 'Defensive capital preservation identified on multiple filters');

  // --------------------------------------------------------------------------
  // TEST 3: Directional Robustness (Long vs Short)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Directional Robustness (Part C) ---');
  assert(auditReport.directionalRobustness.long.candidates >= 0, 'Long candidates tracked');
  assert(auditReport.directionalRobustness.long.executions === 0, 'Long executions equals 0 (asymmetry observed)');
  assert(auditReport.directionalRobustness.longEdgeStatus === 'UNPROVEN', 'Long edge status explicitly marked UNPROVEN');
  assert(auditReport.directionalRobustness.short.executions === 6, 'Short executions equals 6');
  assert(auditReport.directionalRobustness.shortEdgeStatus === 'UNPROVEN', 'Short edge status explicitly marked UNPROVEN due to N=6 < 30');

  // --------------------------------------------------------------------------
  // TEST 4: Market Regime Robustness
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Market Regime Robustness (Part D) ---');
  const regimes = Object.keys(auditReport.regimeRobustness);
  assert(regimes.length === 6, 'All 6 market regimes evaluated');
  assert(auditReport.performanceConcentratedInSingleRegime === true, 'Performance concentration flag triggered correctly');
  assert(auditReport.regimeRobustness['TRENDING_BEARISH'].executedTrades > 0, 'Trending bearish regime generated trades');
  assert(auditReport.regimeRobustness['LOW_VOLATILITY_COMPRESSION'].executedTrades === 0, 'Compression regime generated 0 trades (properly protected)');

  // --------------------------------------------------------------------------
  // TEST 5: Session Analysis & Deterministic Timestamp Classification
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Session Analysis (Part E) ---');
  const baseMidnight = Date.UTC(2026, 8, 1, 2, 0, 0); // 02:00 UTC -> Asian
  const baseLondon = Date.UTC(2026, 8, 1, 10, 0, 0);   // 10:00 UTC -> London
  const baseOverlap = Date.UTC(2026, 8, 1, 14, 0, 0);  // 14:00 UTC -> Overlap
  const baseNY = Date.UTC(2026, 8, 1, 19, 0, 0);       // 19:00 UTC -> New York
  const baseOther = Date.UTC(2026, 8, 1, 23, 0, 0);    // 23:00 UTC -> Other

  assert(classifyTimestampSession(baseMidnight) === 'ASIAN', 'Timestamp 02:00 UTC classified as ASIAN');
  assert(classifyTimestampSession(baseLondon) === 'LONDON', 'Timestamp 10:00 UTC classified as LONDON');
  assert(classifyTimestampSession(baseOverlap) === 'LONDON/NEW YORK OVERLAP', 'Timestamp 14:00 UTC classified as OVERLAP');
  assert(classifyTimestampSession(baseNY) === 'NEW YORK', 'Timestamp 19:00 UTC classified as NEW YORK');
  assert(classifyTimestampSession(baseOther) === 'OTHER', 'Timestamp 23:00 UTC classified as OTHER');

  const sessions = Object.keys(auditReport.sessionRobustness);
  assert(sessions.length === 5, 'All 5 market sessions reported');

  // --------------------------------------------------------------------------
  // TEST 6: Cost Sensitivity (1.0x, 1.5x, 2.0x, 3.0x Friction)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Cost Sensitivity Friction Stress Testing (Part F) ---');
  assert(auditReport.costSensitivity.steps.length === 4, 'Tested 4 friction levels (1.0x, 1.5x, 2.0x, 3.0x)');
  
  const step10 = auditReport.costSensitivity.steps[0];
  const step15 = auditReport.costSensitivity.steps[1];
  const step20 = auditReport.costSensitivity.steps[2];
  const step30 = auditReport.costSensitivity.steps[3];

  assert(step10.netPnL > step15.netPnL, 'P&L monotonically degrades under 1.5x friction');
  assert(step15.netPnL > step20.netPnL, 'P&L monotonically degrades under 2.0x friction');
  assert(step20.netPnL > step30.netPnL, 'P&L monotonically degrades under 3.0x friction');
  assert(step30.netPnL > 0, `Apparent edge remains positive even under 3.0x friction ($${step30.netPnL})`);
  assert(auditReport.costSensitivity.robustTo3xFriction === true, 'Robust to 3.0x execution friction');

  // --------------------------------------------------------------------------
  // TEST 7: Trade-Order Robustness & Concentration
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Trade-Order Robustness & Concentration (Part G) ---');
  assert(auditReport.tradeOrderRobustness.totalTrades === 6, 'Tracked 6 realized trades');
  assert(auditReport.tradeOrderRobustness.bestTradePnL > 0, 'Best trade P&L identified');
  assert(auditReport.tradeOrderRobustness.pnlExcludingBestTrade > 0, 'Strategy remains profitable excluding best trade');
  assert(auditReport.tradeOrderRobustness.pnlExcludingBest2Trades > 0, 'Strategy remains profitable excluding top 2 trades');
  assert(auditReport.tradeOrderRobustness.shuffledDrawdownP50 >= 0, 'Shuffled drawdown P50 computed');
  assert(auditReport.tradeOrderRobustness.shuffledDrawdownP95 >= 0, 'Shuffled drawdown P95 computed');

  // --------------------------------------------------------------------------
  // TEST 8: Counterfactual Defense (Protected vs Naive)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Counterfactual Defense (Part H) ---');
  assert(auditReport.counterfactualDefense.unprotectedBaseline.simulatedLossAvoided > 0, 'Friction and drawdown averted quantified');
  assert(auditReport.counterfactualDefense.protectionBenefitSummary.netPnLImprovement > 0, 'Net P&L improvement over naive breakout confirmed');

  // --------------------------------------------------------------------------
  // TEST 9: Sample Adequacy Audit
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Sample Adequacy Audit (Part I) ---');
  assert(auditReport.sampleAdequacy.isTotalSampleAdequate === false, 'Total sample correctly flagged as UNDERPOWERED (N=6 < 30)');
  assert(auditReport.sampleAdequacy.isOosAdequate === false, 'OOS sample correctly flagged as UNDERPOWERED (N=3 < 30)');
  assert(auditReport.sampleAdequacy.underpoweredFlags.length > 0, 'Underpowered flags populated with specific details');

  // --------------------------------------------------------------------------
  // TEST 10: Edge Stability & Machine Readable Summary
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Edge Stability Classification (Part J) ---');
  assert(auditReport.edgeStabilityClassification === 'POSITIVE BUT INSUFFICIENT EVIDENCE', 'Edge stability classified as POSITIVE BUT INSUFFICIENT EVIDENCE');
  assert(auditReport.machineReadableSummary.LONG_EDGE_STATUS === 'UNPROVEN', 'Summary machine-readable LONG_EDGE_STATUS is UNPROVEN');
  assert(auditReport.machineReadableSummary.SHORT_EDGE_STATUS === 'UNPROVEN', 'Summary machine-readable SHORT_EDGE_STATUS is UNPROVEN');
  assert(auditReport.machineReadableSummary.SAMPLE_ADEQUACY === 'UNDERPOWERED_SAMPLE_FAIL', 'Summary SAMPLE_ADEQUACY is UNDERPOWERED_SAMPLE_FAIL');

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
  console.log('===============================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests();
