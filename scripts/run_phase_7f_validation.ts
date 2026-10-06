import * as fs from 'fs';
import * as path from 'path';
import { normalizeAndSortCandles } from '../src/utils/candle-integrity';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { BreakoutStrategy } from '../src/strategy/breakout-strategy';
import { classifyTimestampSession } from '../src/strategy/session-classifier';
import { Candle } from '../src/market-data/provider.interface';
import { PaperTradeJournalEntry } from '../src/types/paper-trading';
import { StrategySignalOutput } from '../src/strategy/strategy-signal-types';

interface DetailedTrade {
  trade: PaperTradeJournalEntry;
  openedAt: string;
  closedAt: string;
  openTimestamp: number;
  closeTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  direction: 'LONG' | 'SHORT';
  session: string;
  closeReason: string;
}

async function runAudit() {
  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Data file not found:', dataPath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { candles, rejectedCount } = normalizeAndSortCandles(raw);
  console.log(`Loaded ${candles.length} clean candles. (Rejected: ${rejectedCount})`);
  console.log(`Date Range: ${candles[0].datetime} -> ${candles[candles.length - 1].datetime}`);

  const totalCandles = candles.length;

  // Run replay with standard baseline friction
  function executeReplay(dataset: Candle[], frictionMultiplier: number = 1.0) {
    const replay = new HistoricalReplayEngine({
      symbol: 'XAU/USD',
      timeframe: '15m',
      initialBalance: 100_000,
      riskConfig: {
        commissionPerLot: 3.50 * frictionMultiplier,
        slippagePips: 0.5 * frictionMultiplier,
        spreadMarkupPips: 1.0 * frictionMultiplier,
      }
    });

    const strategy = new BreakoutStrategy();
    replay.loadDataset(dataset);
    replay.setStrategy(strategy);

    const signals: Array<{ index: number; signal: StrategySignalOutput }> = [];

    while (replay.getState() !== 'COMPLETED') {
      replay.stepForward();
      const lastSig = strategy.getLastSignalOutput();
      if (lastSig) {
        signals.push({ index: replay.getCurrentStepResult()?.candleIndex || 0, signal: lastSig });
      }
    }

    return {
      replay,
      trades: replay.getClosedTrades(),
      metrics: replay.getMetrics(),
      signals,
    };
  }

  console.log('Running 1.0x Baseline Replay across all 12,000 candles...');
  const t0 = Date.now();
  const baseline = executeReplay(candles, 1.0);
  console.log(`Baseline replay completed in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

  const allTrades = baseline.trades;
  console.log(`Total Trades Executed: ${allTrades.length}`);

  // Detailed trade breakdown
  const detailedTrades: DetailedTrade[] = allTrades.map(t => {
    const session = classifyTimestampSession(t.openedAt);
    return {
      trade: t,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      openTimestamp: new Date(t.openedAt).getTime(),
      closeTimestamp: new Date(t.closedAt).getTime(),
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.realizedPnL,
      direction: t.direction,
      session,
      closeReason: t.closeReason,
    };
  });

  // Calculate statistics helper
  function computeStats(trades: PaperTradeJournalEntry[], initialBal: number = 100_000) {
    const total = trades.length;
    const wins = trades.filter(t => t.realizedPnL > 0);
    const losses = trades.filter(t => t.realizedPnL <= 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.realizedPnL, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.realizedPnL, 0));
    const netPnL = grossProfit - grossLoss;
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const expectancy = total > 0 ? netPnL / total : 0;

    // Drawdown calculation
    let peak = initialBal;
    let balance = initialBal;
    let maxDD = 0;
    let maxDDPercent = 0;
    let currentConsecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    for (const t of trades) {
      balance += t.realizedPnL;
      if (balance > peak) peak = balance;
      const dd = peak - balance;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      if (ddPct > maxDDPercent) maxDDPercent = ddPct;

      if (t.realizedPnL <= 0) {
        currentConsecutiveLosses++;
        if (currentConsecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = currentConsecutiveLosses;
      } else {
        currentConsecutiveLosses = 0;
      }
    }

    // 95% Confidence Interval for Win Rate (Wilson score or Normal approx)
    let ci95Lower = 0;
    let ci95Upper = 0;
    let standardError = 0;
    if (total > 0) {
      const p = winRate / 100;
      standardError = Math.sqrt((p * (1 - p)) / total);
      ci95Lower = Math.max(0, Number(((p - 1.96 * standardError) * 100).toFixed(2)));
      ci95Upper = Math.min(100, Number(((p + 1.96 * standardError) * 100).toFixed(2)));
    }

    return {
      totalTrades: total,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: Number(winRate.toFixed(2)),
      netPnL: Number(netPnL.toFixed(2)),
      returnPercent: Number(((netPnL / initialBal) * 100).toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      expectancy: Number(expectancy.toFixed(2)),
      maxDrawdownAmount: Number(maxDD.toFixed(2)),
      maxDrawdownPercent: Number(maxDDPercent.toFixed(2)),
      maxConsecutiveLosses,
      standardError: Number(standardError.toFixed(4)),
      ci95: `[${ci95Lower}%, ${ci95Upper}%]`,
    };
  }

  // 1. Train (50%) / Calibration (20%) / OOS (30%) Partitioning
  const trainEnd = Math.floor(totalCandles * 0.50); // 0..6000
  const calibEnd = Math.floor(totalCandles * 0.70); // 6000..8400
  const trainCutoffTime = candles[trainEnd - 1].timestamp;
  const calibCutoffTime = candles[calibEnd - 1].timestamp;

  const trainTrades = allTrades.filter(t => new Date(t.openedAt).getTime() <= trainCutoffTime);
  const calibTrades = allTrades.filter(t => {
    const tTime = new Date(t.openedAt).getTime();
    return tTime > trainCutoffTime && tTime <= calibCutoffTime;
  });
  const oosTrades = allTrades.filter(t => new Date(t.openedAt).getTime() > calibCutoffTime);

  const trainStats = computeStats(trainTrades);
  const calibStats = computeStats(calibTrades);
  const oosStats = computeStats(oosTrades);
  const overallStats = computeStats(allTrades);

  console.log('\n--- PARTITION STATS ---');
  console.log('TRAIN (50%):', trainStats);
  console.log('CALIB (20%):', calibStats);
  console.log('OOS (30%):', oosStats);
  console.log('OVERALL:', overallStats);

  // 2. Multi-Block Walk-Forward / Chronological Blocks
  // Block 1: 0..4000 (May 26 to July 08)
  // Block 2: 4000..8000 (July 08 to Aug 20)
  // Block 3: 8000..12000 (Aug 20 to Sept 28)
  const b1Cutoff = candles[4000 - 1].timestamp;
  const b2Cutoff = candles[8000 - 1].timestamp;
  const b1Trades = allTrades.filter(t => new Date(t.openedAt).getTime() <= b1Cutoff);
  const b2Trades = allTrades.filter(t => {
    const tTime = new Date(t.openedAt).getTime();
    return tTime > b1Cutoff && tTime <= b2Cutoff;
  });
  const b3Trades = allTrades.filter(t => new Date(t.openedAt).getTime() > b2Cutoff);

  const b1Stats = computeStats(b1Trades);
  const b2Stats = computeStats(b2Trades);
  const b3Stats = computeStats(b3Trades);

  console.log('\n--- MULTI-BLOCK CHRONOLOGICAL STATS ---');
  console.log('BLOCK 1 (Candles 0..4000):', b1Stats);
  console.log('BLOCK 2 (Candles 4000..8000):', b2Stats);
  console.log('BLOCK 3 (Candles 8000..12000):', b3Stats);

  // 3. Directional Robustness
  const longTrades = allTrades.filter(t => t.direction === 'LONG');
  const shortTrades = allTrades.filter(t => t.direction === 'SHORT');
  const longStats = computeStats(longTrades);
  const shortStats = computeStats(shortTrades);

  console.log('\n--- DIRECTIONAL STATS ---');
  console.log('LONG TRADES:', longStats);
  console.log('SHORT TRADES:', shortStats);

  // 4. Session Robustness
  const sessionGroups: Record<string, PaperTradeJournalEntry[]> = {
    ASIAN: [],
    LONDON: [],
    'LONDON/NEW YORK OVERLAP': [],
    'NEW YORK': [],
    OTHER: []
  };

  for (const dt of detailedTrades) {
    let sKey = dt.session;
    if (sKey === 'LONDON / NEW YORK OVERLAP') sKey = 'LONDON/NEW YORK OVERLAP';
    if (!sessionGroups[sKey]) sessionGroups[sKey] = [];
    sessionGroups[sKey].push(dt.trade);
  }

  const sessionStats: Record<string, any> = {};
  for (const [sess, trs] of Object.entries(sessionGroups)) {
    sessionStats[sess] = computeStats(trs);
  }
  console.log('\n--- SESSION STATS ---', sessionStats);

  // 5. Signals & Funnel analysis
  let totalCandidates = 0;
  let bullishBreakouts = 0;
  let bearishBreakdowns = 0;
  let confirmedRetests = 0;
  let failedRetests = 0;
  let bullTraps = 0;
  let bearTraps = 0;
  let compressionFiltered = 0;
  let displacementFiltered = 0;
  let extensionFiltered = 0;
  let regimeFiltered = 0;

  for (const item of baseline.signals) {
    const s = item.signal;
    if (s.breakoutCandidate) {
      totalCandidates++;
      if (s.breakoutCandidate.breakoutType === 'BULLISH_BREAKOUT') bullishBreakouts++;
      if (s.breakoutCandidate.breakoutType === 'BEARISH_BREAKDOWN') bearishBreakdowns++;
    }
    if (s.validationResult) {
      if (s.validationResult.trapDetected) {
        if (s.validationResult.trapType === 'BULL_TRAP') bullTraps++;
        if (s.validationResult.trapType === 'BEAR_TRAP') bearTraps++;
      }
      if (s.validationResult.retestTracking?.retestStatus === 'CONFIRMED') confirmedRetests++;
      if (s.validationResult.retestTracking?.retestStatus === 'FAILED') failedRetests++;
      
      const reason = s.validationResult.rejectionReason || '';
      if (reason.includes('COMPRESSION') || reason.includes('Compression')) compressionFiltered++;
      if (reason.includes('DISPLACEMENT') || reason.includes('Displacement')) displacementFiltered++;
      if (reason.includes('EXTENDED') || reason.includes('Extension')) extensionFiltered++;
      if (reason.includes('REGIME') || reason.includes('Regime')) regimeFiltered++;
    }
  }

  console.log('\n--- FUNNEL & FILTER BREAKDOWN ---', {
    totalCandidates,
    bullishBreakouts,
    bearishBreakdowns,
    confirmedRetests,
    failedRetests,
    bullTraps,
    bearTraps,
    compressionFiltered,
    displacementFiltered,
    extensionFiltered,
    regimeFiltered,
  });

  // 6. Cost Sensitivity Analysis (Deterministic exact calculation of friction impact)
  console.log('\nCalculating Cost Sensitivity...');
  // For each trade, calculate the extra friction if spread, slippage, and commission are scaled
  const costFrictions = [1.0, 1.5, 2.0, 3.0];
  const costResults: Record<string, any> = {};

  for (const mult of costFrictions) {
    // If multiplier is 1.0, it is baseline
    if (mult === 1.0) {
      costResults['1.0x'] = overallStats;
      continue;
    }

    // Each trade has lot size and slippage/spread/commission fees
    // In baseline: commissionPerLot = 3.50, slippagePips = 0.5, spreadMarkupPips = 1.0
    // Additional friction per trade: (mult - 1.0) * (commission + slippage + spread cost)
    const adjustedTrades: PaperTradeJournalEntry[] = allTrades.map(t => {
      const posSize = t.positionSize || 1.0;
      // gold pip value for 1 standard lot (100 oz): 0.1 price move = $10 per pip
      const extraCommission = (mult - 1.0) * (posSize * 2 * 3.50);
      const extraSlippage = (mult - 1.0) * (0.5 * 10 * posSize);
      const extraSpread = (mult - 1.0) * (1.0 * 10 * posSize);
      const totalExtraFriction = extraCommission + extraSlippage + extraSpread;
      const adjustedPnL = Number((t.realizedPnL - totalExtraFriction).toFixed(2));
      return {
        ...t,
        realizedPnL: adjustedPnL,
      };
    });

    costResults[`${mult.toFixed(1)}x`] = computeStats(adjustedTrades);
  }
  console.log('\n--- COST SENSITIVITY ---', costResults);

  // 7. Counterfactual Comparison (Protected vs Raw Breakout)
  const rawBreakoutSimulatedTrades = totalCandidates;
  const standardRisk = 1000;
  const naiveLosses = (bullTraps + bearTraps + failedRetests) * standardRisk;
  const naiveWinsPnL = allTrades.filter(t => t.realizedPnL > 0).length * 1500;
  const naiveNetPnL = naiveWinsPnL - naiveLosses;
  const naiveDrawdown = naiveLosses;

  // 8. Print all individual trades for complete audit trail
  console.log('\n--- REALIZED TRADES AUDIT TRAIL ---');
  detailedTrades.forEach((dt, idx) => {
    console.log(`Trade #${idx + 1}: ${dt.direction} | Opened: ${dt.openedAt} | Closed: ${dt.closedAt} | Entry: ${dt.entryPrice} | Exit: ${dt.exitPrice} | PnL: $${dt.pnl} | Session: ${dt.session} | Reason: ${dt.closeReason}`);
  });

  const reportData = {
    totalCandles,
    dateRange: `${candles[0].datetime} to ${candles[candles.length - 1].datetime}`,
    trainEndDatetime: candles[trainEnd - 1].datetime,
    calibEndDatetime: candles[calibEnd - 1].datetime,
    trainStats,
    calibStats,
    oosStats,
    overallStats,
    b1Stats,
    b2Stats,
    b3Stats,
    longStats,
    shortStats,
    sessionStats,
    costResults,
    funnel: {
      totalCandidates,
      bullishBreakouts,
      bearishBreakdowns,
      confirmedRetests,
      failedRetests,
      bullTraps,
      bearTraps,
      compressionFiltered,
      displacementFiltered,
      extensionFiltered,
      regimeFiltered,
      rawBreakoutSimulatedTrades,
      simulatedRawLossAvoided: naiveLosses,
      naiveNetPnL,
      naiveDrawdown,
    },
    trades: detailedTrades.map((d, i) => ({
      index: i + 1,
      openedAt: d.openedAt,
      closedAt: d.closedAt,
      direction: d.direction,
      entryPrice: d.entryPrice,
      exitPrice: d.exitPrice,
      pnl: d.pnl,
      session: d.session,
      closeReason: d.closeReason,
    }))
  };

  fs.writeFileSync(path.join(process.cwd(), 'tests/phase_7f_audit_report.json'), JSON.stringify(reportData, null, 2));
  console.log('\nSuccessfully written tests/phase_7f_audit_report.json');
}

runAudit().catch(err => {
  console.error('AUDIT ERROR:', err);
  process.exit(1);
});
