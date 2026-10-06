import * as fs from 'fs';
import * as path from 'path';
import { normalizeAndSortCandles } from '../src/utils/candle-integrity';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { BreakoutStrategy } from '../src/strategy/breakout-strategy';
import { classifyTimestampSession } from '../src/strategy/session-classifier';
import { PaperTradeJournalEntry } from '../types/paper-trading';

async function main() {
  console.log('=== PHASE 7G-B: CANDIDATE FILTER EVALUATION ===\n');

  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { candles } = normalizeAndSortCandles(rawData);
  const totalCandles = candles.length;

  // Chronological partitions:
  // Train: 0..6000 (50%)
  // Calibration: 6000..8400 (20%)
  // OOS: 8400..12000 (30%)
  const trainEndTs = candles[6000 - 1].timestamp;
  const calibEndTs = candles[8400 - 1].timestamp;

  console.log(`Dataset: ${totalCandles} candles.`);
  console.log(`Train End: ${candles[6000 - 1].datetime} (timestamp: ${trainEndTs})`);
  console.log(`Calibration End: ${candles[8400 - 1].datetime} (timestamp: ${calibEndTs})`);
  console.log(`OOS End: ${candles[totalCandles - 1].datetime}\n`);

  const replay = new HistoricalReplayEngine({
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

  const strategy = new BreakoutStrategy();
  replay.loadDataset(candles);
  replay.setStrategy(strategy);

  const signalRegimes: Map<number, string> = new Map();

  while (replay.getState() !== 'COMPLETED') {
    replay.stepForward();
    const sig = strategy.getLastSignalOutput();
    if (sig) {
      signalRegimes.set(sig.timestamp, sig.regime);
    }
  }

  const allTrades = replay.getClosedTrades();
  console.log(`Total Baseline Trades Executed: ${allTrades.length}`);

  // Annotate trades with regime, session, partition
  interface AnnotatedTrade {
    trade: PaperTradeJournalEntry;
    partition: 'TRAIN' | 'CALIBRATION' | 'OOS';
    session: string;
    regime: string;
    openedAtTs: number;
    pnl: number;
    direction: 'LONG' | 'SHORT';
  }

  const annotatedTrades: AnnotatedTrade[] = allTrades.map(t => {
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

  function computeStats(trades: AnnotatedTrade[], initialBal = 100_000) {
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

    return {
      trades: total,
      wins: wins.length,
      losses: losses.length,
      winRate,
      grossProfit,
      grossLoss,
      netPnL,
      profitFactor,
      avgWin,
      avgLoss,
      expectancy,
      maxDrawdownAmount: Number(maxDD.toFixed(2)),
      maxDrawdownPercent: Number(maxDDPct.toFixed(2)),
      maxConsecutiveLosses,
      endingBalance: Number((initialBal + netPnL).toFixed(2)),
    };
  }

  // 1. BASELINE ACROSS PARTITIONS
  const baseTrain = annotatedTrades.filter(t => t.partition === 'TRAIN');
  const baseCalib = annotatedTrades.filter(t => t.partition === 'CALIBRATION');
  const baseOos = annotatedTrades.filter(t => t.partition === 'OOS');

  console.log('--- BASELINE PERFORMANCE ---');
  console.log('Overall:', computeStats(annotatedTrades));
  console.log('TRAIN:', computeStats(baseTrain));
  console.log('CALIBRATION:', computeStats(baseCalib));
  console.log('OOS:', computeStats(baseOos));

  // 2. CANDIDATE FILTER 1: Exclude TRENDING_BEARISH breakdowns (Bearish Breakdown Filter)
  // Rationale: Gold is macro bullish; breakdowns in trending bearish regimes had a 24.5% win rate and -$17.4k loss.
  const f1Predicate = (t: AnnotatedTrade) => !(t.direction === 'SHORT' && t.regime === 'TRENDING_BEARISH');
  const f1All = annotatedTrades.filter(f1Predicate);
  const f1Train = baseTrain.filter(f1Predicate);
  const f1Calib = baseCalib.filter(f1Predicate);
  const f1Oos = baseOos.filter(f1Predicate);

  console.log('\n--- CANDIDATE FILTER 1: EXCLUDE BEARISH BREAKDOWNS IN TRENDING_BEARISH REGIME ---');
  console.log('Overall:', computeStats(f1All));
  console.log('TRAIN:', computeStats(f1Train));
  console.log('CALIBRATION:', computeStats(f1Calib));
  console.log('OOS:', computeStats(f1Oos));

  // 3. CANDIDATE FILTER 2: Exclude ASIAN Session Trades (Asian Session Filter)
  // Rationale: Asian session has thin gold spot liquidity and produced -$5,190.56 drag (PF 0.80).
  const f2Predicate = (t: AnnotatedTrade) => t.session !== 'ASIAN';
  const f2All = annotatedTrades.filter(f2Predicate);
  const f2Train = baseTrain.filter(f2Predicate);
  const f2Calib = baseCalib.filter(f2Predicate);
  const f2Oos = baseOos.filter(f2Predicate);

  console.log('\n--- CANDIDATE FILTER 2: EXCLUDE ASIAN SESSION TRADES ---');
  console.log('Overall:', computeStats(f2All));
  console.log('TRAIN:', computeStats(f2Train));
  console.log('CALIBRATION:', computeStats(f2Calib));
  console.log('OOS:', computeStats(f2Oos));

  // 4. CANDIDATE FILTER 3: Only Trade Bullish & Expansion Regimes (High-Momentum Regime Filter)
  // Rationale: Only take trades in TRENDING_BULLISH or VOLATILITY_EXPANSION.
  const f3Predicate = (t: AnnotatedTrade) => t.regime === 'TRENDING_BULLISH' || t.regime === 'VOLATILITY_EXPANSION';
  const f3All = annotatedTrades.filter(f3Predicate);
  const f3Train = baseTrain.filter(f3Predicate);
  const f3Calib = baseCalib.filter(f3Predicate);
  const f3Oos = baseOos.filter(f3Predicate);

  console.log('\n--- CANDIDATE FILTER 3: ONLY TRENDING_BULLISH & VOLATILITY_EXPANSION ---');
  console.log('Overall:', computeStats(f3All));
  console.log('TRAIN:', computeStats(f3Train));
  console.log('CALIBRATION:', computeStats(f3Calib));
  console.log('OOS:', computeStats(f3Oos));

  // Save everything to JSON for inspection
  const reportData = {
    baseline: {
      overall: computeStats(annotatedTrades),
      train: computeStats(baseTrain),
      calib: computeStats(baseCalib),
      oos: computeStats(baseOos),
    },
    filter1: {
      name: 'EXCLUDE_BEARISH_REGIME_BREAKDOWNS',
      rule: 'Disallow SHORT trades when regime === TRENDING_BEARISH',
      overall: computeStats(f1All),
      train: computeStats(f1Train),
      calib: computeStats(f1Calib),
      oos: computeStats(f1Oos),
    },
    filter2: {
      name: 'EXCLUDE_ASIAN_SESSION',
      rule: 'Disallow trades opened during ASIAN session (00:00 - 07:00 UTC)',
      overall: computeStats(f2All),
      train: computeStats(f2Train),
      calib: computeStats(f2Calib),
      oos: computeStats(f2Oos),
    },
    filter3: {
      name: 'HIGH_MOMENTUM_REGIME_ONLY',
      rule: 'Only permit trades when regime is TRENDING_BULLISH or VOLATILITY_EXPANSION',
      overall: computeStats(f3All),
      train: computeStats(f3Train),
      calib: computeStats(f3Calib),
      oos: computeStats(f3Oos),
    },
  };

  fs.writeFileSync('tests/phase_7gb_filter_results.json', JSON.stringify(reportData, null, 2));
  console.log('\nSaved tests/phase_7gb_filter_results.json successfully.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
