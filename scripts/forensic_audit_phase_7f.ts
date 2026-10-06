import * as fs from 'fs';
import * as path from 'path';
import { normalizeAndSortCandles } from '../src/utils/candle-integrity';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { BreakoutStrategy } from '../src/strategy/breakout-strategy';
import { classifyTimestampSession } from '../src/strategy/session-classifier';
import { RiskEngine } from '../src/services/paper-trading/risk-manager';
import { Candle } from '../src/market-data/provider.interface';

async function runForensicAudit() {
  console.log('=== STARTING FORENSIC AUDIT OF PHASE 7F ===\n');

  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // 1. DATA AUDIT
  console.log('1. DATA PROVENANCE & INTEGRITY AUDIT');
  const totalRaw = rawData.length;
  const { candles, rejectedCount } = normalizeAndSortCandles(rawData);
  console.log(`Total raw entries: ${totalRaw}`);
  console.log(`Normalized candles: ${candles.length} (Rejected: ${rejectedCount})`);
  console.log(`First Candle: ${candles[0].datetime} (timestamp: ${candles[0].timestamp})`);
  console.log(`Last Candle: ${candles[candles.length - 1].datetime} (timestamp: ${candles[candles.length - 1].timestamp})`);

  // Check duplicates and missing timestamps
  let duplicates = 0;
  let invalidOhlc = 0;
  let ohlcViolations: any[] = [];
  const timestamps = new Set<number>();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (timestamps.has(c.timestamp)) {
      duplicates++;
    }
    timestamps.add(c.timestamp);

    const high = c.high;
    const low = c.low;
    const open = c.open;
    const close = c.close;

    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      invalidOhlc++;
      ohlcViolations.push({ index: i, candle: c });
    }
  }

  console.log(`Duplicates: ${duplicates}`);
  console.log(`Invalid OHLC: ${invalidOhlc}`);

  // Inspect first 20, middle 20, last 20
  console.log('\nSample First 3 candles:', candles.slice(0, 3));
  console.log('Sample Middle 3 candles:', candles.slice(5998, 6001));
  console.log('Sample Last 3 candles:', candles.slice(candles.length - 3));

  // 2. REPLAY 1: AS EXECUTED IN 7F (Continuous replay without daily reset)
  console.log('\n2. TRACING RISK MANAGER HALT ON CONTINUOUS REPLAY');
  const replayContinuous = new HistoricalReplayEngine({
    symbol: 'XAU/USD',
    timeframe: '15m',
    initialBalance: 100_000,
    riskConfig: {
      commissionPerLot: 3.50,
      slippagePips: 0.5,
      spreadMarkupPips: 1.0,
    }
  });

  const strat1 = new BreakoutStrategy();
  replayContinuous.loadDataset(candles);
  replayContinuous.setStrategy(strat1);

  let step = 0;
  let lastTradeCount = 0;
  let haltCandleIndex = -1;
  let haltCandleDatetime = '';

  while (replayContinuous.getState() !== 'COMPLETED') {
    replayContinuous.stepForward();
    step++;
    const currentTrades = replayContinuous.getClosedTrades();
    if (currentTrades.length > lastTradeCount) {
      lastTradeCount = currentTrades.length;
      if (lastTradeCount === 18) {
        haltCandleIndex = step;
        haltCandleDatetime = candles[step - 1].datetime;
      }
    }
  }

  const continuousTrades = replayContinuous.getClosedTrades();
  console.log(`Continuous replay executed trades: ${continuousTrades.length}`);
  console.log(`Halt happened around trade 18 at candle step ${haltCandleIndex} (${haltCandleDatetime})`);
  console.log(`Account Equity at end: $${replayContinuous.getAccount().currentEquity}`);
  console.log(`Account Drawdown %: ${replayContinuous.getMetrics().maxDrawdownPercent}%`);
  console.log(`Total Realized P&L: $${replayContinuous.getMetrics().totalRealizedPnL}`);

  // 3. REPLAY 2: THREE INDEPENDENT 4,000 CANDLE BLOCKS (FRESH BALANCE & RISK STATE)
  console.log('\n3. RUNNING THREE INDEPENDENT 4,000 CANDLE BLOCKS');

  function runIndependentBlock(blockNumber: number, start: number, end: number) {
    const blockCandles = candles.slice(start, end);
    const engine = new HistoricalReplayEngine({
      symbol: 'XAU/USD',
      timeframe: '15m',
      initialBalance: 100_000,
      riskConfig: {
        commissionPerLot: 3.50,
        slippagePips: 0.5,
        spreadMarkupPips: 1.0,
      }
    });

    const strategy = new BreakoutStrategy();
    engine.loadDataset(blockCandles);
    engine.setStrategy(strategy);

    while (engine.getState() !== 'COMPLETED') {
      engine.stepForward();
    }

    const tr = engine.getClosedTrades();
    const w = tr.filter(t => t.realizedPnL > 0);
    const l = tr.filter(t => t.realizedPnL <= 0);
    const pnl = tr.reduce((sum, t) => sum + t.realizedPnL, 0);
    const dd = engine.getMetrics().maxDrawdownPercent;

    console.log(`Block ${blockNumber} [${start}..${end}] (${blockCandles[0].datetime} to ${blockCandles[blockCandles.length - 1].datetime}):`);
    console.log(`  Trades: ${tr.length} (Wins: ${w.length}, Losses: ${l.length})`);
    console.log(`  Win Rate: ${tr.length > 0 ? ((w.length / tr.length) * 100).toFixed(2) : 0}%`);
    console.log(`  P&L: $${pnl.toFixed(2)} | Max DD: ${dd}%`);

    return { trades: tr, wins: w.length, losses: l.length, pnl, dd, metrics: engine.getMetrics() };
  }

  const b1 = runIndependentBlock(1, 0, 4000);
  const b2 = runIndependentBlock(2, 4000, 8000);
  const b3 = runIndependentBlock(3, 8000, 12000);

  const blockTotalTrades = b1.trades.length + b2.trades.length + b3.trades.length;
  const blockTotalWins = b1.wins + b2.wins + b3.wins;
  const blockTotalLosses = b1.losses + b2.losses + b3.losses;
  const blockTotalPnL = b1.pnl + b2.pnl + b3.pnl;
  const blockWinRate = blockTotalTrades > 0 ? (blockTotalWins / blockTotalTrades) * 100 : 0;

  console.log(`\nINDEPENDENT 3-BLOCK AGGREGATE:`);
  console.log(`  Total Trades: ${blockTotalTrades}`);
  console.log(`  Wins: ${blockTotalWins}, Losses: ${blockTotalLosses}`);
  console.log(`  Win Rate: ${blockWinRate.toFixed(2)}%`);
  console.log(`  Total P&L: $${blockTotalPnL.toFixed(2)}`);

  // 4. REPLAY 3: DETERMINISM CHECK
  console.log('\n4. RUNNING DETERMINISM RE-RUN OF BLOCK 1');
  const b1_rerun = runIndependentBlock(1, 0, 4000);
  const isIdenticalTradeCount = b1.trades.length === b1_rerun.trades.length;
  const isIdenticalPnL = Math.abs(b1.pnl - b1_rerun.pnl) < 1e-5;
  let allTradesMatch = true;
  for (let i = 0; i < b1.trades.length; i++) {
    if (b1.trades[i].realizedPnL !== b1_rerun.trades[i].realizedPnL ||
        b1.trades[i].entryPrice !== b1_rerun.trades[i].entryPrice ||
        b1.trades[i].exitPrice !== b1_rerun.trades[i].exitPrice) {
      allTradesMatch = false;
      break;
    }
  }
  console.log(`DETERMINISM TEST: Trade count match: ${isIdenticalTradeCount}, PnL match: ${isIdenticalPnL}, Trade-by-trade match: ${allTradesMatch}`);

  // 5. REPLAY 4: DAILY RESET AUDIT
  // Check whether each block halted due to daily loss limit or ran normally
  console.log('\n5. CHECKING IF BLOCKS HIT DAILY LOSS HALT:');
  console.log(`Block 1 trade 18 closed at: ${b1.trades[b1.trades.length - 1]?.closedAt}`);
  console.log(`Block 2 trade count: ${b2.trades.length}, last trade closed at: ${b2.trades[b2.trades.length - 1]?.closedAt}`);
  console.log(`Block 3 trade count: ${b3.trades.length}, last trade closed at: ${b3.trades[b3.trades.length - 1]?.closedAt}`);

  // 6. SAVE ALL RESULTS TO AUDIT DUMP
  fs.writeFileSync('tests/forensic_audit_results.json', JSON.stringify({
    dataStats: {
      totalRaw,
      candles: candles.length,
      rejectedCount,
      startDate: candles[0].datetime,
      endDate: candles[candles.length - 1].datetime,
      duplicates,
      invalidOhlc
    },
    continuousRun: {
      trades: continuousTrades.length,
      pnl: replayContinuous.getMetrics().totalRealizedPnL,
      drawdown: replayContinuous.getMetrics().maxDrawdownPercent,
      haltCandleIndex,
      haltCandleDatetime
    },
    independentBlocks: {
      b1: { trades: b1.trades.length, wins: b1.wins, losses: b1.losses, pnl: b1.pnl, dd: b1.dd },
      b2: { trades: b2.trades.length, wins: b2.wins, losses: b2.losses, pnl: b2.pnl, dd: b2.dd },
      b3: { trades: b3.trades.length, wins: b3.wins, losses: b3.losses, pnl: b3.pnl, dd: b3.dd },
      aggregate: {
        totalTrades: blockTotalTrades,
        wins: blockTotalWins,
        losses: blockTotalLosses,
        winRate: Number(blockWinRate.toFixed(2)),
        totalPnL: Number(blockTotalPnL.toFixed(2))
      }
    },
    allTradesBlock1: b1.trades,
    allTradesBlock2: b2.trades,
    allTradesBlock3: b3.trades
  }, null, 2));

  console.log('\n=== FORENSIC AUDIT SCRIPT COMPLETE ===');
}

runForensicAudit().catch(err => {
  console.error('Audit Script Error:', err);
  process.exit(1);
});
