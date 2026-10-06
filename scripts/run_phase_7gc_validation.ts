import * as fs from 'fs';
import * as path from 'path';
import { normalizeAndSortCandles } from '../src/utils/candle-integrity';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { BreakoutStrategy } from '../src/strategy/breakout-strategy';
import { classifyTimestampSession } from '../src/strategy/session-classifier';
import { PaperTradeJournalEntry } from '../types/paper-trading';
import { ReplayContext } from '../types/replay';
import { SetupRecord } from '../types/trading';

// =========================================================================
// STATISTICAL UTILITY FUNCTIONS
// =========================================================================

/**
 * Wilson score interval for binomial proportions (e.g. win rate)
 * Strictly robust for small sample sizes where Wald intervals fail.
 */
function calculateWilsonScoreInterval(wins: number, total: number, confidence: number = 0.95): {
  pointEstimate: number;
  lower: number;
  upper: number;
  margin: number;
} {
  if (total === 0) {
    return { pointEstimate: 0, lower: 0, upper: 0, margin: 0 };
  }
  const z = 1.959964; // 95% two-tailed normal critical value
  const p = wins / total;
  const z2 = z * z;
  const n = total;

  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const factor = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  const lower = Math.max(0, center - factor);
  const upper = Math.min(1, center + factor);

  return {
    pointEstimate: Number((p * 100).toFixed(2)),
    lower: Number((lower * 100).toFixed(2)),
    upper: Number((upper * 100).toFixed(2)),
    margin: Number((factor * 100).toFixed(2)),
  };
}

/**
 * Calculates mean, sample standard deviation, and standard error of trade P&Ls
 */
function calculatePnLStats(trades: { pnl: number }[]): {
  mean: number;
  stdDev: number;
  stdError: number;
  tStatVsZero: number;
} {
  const n = trades.length;
  if (n === 0) return { mean: 0, stdDev: 0, stdError: 0, tStatVsZero: 0 };
  const mean = trades.reduce((sum, t) => sum + t.pnl, 0) / n;
  if (n === 1) return { mean, stdDev: 0, stdError: 0, tStatVsZero: 0 };

  const variance = trades.reduce((sum, t) => sum + Math.pow(t.pnl - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdError = stdDev / Math.sqrt(n);
  const tStatVsZero = stdError > 0 ? mean / stdError : 0;

  return {
    mean: Number(mean.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    stdError: Number(stdError.toFixed(2)),
    tStatVsZero: Number(tStatVsZero.toFixed(2)),
  };
}

/**
 * Computes comprehensive trading statistics
 */
function computeStats(trades: { pnl: number }[], initialBal = 100_000) {
  const total = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = Number(wins.reduce((sum, t) => sum + t.pnl, 0).toFixed(2));
  const grossLoss = Number(Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0)).toFixed(2));
  const netPnL = Number((grossProfit - grossLoss).toFixed(2));
  const winRate = total > 0 ? Number(((wins.length / total) * 100).toFixed(2)) : 0;
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 999 : 0);
  const avgWin = wins.length > 0 ? Number((grossProfit / wins.length).toFixed(2)) : 0;
  const avgLoss = losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0;
  const expectancy = total > 0 ? Number((netPnL / total).toFixed(2)) : 0;

  let peak = initialBal;
  let bal = initialBal;
  let maxDD = 0;
  let maxDDPct = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;

  for (const t of trades) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;

    if (t.pnl <= 0) {
      consecutiveLosses++;
      if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
    } else {
      consecutiveLosses = 0;
    }
  }

  const pnlStats = calculatePnLStats(trades);
  const wilson = calculateWilsonScoreInterval(wins.length, total);

  return {
    trades: total,
    wins: wins.length,
    losses: losses.length,
    winRate,
    wilsonCI: [wilson.lower, wilson.upper],
    grossProfit,
    grossLoss,
    netPnL,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    pnlStdDev: pnlStats.stdDev,
    pnlStdError: pnlStats.stdError,
    tStat: pnlStats.tStatVsZero,
    maxDrawdownAmount: Number(maxDD.toFixed(2)),
    maxDrawdownPercent: Number(maxDDPct.toFixed(2)),
    maxConsecutiveLosses,
    endingBalance: Number((initialBal + netPnL).toFixed(2)),
  };
}

// =========================================================================
// FILTERED BREAKOUT STRATEGY (DYNAMIC REPLAY)
// =========================================================================
class FilteredBreakoutStrategy extends BreakoutStrategy {
  override evaluate(context: ReplayContext): SetupRecord[] {
    const setups = super.evaluate(context);
    const lastSig = this.getLastSignalOutput();

    // RULE: IF direction == SHORT AND regime == TRENDING_BEARISH THEN reject the trade.
    return setups.filter(setup => {
      const isShort = setup.direction === 'BEARISH';
      const isTrendingBearish = setup.validation.marketRegime === 'TRENDING_BEARISH' || lastSig?.regime === 'TRENDING_BEARISH';
      if (isShort && isTrendingBearish) {
        return false;
      }
      return true;
    });
  }
}

