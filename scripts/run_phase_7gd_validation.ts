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

function calculateWilsonScoreInterval(wins: number, total: number): {
  pointEstimate: number;
  lower: number;
  upper: number;
  margin: number;
} {
  if (total === 0) return { pointEstimate: 0, lower: 0, upper: 0, margin: 0 };
  const z = 1.959964; // 95% critical value
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

function calculatePnLStats(trades: { pnl: number }[]): {
  mean: number;
  stdDev: number;
  stdError: number;
  tStatVsZero: number;
} {
  const n = trades.length;
  if (n === 0) return { mean: 0, stdDev: 0, stdError: 0, tStatVsZero: 0 };
  const mean = trades.reduce((sum, t) => sum + t.pnl, 0) / n;
  if (n === 1) return { mean: Number(mean.toFixed(2)), stdDev: 0, stdError: 0, tStatVsZero: 0 };

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

interface PerformanceStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  wilsonCI: [number, number];
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  pnlStdDev: number;
  pnlStdError: number;
  tStat: number;
  maxDrawdownAmount: number;
  maxDrawdownPercent: number;
  maxConsecutiveLosses: number;
  endingBalance: number;
}

function computeStats(trades: { pnl: number }[], initialBal = 100_000): PerformanceStats {
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
// STRATEGY SUB-CLASSES FOR DYNAMIC REPLAY
// =========================================================================

// Filter A: Reject SHORT if MarketRegime === TRENDING_BEARISH
class FilterAStrategy extends BreakoutStrategy {
  override evaluate(context: ReplayContext): SetupRecord[] {
    const setups = super.evaluate(context);
    const lastSig = this.getLastSignalOutput();
    return setups.filter(setup => {
      const isShort = setup.direction === 'BEARISH';
      const isTrendingBearish = setup.validation.marketRegime === 'TRENDING_BEARISH' || lastSig?.regime === 'TRENDING_BEARISH';
      return !(isShort && isTrendingBearish);
    });
  }
}

// Filter B: Reject if entryTime in [00:00 UTC, 07:00 UTC)
class FilterBStrategy extends BreakoutStrategy {
  override evaluate(context: ReplayContext): SetupRecord[] {
    const setups = super.evaluate(context);
    const date = new Date(context.timestamp);
    const hour = date.getUTCHours();
    const isAsian = hour >= 0 && hour < 7;
    return setups.filter(() => !isAsian);
  }
}

// Combined Filter AB: Reject if A OR B
class FilterABStrategy extends BreakoutStrategy {
  override evaluate(context: ReplayContext): SetupRecord[] {
    const setups = super.evaluate(context);
    const lastSig = this.getLastSignalOutput();
    const date = new Date(context.timestamp);
    const hour = date.getUTCHours();
    const isAsian = hour >= 0 && hour < 7;

    return setups.filter(setup => {
      const isShort = setup.direction === 'BEARISH';
      const isTrendingBearish = setup.validation.marketRegime === 'TRENDING_BEARISH' || lastSig?.regime === 'TRENDING_BEARISH';
      const rejectA = isShort && isTrendingBearish;
      const rejectB = isAsian;
      return !(rejectA || rejectB);
    });
  }
}

// =========================================================================
// MAIN PIPELINE
// =========================================================================
async function main() {
  console.log('================================================================');
  console.log('PHASE 7G-D: COMBINED FILTER CONTROLLED OOS VALIDATION');
  console.log('Filters:');
  console.log('  A:  Reject SHORT if regime === TRENDING_BEARISH');
  console.log('  B:  Reject if 00:00 UTC <= entryTime < 07:00 UTC (Asian Session)');
  console.log('  AB: Reject if A OR B');
  console.log('================================================================\n');

  // 1. DATA AUDIT & INTEGRITY CHECK
  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Data file not found:', dataPath);
    process.exit(1);
  }
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { candles } = normalizeAndSortCandles(rawData);
  const totalCandles = candles.length;

  // Verify Integrity
  let dupCount = 0;
  let ohlcViolations = 0;
  const seenTs = new Set<number>();
  for (let i = 0; i < totalCandles; i++) {
    const c = candles[i];
    if (seenTs.has(c.timestamp)) dupCount++;
    seenTs.add(c.timestamp);
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      ohlcViolations++;
    }
  }

  const firstCandle = candles[0];
  const lastCandle = candles[totalCandles - 1];
  const trainEndIdx = 6000 - 1;
  const calibEndIdx = 8400 - 1;
  const trainEndTs = candles[trainEndIdx].timestamp;
  const calibEndTs = candles[calibEndIdx].timestamp;

  console.log('--- DATA INTEGRITY VERIFICATION ---');
  console.log(`Bars: ${totalCandles} (expected 12,000)`);
  console.log(`Start: ${firstCandle.datetime} (ts: ${firstCandle.timestamp})`);
  console.log(`End:   ${lastCandle.datetime} (ts: ${lastCandle.timestamp})`);
  console.log(`Duplicates: ${dupCount}, OHLC Violations: ${ohlcViolations}`);
  console.log(`TRAIN (50%):       Candles 1..6000    (${firstCandle.datetime} -> ${candles[trainEndIdx].datetime})`);
  console.log(`CALIBRATION (20%): Candles 6001..8400 (${candles[6000].datetime} -> ${candles[calibEndIdx].datetime})`);
  console.log(`OOS (30%):         Candles 8401..12000(${candles[8400].datetime} -> ${lastCandle.datetime})\n`);

  if (totalCandles !== 12000 || dupCount > 0 || ohlcViolations > 0) {
    console.error('Integrity check failed! Halting validation.');
    process.exit(1);
  }

  // Common configuration
  const riskConfig = {
    commissionPerLot: 3.50,
    slippagePips: 0.5,
    spreadMarkupPips: 1.0,
    maximumDailyLossPercent: 3.0,
    maximumDrawdownPercent: 10.0,
    maxOpenPositions: 3,
    riskPerTradePercent: 1.0,
    minimumRR: 2.0,
  };

  // Helper to run a simulation
  interface AnnotatedSimTrade {
    trade: PaperTradeJournalEntry;
    partition: 'TRAIN' | 'CALIBRATION' | 'OOS';
    session: string;
    regime: string;
    openedAtTs: number;
    pnl: number;
    direction: 'LONG' | 'SHORT';
  }

  async function runReplay(name: string, strategyFactory: () => BreakoutStrategy): Promise<{
    trades: AnnotatedSimTrade[];
    regimeSignals: Map<number, string>;
  }> {
    const cacheFile = path.join(process.cwd(), `tests/sim_cache_${name.toLowerCase()}.json`);
    let rawTrades: PaperTradeJournalEntry[] = [];
    let regimeSignalList: [number, string][] = [];

    if (fs.existsSync(cacheFile)) {
      console.log(`[${name}] Loading cached simulation results from ${cacheFile}...`);
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      rawTrades = cached.trades;
      regimeSignalList = cached.regimeSignals;
    } else {
      console.log(`[${name}] Running simulation across 12,000 candles...`);
      const strategyInstance = strategyFactory();
      const replay = new HistoricalReplayEngine({
        symbol: 'XAU/USD',
        timeframe: '15m',
        initialBalance: 100_000,
        riskConfig,
      });

      replay.loadDataset(candles);
      replay.setStrategy(strategyInstance);

      const regimeSignals = new Map<number, string>();
      const t0 = Date.now();

      while (replay.getState() !== 'COMPLETED') {
        replay.stepForward();
        const sig = strategyInstance.getLastSignalOutput();
        if (sig) {
          regimeSignals.set(sig.timestamp, sig.regime);
        }
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      rawTrades = replay.getClosedTrades();
      regimeSignalList = Array.from(regimeSignals.entries());
      console.log(`[${name}] Replay finished in ${elapsed}s: ${rawTrades.length} trades executed.`);

      fs.writeFileSync(cacheFile, JSON.stringify({
        model: name,
        trades: rawTrades,
        regimeSignals: regimeSignalList,
      }, null, 2));
      console.log(`[${name}] Cached to ${cacheFile}`);
    }

    const regimeSignals = new Map<number, string>(regimeSignalList);
    const annotated: AnnotatedSimTrade[] = rawTrades.map(t => {
      const openedAtTs = new Date(t.openedAt).getTime();
      let partition: 'TRAIN' | 'CALIBRATION' | 'OOS' = 'TRAIN';
      if (openedAtTs > calibEndTs) {
        partition = 'OOS';
      } else if (openedAtTs > trainEndTs) {
        partition = 'CALIBRATION';
      }

      let session = classifyTimestampSession(t.openedAt);
      if (session === 'LONDON / NEW YORK OVERLAP') session = 'LONDON/NEW YORK OVERLAP';

      // Find nearest regime signal
      let regime = 'TRENDING_BULLISH';
      let minDiff = Infinity;
      for (const [sTs, sReg] of regimeSignals.entries()) {
        const diff = Math.abs(sTs - openedAtTs);
        if (diff < minDiff && diff <= 45 * 60 * 1000) {
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
      };
    });

    return { trades: annotated, regimeSignals };
  }

  // RUN OR LOAD ALL 4 DYNAMIC REPLAYS
  console.log('Loading/Running 4 dynamic in-engine replays...');
  const baseResult = await runReplay('BASELINE', () => new BreakoutStrategy());
  const filterAResult = await runReplay('FILTER_A', () => new FilterAStrategy());
  const filterBResult = await runReplay('FILTER_B', () => new FilterBStrategy());
  const filterABResult = await runReplay('FILTER_AB', () => new FilterABStrategy());

  const baseTrades = baseResult.trades;
  const fATrades = filterAResult.trades;
  const fBTrades = filterBResult.trades;
  const fABTrades = filterABResult.trades;

  // -------------------------------------------------------------------------
  // OVERALL PERFORMANCE TABLE
  // -------------------------------------------------------------------------
  const statsBaseAll = computeStats(baseTrades);
  const statsAAll = computeStats(fATrades);
  const statsBAll = computeStats(fBTrades);
  const statsABAll = computeStats(fABTrades);

  console.log('\n================================================================');
  console.log('1. OVERALL 12,000-CANDLE PERFORMANCE COMPARISON');
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
      'P&L StdDev ($)',
      'Expectancy StdErr ($)',
      'Max Drawdown ($)',
      'Max Drawdown (%)',
      'Max Consec Losses',
      'Ending Balance ($)'
    ],
    'BASELINE': [
      statsBaseAll.trades,
      `${statsBaseAll.wins} / ${statsBaseAll.losses}`,
      `${statsBaseAll.winRate}%`,
      `[${statsBaseAll.wilsonCI[0]}%, ${statsBaseAll.wilsonCI[1]}%]`,
      `$${statsBaseAll.grossProfit.toLocaleString()}`,
      `$${statsBaseAll.grossLoss.toLocaleString()}`,
      `+$${statsBaseAll.netPnL.toLocaleString()}`,
      statsBaseAll.profitFactor,
      `+$${statsBaseAll.expectancy}`,
      `$${statsBaseAll.pnlStdDev}`,
      `$${statsBaseAll.pnlStdError}`,
      `$${statsBaseAll.maxDrawdownAmount.toLocaleString()}`,
      `${statsBaseAll.maxDrawdownPercent}%`,
      statsBaseAll.maxConsecutiveLosses,
      `$${statsBaseAll.endingBalance.toLocaleString()}`
    ],
    'FILTER A (Bearish Gate)': [
      statsAAll.trades,
      `${statsAAll.wins} / ${statsAAll.losses}`,
      `${statsAAll.winRate}%`,
      `[${statsAAll.wilsonCI[0]}%, ${statsAAll.wilsonCI[1]}%]`,
      `$${statsAAll.grossProfit.toLocaleString()}`,
      `$${statsAAll.grossLoss.toLocaleString()}`,
      `+$${statsAAll.netPnL.toLocaleString()}`,
      statsAAll.profitFactor,
      `+$${statsAAll.expectancy}`,
      `$${statsAAll.pnlStdDev}`,
      `$${statsAAll.pnlStdError}`,
      `$${statsAAll.maxDrawdownAmount.toLocaleString()}`,
      `${statsAAll.maxDrawdownPercent}%`,
      statsAAll.maxConsecutiveLosses,
      `$${statsAAll.endingBalance.toLocaleString()}`
    ],
    'FILTER B (Asian Excl)': [
      statsBAll.trades,
      `${statsBAll.wins} / ${statsBAll.losses}`,
      `${statsBAll.winRate}%`,
      `[${statsBAll.wilsonCI[0]}%, ${statsBAll.wilsonCI[1]}%]`,
      `$${statsBAll.grossProfit.toLocaleString()}`,
      `$${statsBAll.grossLoss.toLocaleString()}`,
      `+$${statsBAll.netPnL.toLocaleString()}`,
      statsBAll.profitFactor,
      `+$${statsBAll.expectancy}`,
      `$${statsBAll.pnlStdDev}`,
      `$${statsBAll.pnlStdError}`,
      `$${statsBAll.maxDrawdownAmount.toLocaleString()}`,
      `${statsBAll.maxDrawdownPercent}%`,
      statsBAll.maxConsecutiveLosses,
      `$${statsBAll.endingBalance.toLocaleString()}`
    ],
    'FILTER AB (Combined)': [
      statsABAll.trades,
      `${statsABAll.wins} / ${statsABAll.losses}`,
      `${statsABAll.winRate}%`,
      `[${statsABAll.wilsonCI[0]}%, ${statsABAll.wilsonCI[1]}%]`,
      `$${statsABAll.grossProfit.toLocaleString()}`,
      `$${statsABAll.grossLoss.toLocaleString()}`,
      `+$${statsABAll.netPnL.toLocaleString()}`,
      statsABAll.profitFactor,
      `+$${statsABAll.expectancy}`,
      `$${statsABAll.pnlStdDev}`,
      `$${statsABAll.pnlStdError}`,
      `$${statsABAll.maxDrawdownAmount.toLocaleString()}`,
      `${statsABAll.maxDrawdownPercent}%`,
      statsABAll.maxConsecutiveLosses,
      `$${statsABAll.endingBalance.toLocaleString()}`
    ]
  });

  // -------------------------------------------------------------------------
  // THREE CHRONOLOGICAL PARTITIONS
  // -------------------------------------------------------------------------
  function partitionTrades(trades: AnnotatedSimTrade[]) {
    return {
      train: trades.filter(t => t.partition === 'TRAIN'),
      calib: trades.filter(t => t.partition === 'CALIBRATION'),
      oos: trades.filter(t => t.partition === 'OOS'),
    };
  }

  const pBase = partitionTrades(baseTrades);
  const pA = partitionTrades(fATrades);
  const pB = partitionTrades(fBTrades);
  const pAB = partitionTrades(fABTrades);

  const stBaseTrain = computeStats(pBase.train);
  const stBaseCalib = computeStats(pBase.calib);
  const stBaseOos = computeStats(pBase.oos);

  const stATrain = computeStats(pA.train);
  const stACalib = computeStats(pA.calib);
  const stAOos = computeStats(pA.oos);

  const stBTrain = computeStats(pB.train);
  const stBCalib = computeStats(pB.calib);
  const stBOos = computeStats(pB.oos);

  const stABTrain = computeStats(pAB.train);
  const stABCalib = computeStats(pAB.calib);
  const stABOos = computeStats(pAB.oos);

  console.log('\n================================================================');
  console.log('2. PARTITION 1: TRAIN (First 50% - Candles 1..6000)');
  console.log('================================================================');
  console.table({
    'Model': ['BASELINE', 'FILTER A', 'FILTER B', 'COMBINED AB'],
    'Trades': [stBaseTrain.trades, stATrain.trades, stBTrain.trades, stABTrain.trades],
    'Win Rate (%)': [`${stBaseTrain.winRate}%`, `${stATrain.winRate}%`, `${stBTrain.winRate}%`, `${stABTrain.winRate}%`],
    'Gross Profit ($)': [`$${stBaseTrain.grossProfit}`, `$${stATrain.grossProfit}`, `$${stBTrain.grossProfit}`, `$${stABTrain.grossProfit}`],
    'Gross Loss ($)': [`$${stBaseTrain.grossLoss}`, `$${stATrain.grossLoss}`, `$${stBTrain.grossLoss}`, `$${stABTrain.grossLoss}`],
    'Net P&L ($)': [`+$${stBaseTrain.netPnL}`, `+$${stATrain.netPnL}`, `+$${stBTrain.netPnL}`, `+$${stABTrain.netPnL}`],
    'Profit Factor': [stBaseTrain.profitFactor, stATrain.profitFactor, stBTrain.profitFactor, stABTrain.profitFactor],
    'Expectancy ($)': [`+$${stBaseTrain.expectancy}`, `+$${stATrain.expectancy}`, `+$${stBTrain.expectancy}`, `+$${stABTrain.expectancy}`],
    'Max Drawdown (%)': [`${stBaseTrain.maxDrawdownPercent}%`, `${stATrain.maxDrawdownPercent}%`, `${stBTrain.maxDrawdownPercent}%`, `${stABTrain.maxDrawdownPercent}%`],
  });

  console.log('\n================================================================');
  console.log('3. PARTITION 2: CALIBRATION (Next 20% - Candles 6001..8400)');
  console.log('================================================================');
  console.table({
    'Model': ['BASELINE', 'FILTER A', 'FILTER B', 'COMBINED AB'],
    'Trades': [stBaseCalib.trades, stACalib.trades, stBCalib.trades, stABCalib.trades],
    'Win Rate (%)': [`${stBaseCalib.winRate}%`, `${stACalib.winRate}%`, `${stBCalib.winRate}%`, `${stABCalib.winRate}%`],
    'Gross Profit ($)': [`$${stBaseCalib.grossProfit}`, `$${stACalib.grossProfit}`, `$${stBCalib.grossProfit}`, `$${stABCalib.grossProfit}`],
    'Gross Loss ($)': [`$${stBaseCalib.grossLoss}`, `$${stACalib.grossLoss}`, `$${stBCalib.grossLoss}`, `$${stABCalib.grossLoss}`],
    'Net P&L ($)': [`+$${stBaseCalib.netPnL}`, `+$${stACalib.netPnL}`, `+$${stBCalib.netPnL}`, `+$${stABCalib.netPnL}`],
    'Profit Factor': [stBaseCalib.profitFactor, stACalib.profitFactor, stBCalib.profitFactor, stABCalib.profitFactor],
    'Expectancy ($)': [`+$${stBaseCalib.expectancy}`, `+$${stACalib.expectancy}`, `+$${stBCalib.expectancy}`, `+$${stABCalib.expectancy}`],
    'Max Drawdown (%)': [`${stBaseCalib.maxDrawdownPercent}%`, `${stACalib.maxDrawdownPercent}%`, `${stBCalib.maxDrawdownPercent}%`, `${stABCalib.maxDrawdownPercent}%`],
  });

  console.log('\n================================================================');
  console.log('4. PARTITION 3: OUT-OF-SAMPLE (OOS Final 30% - Candles 8401..12000)');
  console.log('================================================================');
  console.table({
    'Model': ['BASELINE', 'FILTER A', 'FILTER B', 'COMBINED AB'],
    'Trades': [stBaseOos.trades, stAOos.trades, stBOos.trades, stABOos.trades],
    'Wins / Losses': [
      `${stBaseOos.wins} / ${stBaseOos.losses}`,
      `${stAOos.wins} / ${stAOos.losses}`,
      `${stBOos.wins} / ${stBOos.losses}`,
      `${stABOos.wins} / ${stABOos.losses}`
    ],
    'Win Rate (%)': [`${stBaseOos.winRate}%`, `${stAOos.winRate}%`, `${stBOos.winRate}%`, `${stABOos.winRate}%`],
    '95% Wilson CI': [
      `[${stBaseOos.wilsonCI[0]}%, ${stBaseOos.wilsonCI[1]}%]`,
      `[${stAOos.wilsonCI[0]}%, ${stAOos.wilsonCI[1]}%]`,
      `[${stBOos.wilsonCI[0]}%, ${stBOos.wilsonCI[1]}%]`,
      `[${stABOos.wilsonCI[0]}%, ${stABOos.wilsonCI[1]}%]`
    ],
    'Gross Profit ($)': [`$${stBaseOos.grossProfit}`, `$${stAOos.grossProfit}`, `$${stBOos.grossProfit}`, `$${stABOos.grossProfit}`],
    'Gross Loss ($)': [`$${stBaseOos.grossLoss}`, `$${stAOos.grossLoss}`, `$${stBOos.grossLoss}`, `$${stABOos.grossLoss}`],
    'Net P&L ($)': [`-$${Math.abs(stBaseOos.netPnL)}`, `-$${Math.abs(stAOos.netPnL)}`, `-$${Math.abs(stBOos.netPnL)}`, `-$${Math.abs(stABOos.netPnL)}`],
    'Profit Factor': [stBaseOos.profitFactor, stAOos.profitFactor, stBOos.profitFactor, stABOos.profitFactor],
    'Expectancy ($)': [`-$${Math.abs(stBaseOos.expectancy)}`, `-$${Math.abs(stAOos.expectancy)}`, `-$${Math.abs(stBOos.expectancy)}`, `-$${Math.abs(stABOos.expectancy)}`],
    'P&L StdErr ($)': [`$${stBaseOos.pnlStdError}`, `$${stAOos.pnlStdError}`, `$${stBOos.pnlStdError}`, `$${stABOos.pnlStdError}`],
    'Max Drawdown ($)': [`$${stBaseOos.maxDrawdownAmount}`, `$${stAOos.maxDrawdownAmount}`, `$${stBOos.maxDrawdownAmount}`, `$${stABOos.maxDrawdownAmount}`],
    'Max Drawdown (%)': [`${stBaseOos.maxDrawdownPercent}%`, `${stAOos.maxDrawdownPercent}%`, `${stBOos.maxDrawdownPercent}%`, `${stABOos.maxDrawdownPercent}%`],
    'Ending Balance ($)': [`$${stBaseOos.endingBalance}`, `$${stAOos.endingBalance}`, `$${stBOos.endingBalance}`, `$${stABOos.endingBalance}`]
  });

  // -------------------------------------------------------------------------
  // 5. OOS DELTA ANALYSIS & REPLACEMENT TRADES
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('5. OOS DELTAS VS BASELINE & REPLACEMENT TRADE ANALYSIS');
  console.log('================================================================');

  function getOOSDeltas(name: string, stMod: PerformanceStats) {
    return {
      model: name,
      pnlDelta: Number((stMod.netPnL - stBaseOos.netPnL).toFixed(2)),
      pfDelta: Number((stMod.profitFactor - stBaseOos.profitFactor).toFixed(2)),
      expDelta: Number((stMod.expectancy - stBaseOos.expectancy).toFixed(2)),
      wrDelta: Number((stMod.winRate - stBaseOos.winRate).toFixed(2)),
      maxDdDelta: Number((stMod.maxDrawdownAmount - stBaseOos.maxDrawdownAmount).toFixed(2)),
      tradeCountDelta: stMod.trades - stBaseOos.trades,
    };
  }

  const dA = getOOSDeltas('FILTER A', stAOos);
  const dB = getOOSDeltas('FILTER B', stBOos);
  const dAB = getOOSDeltas('FILTER AB', stABOos);

  console.table([dA, dB, dAB]);

  // Determine trade replacement in OOS:
  // Identify baseline OOS trades that were rejected by A, B, AB
  const baseOosTrades = pBase.oos;
  const aRejectedInBaseOos = baseOosTrades.filter(t => t.direction === 'SHORT' && t.regime === 'TRENDING_BEARISH');
  const bRejectedInBaseOos = baseOosTrades.filter(t => {
    const h = new Date(t.openedAtTs).getUTCHours();
    return h >= 0 && h < 7;
  });
  const abRejectedInBaseOos = baseOosTrades.filter(t => {
    const h = new Date(t.openedAtTs).getUTCHours();
    const isShortBear = t.direction === 'SHORT' && t.regime === 'TRENDING_BEARISH';
    const isAsian = h >= 0 && h < 7;
    return isShortBear || isAsian;
  });

  console.log('\nOOS Baseline Trade Removal vs Replaced Execution:');
  console.log(`  Baseline OOS Trades: ${baseOosTrades.length}`);
  console.log(`  Filter A: Removed ${aRejectedInBaseOos.length} baseline trades. Actual dynamic trades: ${stAOos.trades} (Replacements: ${stAOos.trades - (baseOosTrades.length - aRejectedInBaseOos.length)})`);
  console.log(`  Filter B: Removed ${bRejectedInBaseOos.length} baseline trades. Actual dynamic trades: ${stBOos.trades} (Replacements: ${stBOos.trades - (baseOosTrades.length - bRejectedInBaseOos.length)})`);
  console.log(`  Filter AB: Removed ${abRejectedInBaseOos.length} baseline trades. Actual dynamic trades: ${stABOos.trades} (Replacements: ${stABOos.trades - (baseOosTrades.length - abRejectedInBaseOos.length)})`);

  // -------------------------------------------------------------------------
  // 6. FILTER INTERACTION TEST (A + B vs AB)
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('6. FILTER INTERACTION TEST (A + B vs AB)');
  console.log('================================================================');
  const sumDeltaPnLOverall = (statsAAll.netPnL - statsBaseAll.netPnL) + (statsBAll.netPnL - statsBaseAll.netPnL);
  const actualDeltaPnLABOverall = statsABAll.netPnL - statsBaseAll.netPnL;

  const sumDeltaPnLOos = (stAOos.netPnL - stBaseOos.netPnL) + (stBOos.netPnL - stBaseOos.netPnL);
  const actualDeltaPnLABOos = stABOos.netPnL - stBaseOos.netPnL;

  console.log(`Overall 12,000-candle Delta Sum:`);
  console.log(`  Delta A: +$${(statsAAll.netPnL - statsBaseAll.netPnL).toFixed(2)}`);
  console.log(`  Delta B: +$${(statsBAll.netPnL - statsBaseAll.netPnL).toFixed(2)}`);
  console.log(`  Theoretical Sum (A + B): +$${sumDeltaPnLOverall.toFixed(2)}`);
  console.log(`  Actual Combined AB Delta: +$${actualDeltaPnLABOverall.toFixed(2)}`);
  console.log(`  Interaction Discrepancy:  $${(actualDeltaPnLABOverall - sumDeltaPnLOverall).toFixed(2)}`);

  console.log(`\nOOS (30% Partition) Delta Sum:`);
  console.log(`  Delta A in OOS: +$${(stAOos.netPnL - stBaseOos.netPnL).toFixed(2)}`);
  console.log(`  Delta B in OOS: +$${(stBOos.netPnL - stBaseOos.netPnL).toFixed(2)}`);
  console.log(`  Theoretical Sum (A + B): +$${sumDeltaPnLOos.toFixed(2)}`);
  console.log(`  Actual Combined AB Delta: +$${actualDeltaPnLABOos.toFixed(2)}`);
  console.log(`  Interaction Discrepancy:  $${(actualDeltaPnLABOos - sumDeltaPnLOos).toFixed(2)}`);

  // -------------------------------------------------------------------------
  // 7. TRADE REMOVAL & OVERLAP ANALYSIS
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('7. TRADE REMOVAL & OVERLAP ANALYSIS ON BASELINE LEDGER');
  console.log('================================================================');

  let rejAOnly = 0;
  let rejBOnly = 0;
  let rejBoth = 0;
  let rejNone = 0;

  const tradeClassification = baseTrades.map(t => {
    const h = new Date(t.openedAtTs).getUTCHours();
    const isA = (t.direction === 'SHORT' && t.regime === 'TRENDING_BEARISH');
    const isB = (h >= 0 && h < 7);

    if (isA && isB) rejBoth++;
    else if (isA && !isB) rejAOnly++;
    else if (!isA && isB) rejBOnly++;
    else rejNone++;

    return { trade: t, isA, isB };
  });

  const aRejectedTrades = tradeClassification.filter(x => x.isA).map(x => x.trade);
  const bRejectedTrades = tradeClassification.filter(x => x.isB).map(x => x.trade);
  const abRejectedTrades = tradeClassification.filter(x => x.isA || x.isB).map(x => x.trade);

  const stRejA = computeStats(aRejectedTrades);
  const stRejB = computeStats(bRejectedTrades);
  const stRejAB = computeStats(abRejectedTrades);

  console.table({
    'Category': ['Filter A Rejections', 'Filter B Rejections', 'Filter AB Rejections'],
    'Total Rejected': [stRejA.trades, stRejB.trades, stRejAB.trades],
    'Wins / Losses Rejected': [
      `${stRejA.wins} / ${stRejA.losses}`,
      `${stRejB.wins} / ${stRejB.losses}`,
      `${stRejAB.wins} / ${stRejAB.losses}`
    ],
    'Win Rate Rejected (%)': [`${stRejA.winRate}%`, `${stRejB.winRate}%`, `${stRejAB.winRate}%`],
    'Gross Profit Avoided ($)': [`$${stRejA.grossProfit}`, `$${stRejB.grossProfit}`, `$${stRejAB.grossProfit}`],
    'Gross Loss Avoided ($)': [`$${stRejA.grossLoss}`, `$${stRejB.grossLoss}`, `$${stRejAB.grossLoss}`],
    'Net P&L Avoided ($)': [`-$${Math.abs(stRejA.netPnL)}`, `-$${Math.abs(stRejB.netPnL)}`, `-$${Math.abs(stRejAB.netPnL)}`],
    'Expectancy Avoided ($)': [`-$${Math.abs(stRejA.expectancy)}`, `-$${Math.abs(stRejB.expectancy)}`, `-$${Math.abs(stRejAB.expectancy)}`],
  });

  console.log('\nFilter AB Overlap Breakdown:');
  console.log(`  Rejected by Filter A ONLY: ${rejAOnly} trades`);
  console.log(`  Rejected by Filter B ONLY: ${rejBOnly} trades`);
  console.log(`  Rejected by BOTH A and B:  ${rejBoth} trades`);
  console.log(`  Rejected by NEITHER (Kept):${rejNone} trades`);
  console.log(`  Total Baseline Trades:     ${baseTrades.length}`);

  // -------------------------------------------------------------------------
  // 8. OOS REGIME & SESSION BREAKDOWN (BASELINE VS COMBINED AB)
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('8. OOS REGIME & SESSION BREAKDOWN (BASELINE VS COMBINED AB)');
  console.log('================================================================');

  function analyzeByDimension(trades: AnnotatedSimTrade[], key: 'regime' | 'session') {
    const map = new Map<string, AnnotatedSimTrade[]>();
    for (const t of trades) {
      const val = t[key];
      if (!map.has(val)) map.set(val, []);
      map.get(val)!.push(t);
    }
    const result: Record<string, PerformanceStats> = {};
    for (const [k, list] of map.entries()) {
      result[k] = computeStats(list);
    }
    return result;
  }

  const baseOosRegimes = analyzeByDimension(pBase.oos, 'regime');
  const abOosRegimes = analyzeByDimension(pAB.oos, 'regime');

  const baseOosSessions = analyzeByDimension(pBase.oos, 'session');
  const abOosSessions = analyzeByDimension(pAB.oos, 'session');

  console.log('OOS Regime Distribution:');
  const allRegimes = Array.from(new Set([...Object.keys(baseOosRegimes), ...Object.keys(abOosRegimes)]));
  console.table(allRegimes.map(reg => ({
    regime: reg,
    baseTrades: baseOosRegimes[reg]?.trades || 0,
    baseWR: `${baseOosRegimes[reg]?.winRate || 0}%`,
    basePnL: baseOosRegimes[reg]?.netPnL || 0,
    basePF: baseOosRegimes[reg]?.profitFactor || 0,
    abTrades: abOosRegimes[reg]?.trades || 0,
    abWR: `${abOosRegimes[reg]?.winRate || 0}%`,
    abPnL: abOosRegimes[reg]?.netPnL || 0,
    abPF: abOosRegimes[reg]?.profitFactor || 0,
  })));

  console.log('\nOOS Session Distribution:');
  const allSessions = Array.from(new Set([...Object.keys(baseOosSessions), ...Object.keys(abOosSessions)]));
  console.table(allSessions.map(sess => ({
    session: sess,
    baseTrades: baseOosSessions[sess]?.trades || 0,
    baseWR: `${baseOosSessions[sess]?.winRate || 0}%`,
    basePnL: baseOosSessions[sess]?.netPnL || 0,
    basePF: baseOosSessions[sess]?.profitFactor || 0,
    abTrades: abOosSessions[sess]?.trades || 0,
    abWR: `${abOosSessions[sess]?.winRate || 0}%`,
    abPnL: abOosSessions[sess]?.netPnL || 0,
    abPF: abOosSessions[sess]?.profitFactor || 0,
  })));

  // -------------------------------------------------------------------------
  // 9. COST ROBUSTNESS (CORRECTED FRICTION)
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('9. COST ROBUSTNESS ACROSS FRICTION MULTIPLIERS');
  console.log('================================================================');
  console.log('Contract spec: 100 oz = 1 standard lot.');
  console.log('Baseline friction: $7 comm + $10 spread + $10 slip = $27.00/trade.');
  console.log('Extra per trade per 0.5x: $13.50.');

  const multipliers = [1.0, 1.5, 2.0, 3.0];
  function getFrictionTable(st: PerformanceStats) {
    const res: Record<string, { pnl: number; pf: number }> = {};
    for (const m of multipliers) {
      const extraPerTrade = (m - 1.0) * 27.00;
      const extraTotal = st.trades * extraPerTrade;
      const pnl = Number((st.netPnL - extraTotal).toFixed(2));
      const stressedLoss = Number((st.grossLoss + extraTotal).toFixed(2));
      const pf = stressedLoss > 0 ? Number((st.grossProfit / stressedLoss).toFixed(2)) : 0;
      res[`${m}x`] = { pnl, pf };
    }
    const beMult = Number((1 + st.netPnL / (st.trades * 27.00)).toFixed(2));
    return { scenarios: res, breakEven: beMult };
  }

  const fBase = getFrictionTable(statsBaseAll);
  const fA = getFrictionTable(statsAAll);
  const fB = getFrictionTable(statsBAll);
  const fAB = getFrictionTable(statsABAll);

  console.table({
    'Scenario': ['1.0x (Standard)', '1.5x (Stress)', '2.0x (Adverse)', '3.0x (Extreme)', 'Break-even Multiple'],
    'BASELINE': [
      `+$${fBase.scenarios['1x'].pnl} (PF ${fBase.scenarios['1x'].pf})`,
      `+$${fBase.scenarios['1.5x'].pnl} (PF ${fBase.scenarios['1.5x'].pf})`,
      `-$${Math.abs(fBase.scenarios['2x'].pnl)} (PF ${fBase.scenarios['2x'].pf})`,
      `-$${Math.abs(fBase.scenarios['3x'].pnl)} (PF ${fBase.scenarios['3x'].pf})`,
      `${fBase.breakEven}x`
    ],
    'FILTER A': [
      `+$${fA.scenarios['1x'].pnl} (PF ${fA.scenarios['1x'].pf})`,
      `+$${fA.scenarios['1.5x'].pnl} (PF ${fA.scenarios['1.5x'].pf})`,
      `+$${fA.scenarios['2x'].pnl} (PF ${fA.scenarios['2x'].pf})`,
      `+$${fA.scenarios['3x'].pnl} (PF ${fA.scenarios['3x'].pf})`,
      `${fA.breakEven}x`
    ],
    'FILTER B': [
      `+$${fB.scenarios['1x'].pnl} (PF ${fB.scenarios['1x'].pf})`,
      `+$${fB.scenarios['1.5x'].pnl} (PF ${fB.scenarios['1.5x'].pf})`,
      `+$${fB.scenarios['2x'].pnl} (PF ${fB.scenarios['2x'].pf})`,
      `+$${fB.scenarios['3x'].pnl} (PF ${fB.scenarios['3x'].pf})`,
      `${fB.breakEven}x`
    ],
    'FILTER AB': [
      `+$${fAB.scenarios['1x'].pnl} (PF ${fAB.scenarios['1x'].pf})`,
      `+$${fAB.scenarios['1.5x'].pnl} (PF ${fAB.scenarios['1.5x'].pf})`,
      `+$${fAB.scenarios['2x'].pnl} (PF ${fAB.scenarios['2x'].pf})`,
      `+$${fAB.scenarios['3x'].pnl} (PF ${fAB.scenarios['3x'].pf})`,
      `${fAB.breakEven}x`
    ]
  });

  // SAVE JSON RESULTS
  const output = {
    metadata: {
      phase: '7G-D',
      datasetBars: totalCandles,
      partitions: {
        train: { bars: 6000, start: firstCandle.datetime, end: candles[trainEndIdx].datetime },
        calib: { bars: 2400, start: candles[6000].datetime, end: candles[calibEndIdx].datetime },
        oos: { bars: 3600, start: candles[8400].datetime, end: lastCandle.datetime },
      }
    },
    overall: {
      baseline: statsBaseAll,
      filterA: statsAAll,
      filterB: statsBAll,
      filterAB: statsABAll,
    },
    train: {
      baseline: stBaseTrain,
      filterA: stATrain,
      filterB: stBTrain,
      filterAB: stABTrain,
    },
    calibration: {
      baseline: stBaseCalib,
      filterA: stACalib,
      filterB: stBCalib,
      filterAB: stABCalib,
    },
    oos: {
      baseline: stBaseOos,
      filterA: stAOos,
      filterB: stBOos,
      filterAB: stABOos,
      deltas: { filterA: dA, filterB: dB, filterAB: dAB },
      interaction: {
        sumOosDeltaAB: sumDeltaPnLOos,
        actualOosDeltaAB: actualDeltaPnLABOos,
        discrepancy: actualDeltaPnLABOos - sumDeltaPnLOos,
      }
    },
    tradeRemovalOnBaseline: {
      filterA: stRejA,
      filterB: stRejB,
      filterAB: stRejAB,
      overlap: { aOnly: rejAOnly, bOnly: rejBOnly, both: rejBoth, kept: rejNone },
    },
    oosRegimes: { baseline: baseOosRegimes, filterAB: abOosRegimes },
    oosSessions: { baseline: baseOosSessions, filterAB: abOosSessions },
    friction: {
      baseline: fBase,
      filterA: fA,
      filterB: fB,
      filterAB: fAB,
    }
  };

  fs.writeFileSync('tests/phase_7gd_validation_results.json', JSON.stringify(output, null, 2));
  console.log('\nReport successfully saved to tests/phase_7gd_validation_results.json.');
}

main().catch(err => {
  console.error('Phase 7G-D validation error:', err);
  process.exit(1);
});