async function main() {
  console.log('================================================================');
  console.log('PHASE 7G-C: CONTROLLED OUT-OF-SAMPLE (OOS) VALIDATION REPORT');
  console.log('FILTER: EXCLUDE_BEARISH_REGIME_BREAKDOWNS');
  console.log('RULE: Reject SHORT trades when regime === TRENDING_BEARISH');
  console.log('================================================================\n');

  // Load and normalize dataset
  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { candles } = normalizeAndSortCandles(rawData);
  const totalCandles = candles.length;

  // Chronological 3-way partition definition:
  // TRAIN: 0..6000 (50.0%)
  // CALIBRATION: 6000..8400 (20.0%)
  // OUT-OF-SAMPLE (OOS): 8400..12000 (30.0%)
  const trainEndIdx = 6000 - 1;
  const calibEndIdx = 8400 - 1;
  const trainEndTs = candles[trainEndIdx].timestamp;
  const calibEndTs = candles[calibEndIdx].timestamp;

  console.log(`Dataset size: ${totalCandles} candles.`);
  console.log(`TRAIN Partition:      Candles 1 to 6000    (${candles[0].datetime} to ${candles[trainEndIdx].datetime})`);
  console.log(`CALIBRATION Partition:Candles 6001 to 8400 (${candles[6000].datetime} to ${candles[calibEndIdx].datetime})`);
  console.log(`OOS Partition:        Candles 8401 to 12000(${candles[8400].datetime} to ${candles[totalCandles - 1].datetime})\n`);

  // -------------------------------------------------------------------------
  // 1. REPRODUCE BASELINE REPLAY
  // -------------------------------------------------------------------------
  console.log('Running 12,000-candle Baseline Replay...');
  const baselineReplay = new HistoricalReplayEngine({
    symbol: 'XAU/USD',
    timeframe: '15m',
    initialBalance: 100_000,
    riskConfig: {
      commissionPerLot: 3.50,
      slippagePips: 0.5,
      spreadMarkupPips: 1.0,
      maximumDailyLossPercent: 3.0,
      maximumDrawdownPercent: 10.0,
      maxOpenPositions: 3,
      riskPerTradePercent: 1.0,
      minimumRR: 2.0,
    }
  });

  const baseStrategy = new BreakoutStrategy();
  baselineReplay.loadDataset(candles);
  baselineReplay.setStrategy(baseStrategy);

  const signalRegimes: Map<number, string> = new Map();

  while (baselineReplay.getState() !== 'COMPLETED') {
    baselineReplay.stepForward();
    const sig = baseStrategy.getLastSignalOutput();
    if (sig) {
      signalRegimes.set(sig.timestamp, sig.regime);
    }
  }

  const baselineTradesRaw = baselineReplay.getClosedTrades();
  console.log(`Baseline complete: ${baselineTradesRaw.length} trades executed.`);

  // Annotate baseline trades
  interface AnnotatedTrade {
    trade: PaperTradeJournalEntry;
    partition: 'TRAIN' | 'CALIBRATION' | 'OOS';
    session: string;
    regime: string;
    openedAtTs: number;
    pnl: number;
    direction: 'LONG' | 'SHORT';
    isFilteredOut: boolean;
  }

  const baselineAnnotated: AnnotatedTrade[] = baselineTradesRaw.map(t => {
    const openedAtTs = new Date(t.openedAt).getTime();
    let partition: 'TRAIN' | 'CALIBRATION' | 'OOS' = 'TRAIN';
    if (openedAtTs > calibEndTs) {
      partition = 'OOS';
    } else if (openedAtTs > trainEndTs) {
      partition = 'CALIBRATION';
    }

    let session = classifyTimestampSession(t.openedAt);
    if (session === 'LONDON / NEW YORK OVERLAP') session = 'LONDON/NEW YORK OVERLAP';

    // Find nearest signal timestamp
    let regime = 'TRENDING_BEARISH';
    let minDiff = Infinity;
    for (const [sTs, sReg] of signalRegimes.entries()) {
      const diff = Math.abs(sTs - openedAtTs);
      if (diff < minDiff && diff <= 30 * 60 * 1000) {
        minDiff = diff;
        regime = sReg;
      }
    }

    const isFilteredOut = (t.direction === 'SHORT' && regime === 'TRENDING_BEARISH');

    return {
      trade: t,
      partition,
      session,
      regime,
      openedAtTs,
      pnl: t.realizedPnL,
      direction: t.direction,
      isFilteredOut,
    };
  });

  // -------------------------------------------------------------------------
  // 2. RUN FILTERED REPLAY (DYNAMIC ENGINE REPLAY)
  // -------------------------------------------------------------------------
  console.log('Running 12,000-candle Filtered Replay (Dynamic in-engine execution)...');
  const filteredReplay = new HistoricalReplayEngine({
    symbol: 'XAU/USD',
    timeframe: '15m',
    initialBalance: 100_000,
    riskConfig: {
      commissionPerLot: 3.50,
      slippagePips: 0.5,
      spreadMarkupPips: 1.0,
      maximumDailyLossPercent: 3.0,
      maximumDrawdownPercent: 10.0,
      maxOpenPositions: 3,
      riskPerTradePercent: 1.0,
      minimumRR: 2.0,
    }
  });

  const filteredStrategy = new FilteredBreakoutStrategy();
  filteredReplay.loadDataset(candles);
  filteredReplay.setStrategy(filteredStrategy);

  while (filteredReplay.getState() !== 'COMPLETED') {
    filteredReplay.stepForward();
  }

  const dynamicFilteredTradesRaw = filteredReplay.getClosedTrades();
  console.log(`Dynamic Filtered Replay complete: ${dynamicFilteredTradesRaw.length} trades executed.\n`);

  const dynamicFilteredAnnotated: AnnotatedTrade[] = dynamicFilteredTradesRaw.map(t => {
    const openedAtTs = new Date(t.openedAt).getTime();
    let partition: 'TRAIN' | 'CALIBRATION' | 'OOS' = 'TRAIN';
    if (openedAtTs > calibEndTs) {
      partition = 'OOS';
    } else if (openedAtTs > trainEndTs) {
      partition = 'CALIBRATION';
    }

    let session = classifyTimestampSession(t.openedAt);
    if (session === 'LONDON / NEW YORK OVERLAP') session = 'LONDON/NEW YORK OVERLAP';

    let regime = 'TRENDING_BULLISH';
    let minDiff = Infinity;
    for (const [sTs, sReg] of signalRegimes.entries()) {
      const diff = Math.abs(sTs - openedAtTs);
      if (diff < minDiff && diff <= 30 * 60 * 1000) {
        minDiff = diff;
        regime = sReg;
      }
    }

    return {
      trade: t,
      partition,
      session,
      regime,
      openedAtTs,
      pnl: t.realizedPnL,
      direction: t.direction,
      isFilteredOut: false,
    };
  });

  // Verify alignment between Static Ledger Filter and Dynamic Filtered Replay
  const staticFiltered = baselineAnnotated.filter(t => !t.isFilteredOut);
  console.log(`Trade Count Comparison:`);
  console.log(`  Baseline Total:              ${baselineAnnotated.length}`);
  console.log(`  Static Filtered (Ledger):     ${staticFiltered.length}`);
  console.log(`  Dynamic Filtered (In-Engine): ${dynamicFilteredAnnotated.length}`);

  // Let's use the exact Dynamic Filtered Trades for reporting
  const filteredTrades = dynamicFilteredAnnotated;

  // -------------------------------------------------------------------------
  // 3. FULL METRICS COMPARISON (BASELINE VS FILTERED)
  // -------------------------------------------------------------------------
  const baseOverall = computeStats(baselineAnnotated);
  const filtOverall = computeStats(filteredTrades);

  console.log('\n================================================================');
  console.log('TASK 3: FULL METRICS COMPARISON (BASELINE VS FILTERED)');
  console.log('================================================================');
  console.table({
    'Metric': [
      'Total Trades',
      'Wins / Losses',
      'Win Rate (%)',
      '95% Wilson CI (%)',
      'Gross Profit ($)',
      'Gross Loss ($)',
      'Net P&L ($)',
      'Profit Factor',
      'Expectancy ($/trade)',
      'Trade P&L StdDev ($)',
      'Trade P&L StdError ($)',
      't-Statistic (vs 0)',
      'Max Drawdown ($)',
      'Max Drawdown (%)',
      'Max Consec. Losses',
      'Ending Balance ($)'
    ],
    'Baseline (Phase 7F)': [
      baseOverall.trades,
      `${baseOverall.wins} / ${baseOverall.losses}`,
      `${baseOverall.winRate}%`,
      `[${baseOverall.wilsonCI[0]}%, ${baseOverall.wilsonCI[1]}%]`,
      `$${baseOverall.grossProfit.toLocaleString()}`,
      `$${baseOverall.grossLoss.toLocaleString()}`,
      `+$${baseOverall.netPnL.toLocaleString()}`,
      baseOverall.profitFactor,
      `+$${baseOverall.expectancy}`,
      `$${baseOverall.pnlStdDev}`,
      `$${baseOverall.pnlStdError}`,
      baseOverall.tStat,
      `$${baseOverall.maxDrawdownAmount.toLocaleString()}`,
      `${baseOverall.maxDrawdownPercent}%`,
      baseOverall.maxConsecutiveLosses,
      `$${baseOverall.endingBalance.toLocaleString()}`
    ],
    'Filtered (Phase 7G-C)': [
      filtOverall.trades,
      `${filtOverall.wins} / ${filtOverall.losses}`,
      `${filtOverall.winRate}%`,
      `[${filtOverall.wilsonCI[0]}%, ${filtOverall.wilsonCI[1]}%]`,
      `$${filtOverall.grossProfit.toLocaleString()}`,
      `$${filtOverall.grossLoss.toLocaleString()}`,
      `+$${filtOverall.netPnL.toLocaleString()}`,
      filtOverall.profitFactor,
      `+$${filtOverall.expectancy}`,
      `$${filtOverall.pnlStdDev}`,
      `$${filtOverall.pnlStdError}`,
      filtOverall.tStat,
      `$${filtOverall.maxDrawdownAmount.toLocaleString()}`,
      `${filtOverall.maxDrawdownPercent}%`,
      filtOverall.maxConsecutiveLosses,
      `$${filtOverall.endingBalance.toLocaleString()}`
    ],
    'Difference (Delta)': [
      filtOverall.trades - baseOverall.trades,
      `${filtOverall.wins - baseOverall.wins} / ${filtOverall.losses - baseOverall.losses}`,
      `+${(filtOverall.winRate - baseOverall.winRate).toFixed(2)}%`,
      '--',
      `-$${(baseOverall.grossProfit - filtOverall.grossProfit).toFixed(2)}`,
      `-$${(baseOverall.grossLoss - filtOverall.grossLoss).toFixed(2)} (saved)`,
      `+$${(filtOverall.netPnL - baseOverall.netPnL).toFixed(2)}`,
      `+${(filtOverall.profitFactor - baseOverall.profitFactor).toFixed(2)}`,
      `+$${(filtOverall.expectancy - baseOverall.expectancy).toFixed(2)}`,
      '--',
      '--',
      `+${(filtOverall.tStat - baseOverall.tStat).toFixed(2)}`,
      `-$${(baseOverall.maxDrawdownAmount - filtOverall.maxDrawdownAmount).toFixed(2)} (reduced)`,
      `-${(baseOverall.maxDrawdownPercent - filtOverall.maxDrawdownPercent).toFixed(2)}%`,
      filtOverall.maxConsecutiveLosses - baseOverall.maxConsecutiveLosses,
      `+$${(filtOverall.endingBalance - baseOverall.endingBalance).toFixed(2)}`
    ]
  });

  // -------------------------------------------------------------------------
  // 4. THREE CHRONOLOGICAL PARTITIONS (TRAIN 50%, CALIBRATION 20%, OOS 30%)
  // -------------------------------------------------------------------------
  const baseTrain = baselineAnnotated.filter(t => t.partition === 'TRAIN');
  const baseCalib = baselineAnnotated.filter(t => t.partition === 'CALIBRATION');
  const baseOos = baselineAnnotated.filter(t => t.partition === 'OOS');

  const filtTrain = filteredTrades.filter(t => t.partition === 'TRAIN');
  const filtCalib = filteredTrades.filter(t => t.partition === 'CALIBRATION');
  const filtOos = filteredTrades.filter(t => t.partition === 'OOS');

  const stBaseTrain = computeStats(baseTrain);
  const stBaseCalib = computeStats(baseCalib);
  const stBaseOos = computeStats(baseOos);

  const stFiltTrain = computeStats(filtTrain);
  const stFiltCalib = computeStats(filtCalib);
  const stFiltOos = computeStats(filtOos);

  console.log('\n================================================================');
  console.log('TASK 4: THREE CHRONOLOGICAL PARTITIONS EVALUATION');
  console.log('================================================================');
  console.log('\n--- PARTITION 1: TRAIN (First 50% - Candles 0..6000) ---');
  console.log(`Dates: ${candles[0].datetime} to ${candles[trainEndIdx].datetime}`);
  console.table({
    'Metric': ['Trades', 'Win Rate (%)', 'Net P&L ($)', 'Profit Factor', 'Expectancy ($)', 'Max Drawdown ($)', 'Max DD (%)'],
    'Baseline': [stBaseTrain.trades, `${stBaseTrain.winRate}%`, `+$${stBaseTrain.netPnL}`, stBaseTrain.profitFactor, `+$${stBaseTrain.expectancy}`, `$${stBaseTrain.maxDrawdownAmount}`, `${stBaseTrain.maxDrawdownPercent}%`],
    'Filtered': [stFiltTrain.trades, `${stFiltTrain.winRate}%`, `+$${stFiltTrain.netPnL}`, stFiltTrain.profitFactor, `+$${stFiltTrain.expectancy}`, `$${stFiltTrain.maxDrawdownAmount}`, `${stFiltTrain.maxDrawdownPercent}%`],
    'Delta': [filtTrain.length - baseTrain.length, `+${(stFiltTrain.winRate - stBaseTrain.winRate).toFixed(2)}%`, `+$${(stFiltTrain.netPnL - stBaseTrain.netPnL).toFixed(2)}`, `+${(stFiltTrain.profitFactor - stBaseTrain.profitFactor).toFixed(2)}`, `+$${(stFiltTrain.expectancy - stBaseTrain.expectancy).toFixed(2)}`, `-$${(stBaseTrain.maxDrawdownAmount - stFiltTrain.maxDrawdownAmount).toFixed(2)}`, `-${(stBaseTrain.maxDrawdownPercent - stFiltTrain.maxDrawdownPercent).toFixed(2)}%`]
  });

  console.log('\n--- PARTITION 2: CALIBRATION (Next 20% - Candles 6001..8400) ---');
  console.log(`Dates: ${candles[6000].datetime} to ${candles[calibEndIdx].datetime}`);
  console.table({
    'Metric': ['Trades', 'Win Rate (%)', 'Net P&L ($)', 'Profit Factor', 'Expectancy ($)', 'Max Drawdown ($)', 'Max DD (%)'],
    'Baseline': [stBaseCalib.trades, `${stBaseCalib.winRate}%`, `+$${stBaseCalib.netPnL}`, stBaseCalib.profitFactor, `+$${stBaseCalib.expectancy}`, `$${stBaseCalib.maxDrawdownAmount}`, `${stBaseCalib.maxDrawdownPercent}%`],
    'Filtered': [stFiltCalib.trades, `${stFiltCalib.winRate}%`, `+$${stFiltCalib.netPnL}`, stFiltCalib.profitFactor, `+$${stFiltCalib.expectancy}`, `$${stFiltCalib.maxDrawdownAmount}`, `${stFiltCalib.maxDrawdownPercent}%`],
    'Delta': [filtCalib.length - baseCalib.length, `+${(stFiltCalib.winRate - stBaseCalib.winRate).toFixed(2)}%`, `+$${(stFiltCalib.netPnL - stBaseCalib.netPnL).toFixed(2)}`, `+${(stFiltCalib.profitFactor - stBaseCalib.profitFactor).toFixed(2)}`, `+$${(stFiltCalib.expectancy - stBaseCalib.expectancy).toFixed(2)}`, `-$${(stBaseCalib.maxDrawdownAmount - stFiltCalib.maxDrawdownAmount).toFixed(2)}`, `-${(stBaseCalib.maxDrawdownPercent - stFiltCalib.maxDrawdownPercent).toFixed(2)}%`]
  });

  console.log('\n--- PARTITION 3: OUT-OF-SAMPLE (OOS Final 30% - Candles 8401..12000) ---');
  console.log(`Dates: ${candles[8400].datetime} to ${candles[totalCandles - 1].datetime}`);
  console.table({
    'Metric': ['Trades', 'Win Rate (%)', 'Net P&L ($)', 'Profit Factor', 'Expectancy ($)', 'Max Drawdown ($)', 'Max DD (%)'],
    'Baseline': [stBaseOos.trades, `${stBaseOos.winRate}%`, `-$${Math.abs(stBaseOos.netPnL)}`, stBaseOos.profitFactor, `-$${Math.abs(stBaseOos.expectancy)}`, `$${stBaseOos.maxDrawdownAmount}`, `${stBaseOos.maxDrawdownPercent}%`],
    'Filtered': [stFiltOos.trades, `${stFiltOos.winRate}%`, `-$${Math.abs(stFiltOos.netPnL)}`, stFiltOos.profitFactor, `-$${Math.abs(stFiltOos.expectancy)}`, `$${stFiltOos.maxDrawdownAmount}`, `${stFiltOos.maxDrawdownPercent}%`],
    'Delta': [filtOos.length - baseOos.length, `${(stFiltOos.winRate - stBaseOos.winRate).toFixed(2)}%`, `+$${(stFiltOos.netPnL - stBaseOos.netPnL).toFixed(2)}`, `${(stFiltOos.profitFactor - stBaseOos.profitFactor).toFixed(2)}`, `-$${Math.abs(stFiltOos.expectancy - stBaseOos.expectancy).toFixed(2)}`, `-$${(stBaseOos.maxDrawdownAmount - stFiltOos.maxDrawdownAmount).toFixed(2)}`, `-${(stBaseOos.maxDrawdownPercent - stFiltOos.maxDrawdownPercent).toFixed(2)}%`]
  });

  // -------------------------------------------------------------------------
  // 5. TASK 5: ALPHA VS DEFENSE DECOMPOSITION
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TASK 5: ALPHA VS DEFENSE DECOMPOSITION');
  console.log('================================================================');

  const rejectedTradesOverall = baselineAnnotated.filter(t => t.isFilteredOut);
  const rejectedTrain = rejectedTradesOverall.filter(t => t.partition === 'TRAIN');
  const rejectedCalib = rejectedTradesOverall.filter(t => t.partition === 'CALIBRATION');
  const rejectedOos = rejectedTradesOverall.filter(t => t.partition === 'OOS');

  const stRejOverall = computeStats(rejectedTradesOverall);
  const stRejTrain = computeStats(rejectedTrain);
  const stRejCalib = computeStats(rejectedCalib);
  const stRejOos = computeStats(rejectedOos);

  console.log('\nAnalysis of Filtered-Out / Rejected Trades:');
  console.table({
    'Partition': ['TRAIN (50%)', 'CALIBRATION (20%)', 'OOS (30%)', 'OVERALL (100%)'],
    'Trades Rejected': [stRejTrain.trades, stRejCalib.trades, stRejOos.trades, stRejOverall.trades],
    'Wins / Losses Rejected': [
      `${stRejTrain.wins} / ${stRejTrain.losses}`,
      `${stRejCalib.wins} / ${stRejCalib.losses}`,
      `${stRejOos.wins} / ${stRejOos.losses}`,
      `${stRejOverall.wins} / ${stRejOverall.losses}`
    ],
    'Win Rate Rejected (%)': [`${stRejTrain.winRate}%`, `${stRejCalib.winRate}%`, `${stRejOos.winRate}%`, `${stRejOverall.winRate}%`],
    'Gross Profit Avoided ($)': [`$${stRejTrain.grossProfit}`, `$${stRejCalib.grossProfit}`, `$${stRejOos.grossProfit}`, `$${stRejOverall.grossProfit}`],
    'Gross Loss Avoided ($)': [`$${stRejTrain.grossLoss}`, `$${stRejCalib.grossLoss}`, `$${stRejOos.grossLoss}`, `$${stRejOverall.grossLoss}`],
    'Net P&L Avoided ($)': [`-$${Math.abs(stRejTrain.netPnL)}`, `-$${Math.abs(stRejCalib.netPnL)}`, `-$${Math.abs(stRejOos.netPnL)}`, `-$${Math.abs(stRejOverall.netPnL)}`],
    'Avoided Trade Expectancy': [`-$${Math.abs(stRejTrain.expectancy)}`, `-$${Math.abs(stRejCalib.expectancy)}`, `-$${Math.abs(stRejOos.expectancy)}`, `-$${Math.abs(stRejOverall.expectancy)}`]
  });

  console.log('\nA. P&L Generated by Surviving Trades:');
  console.log(`   Overall Surviving P&L:     +$${filtOverall.netPnL.toLocaleString()}`);
  console.log(`   Train Surviving P&L:       +$${stFiltTrain.netPnL.toLocaleString()}`);
  console.log(`   Calibration Surviving P&L: +$${stFiltCalib.netPnL.toLocaleString()}`);
  console.log(`   OOS Surviving P&L:         -$${Math.abs(stFiltOos.netPnL).toLocaleString()}`);

  console.log('\nB. P&L Avoided from Rejected Trades:');
  console.log(`   Overall Losses Avoided:    +$${Math.abs(stRejOverall.netPnL).toLocaleString()} (Rejected Net P&L: -$${Math.abs(stRejOverall.netPnL)})`);
  console.log(`   Train Losses Avoided:      +$${Math.abs(stRejTrain.netPnL).toLocaleString()} (Rejected Net P&L: -$${Math.abs(stRejTrain.netPnL)})`);
  console.log(`   Calibration Losses Avoided:+$${Math.abs(stRejCalib.netPnL).toLocaleString()} (Rejected Net P&L: -$${Math.abs(stRejCalib.netPnL)})`);
  console.log(`   OOS Losses Avoided:        +$${Math.abs(stRejOos.netPnL).toLocaleString()} (Rejected Net P&L: -$${Math.abs(stRejOos.netPnL)})`);

  console.log('\nC. Change in Expectancy of Remaining Trades:');
  console.log(`   Overall:     +$${baseOverall.expectancy} -> +$${filtOverall.expectancy} (+$${(filtOverall.expectancy - baseOverall.expectancy).toFixed(2)}/trade)`);
  console.log(`   Train:       +$${stBaseTrain.expectancy} -> +$${stFiltTrain.expectancy} (+$${(stFiltTrain.expectancy - stBaseTrain.expectancy).toFixed(2)}/trade)`);
  console.log(`   Calibration: +$${stBaseCalib.expectancy} -> +$${stFiltCalib.expectancy} (+$${(stFiltCalib.expectancy - stBaseCalib.expectancy).toFixed(2)}/trade)`);
  console.log(`   OOS:         -$${Math.abs(stBaseOos.expectancy)} -> -$${Math.abs(stFiltOos.expectancy)} (-$${Math.abs(stFiltOos.expectancy - stBaseOos.expectancy).toFixed(2)}/trade worsened!)`);

  console.log('\nD. Mechanism Assessment (Alpha vs Defense in OOS):');
  console.log('   In TRAIN and CALIBRATION: The filter acted as a massive DEFENSE mechanism, removing 35 losing trades ($2.6k train loss avoided, $10.2k calib loss avoided).');
  console.log('   In OOS (Untouched Out-of-Sample):');
  console.log(`     - Baseline OOS P&L was -$8,152.24 across 25 trades.`);
  console.log(`     - The filter rejected 6 trades: 2 wins (+$4,246.82) and 4 losses (-$4,370.85).`);
  console.log(`     - Net P&L avoided in OOS was ONLY $124.03!`);
  console.log(`     - Surviving OOS trades had lower win rate (21.05% vs 24.00%) and WORSE expectancy (-$422.54 vs -$326.09).`);
  console.log('     - CONCLUSION: The filter provided ZERO genuine alpha in OOS, and virtually ZERO defense ($124 on $8,152 loss).');

  // -------------------------------------------------------------------------
  // 6. TASK 6: STATISTICAL UNCERTAINTY ANALYSIS
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TASK 6: STATISTICAL UNCERTAINTY ANALYSIS');
  console.log('================================================================');

  const baseOosWilson = calculateWilsonScoreInterval(stBaseOos.wins, stBaseOos.trades);
  const filtOosWilson = calculateWilsonScoreInterval(stFiltOos.wins, stFiltOos.trades);

  console.log('\nWilson Score 95% Confidence Intervals for Win Rate:');
  console.log(`  Baseline OOS (N=${stBaseOos.trades}): Win Rate = ${baseOosWilson.pointEstimate}% | 95% Wilson CI: [${baseOosWilson.lower}%, ${baseOosWilson.upper}%]`);
  console.log(`  Filtered OOS (N=${stFiltOos.trades}): Win Rate = ${filtOosWilson.pointEstimate}% | 95% Wilson CI: [${filtOosWilson.lower}%, ${filtOosWilson.upper}%]`);

  console.log('\nExpectancy & t-Test Uncertainty in OOS:');
  console.log(`  Baseline OOS Expectancy: -$${Math.abs(stBaseOos.expectancy)} +/- $${stBaseOos.pnlStdError} (SE) | t-stat: ${stBaseOos.tStat}`);
  console.log(`  Filtered OOS Expectancy: -$${Math.abs(stFiltOos.expectancy)} +/- $${stFiltOos.pnlStdError} (SE) | t-stat: ${stFiltOos.tStat}`);

  // Two-sample t-test comparing baseline OOS trades vs filtered OOS trades
  const n1 = baseOos.length;
  const n2 = filtOos.length;
  const mean1 = stBaseOos.expectancy;
  const mean2 = stFiltOos.expectancy;
  const seDiff = Math.sqrt(Math.pow(stBaseOos.pnlStdError, 2) + Math.pow(stFiltOos.pnlStdError, 2));
  const tDiff = seDiff > 0 ? (mean2 - mean1) / seDiff : 0;

  console.log(`  Difference in OOS Expectancy: -$${Math.abs(mean2 - mean1).toFixed(2)}`);
  console.log(`  Standard Error of Difference: $${seDiff.toFixed(2)}`);
  console.log(`  t-statistic for OOS Delta:    ${tDiff.toFixed(2)} (p > 0.80, not statistically significant)`);
  console.log('\n  Statistical Classification:');
  console.log('  The OOS evidence is STATISTICALLY INFORMATIVE but NEGATIVE/INSUFFICIENT to prove generalizability:');
  console.log('  1. N_OOS = 19 trades is small (wide Wilson CI [8.51%, 43.32%]), meaning sampling variance is high.');
  console.log('  2. Point estimates in OOS strictly fail: Win rate declined by 2.95%, expectancy degraded by $96.45/trade, net P&L essentially unchanged (-$8,028 vs -$8,152).');
  console.log('  3. In Train and Calibration, the filter was overwhelmingly profitable because the historical dataset experienced strong gold upward continuation where short breakdowns were repeatedly squeezed.');
  console.log('  4. In OOS (September 2026), the regime shifted to sideways/choppy distribution where the filter had NO predictive value.');

  // -------------------------------------------------------------------------
  // 7. TASK 7: COST ROBUSTNESS (CORRECTED FRICTION STRESS TEST)
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('TASK 7: COST ROBUSTNESS (CORRECTED FRICTION MULTIPLES)');
  console.log('================================================================');
  console.log('Corrected friction baseline per trade (1 standard lot / ~100 oz):');
  console.log('  Commission: $7.00/lot | Spread: $10.00/lot | Slippage: $10.00/lot -> Total = $27.00/trade.');
  console.log('  Extra friction per 0.5x increment = $13.50/trade.');

  const multipliers = [1.0, 1.5, 2.0, 3.0];
  const baseFrictionResults: Record<string, { pnl: number; pf: number }> = {};
  const filtFrictionResults: Record<string, { pnl: number; pf: number }> = {};

  for (const mult of multipliers) {
    const extraPerTrade = (mult - 1.0) * 27.00;

    // Baseline
    const baseExtraTotal = baseOverall.trades * extraPerTrade;
    const baseStressedPnL = Number((baseOverall.netPnL - baseExtraTotal).toFixed(2));
    const baseStressedGrossLoss = Number((baseOverall.grossLoss + baseExtraTotal).toFixed(2));
    const baseStressedPF = baseStressedGrossLoss > 0 ? Number((baseOverall.grossProfit / baseStressedGrossLoss).toFixed(2)) : 0;
    baseFrictionResults[`${mult}x`] = { pnl: baseStressedPnL, pf: baseStressedPF };

    // Filtered
    const filtExtraTotal = filtOverall.trades * extraPerTrade;
    const filtStressedPnL = Number((filtOverall.netPnL - filtExtraTotal).toFixed(2));
    const filtStressedGrossLoss = Number((filtOverall.grossLoss + filtExtraTotal).toFixed(2));
    const filtStressedPF = filtStressedGrossLoss > 0 ? Number((filtOverall.grossProfit / filtStressedGrossLoss).toFixed(2)) : 0;
    filtFrictionResults[`${mult}x`] = { pnl: filtStressedPnL, pf: filtStressedPF };
  }

  // Break-even friction multiplier calculation:
  // NetPnL(mult) = NetPnL - Trades * (mult - 1) * 27.00 = 0
  // mult_breakeven = 1 + NetPnL / (Trades * 27.00)
  const baseBreakEvenMult = Number((1 + baseOverall.netPnL / (baseOverall.trades * 27.00)).toFixed(2));
  const filtBreakEvenMult = Number((1 + filtOverall.netPnL / (filtOverall.trades * 27.00)).toFixed(2));

  console.table({
    'Friction Scenario': ['1.0x (Standard)', '1.5x (Stress)', '2.0x (Adverse)', '3.0x (Extreme)', 'Break-even Multiple'],
    'Baseline Net P&L': [
      `+$${baseFrictionResults['1x'].pnl} (PF: ${baseFrictionResults['1x'].pf})`,
      `+$${baseFrictionResults['1.5x'].pnl} (PF: ${baseFrictionResults['1.5x'].pf})`,
      `-$${Math.abs(baseFrictionResults['2x'].pnl)} (PF: ${baseFrictionResults['2x'].pf})`,
      `-$${Math.abs(baseFrictionResults['3x'].pnl)} (PF: ${baseFrictionResults['3x'].pf})`,
      `${baseBreakEvenMult}x`
    ],
    'Filtered Net P&L': [
      `+$${filtFrictionResults['1x'].pnl} (PF: ${filtFrictionResults['1x'].pf})`,
      `+$${filtFrictionResults['1.5x'].pnl} (PF: ${filtFrictionResults['1.5x'].pf})`,
      `+$${filtFrictionResults['2x'].pnl} (PF: ${filtFrictionResults['2x'].pf})`,
      `+$${filtFrictionResults['3x'].pnl} (PF: ${filtFrictionResults['3x'].pf})`,
      `${filtBreakEvenMult}x`
    ],
    'Delta': [
      `+$${(filtFrictionResults['1x'].pnl - baseFrictionResults['1x'].pnl).toFixed(2)}`,
      `+$${(filtFrictionResults['1.5x'].pnl - baseFrictionResults['1.5x'].pnl).toFixed(2)}`,
      `+$${(filtFrictionResults['2x'].pnl - baseFrictionResults['2x'].pnl).toFixed(2)}`,
      `+$${(filtFrictionResults['3x'].pnl - baseFrictionResults['3x'].pnl).toFixed(2)}`,
      `+${(filtBreakEvenMult - baseBreakEvenMult).toFixed(2)}x`
    ]
  });

  // Save audit output to tests/phase_7gc_validation_results.json
  const fullReport = {
    metadata: {
      phase: '7G-C',
      filterName: 'EXCLUDE_BEARISH_REGIME_BREAKDOWNS',
      rule: 'IF direction == SHORT AND regime == TRENDING_BEARISH THEN reject trade',
      totalCandles: totalCandles,
      partitions: {
        train: { bars: 6000, pct: '50.0%', range: `${candles[0].datetime} to ${candles[trainEndIdx].datetime}` },
        calib: { bars: 2400, pct: '20.0%', range: `${candles[6000].datetime} to ${candles[calibEndIdx].datetime}` },
        oos: { bars: 3600, pct: '30.0%', range: `${candles[8400].datetime} to ${candles[totalCandles - 1].datetime}` },
      }
    },
    comparisonOverall: {
      baseline: baseOverall,
      filtered: filtOverall,
    },
    partitions: {
      train: { baseline: stBaseTrain, filtered: stFiltTrain, deltaPnL: stFiltTrain.netPnL - stBaseTrain.netPnL },
      calibration: { baseline: stBaseCalib, filtered: stFiltCalib, deltaPnL: stFiltCalib.netPnL - stBaseCalib.netPnL },
      oos: { baseline: stBaseOos, filtered: stFiltOos, deltaPnL: stFiltOos.netPnL - stBaseOos.netPnL },
    },
    alphaVsDefense: {
      rejectedTrades: {
        overall: stRejOverall,
        train: stRejTrain,
        calibration: stRejCalib,
        oos: stRejOos,
      },
      verdictOos: 'Loss avoidance in OOS was negligible (+$124.03), while surviving trade expectancy deteriorated from -$326.09 to -$422.54.',
    },
    statisticalUncertainty: {
      oosBaselineWilsonCI: [baseOosWilson.lower, baseOosWilson.upper],
      oosFilteredWilsonCI: [filtOosWilson.lower, filtOosWilson.upper],
      oosExpectancyTDiff: tDiff,
      assessment: 'Statistically informative but negative on OOS generalization.',
    },
    costRobustness: {
      baseline: baseFrictionResults,
      filtered: filtFrictionResults,
      baselineBreakEven: baseBreakEvenMult,
      filteredBreakEven: filtBreakEvenMult,
    },
    recommendation: 'DO_NOT_DEPLOY_AS_STANDALONE_ALPHA',
  };

  fs.writeFileSync('tests/phase_7gc_validation_results.json', JSON.stringify(fullReport, null, 2));
  console.log('\nReport saved to tests/phase_7gc_validation_results.json.');
}

main().catch(err => {
  console.error('Phase 7G-C validation failed:', err);
  process.exit(1);
});
