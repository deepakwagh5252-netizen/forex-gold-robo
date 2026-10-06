import * as fs from 'fs';
import * as path from 'path';
import { normalizeAndSortCandles } from '../src/utils/candle-integrity';
import { HistoricalReplayEngine } from '../src/services/replay/historical-replay-engine';
import { BreakoutStrategy } from '../src/strategy/breakout-strategy';
import { ReplayContext } from '../types/replay';
import { SetupRecord } from '../types/trading';

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

class FilterBStrategy extends BreakoutStrategy {
  override evaluate(context: ReplayContext): SetupRecord[] {
    const setups = super.evaluate(context);
    const date = new Date(context.timestamp);
    const hour = date.getUTCHours();
    const isAsian = hour >= 0 && hour < 7;
    return setups.filter(() => !isAsian);
  }
}

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

async function main() {
  const modelName = (process.argv[2] || 'BASELINE').toUpperCase();
  console.log(`=== PRECOMPUTING SIMULATION CACHE FOR: ${modelName} ===`);

  const cacheFile = path.join(process.cwd(), `tests/sim_cache_${modelName.toLowerCase()}.json`);
  if (fs.existsSync(cacheFile)) {
    console.log(`Cache file already exists: ${cacheFile}`);
    process.exit(0);
  }

  const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const { candles } = normalizeAndSortCandles(rawData);

  let strategy: BreakoutStrategy;
  if (modelName === 'BASELINE') strategy = new BreakoutStrategy();
  else if (modelName === 'FILTER_A') strategy = new FilterAStrategy();
  else if (modelName === 'FILTER_B') strategy = new FilterBStrategy();
  else if (modelName === 'FILTER_AB') strategy = new FilterABStrategy();
  else {
    console.error(`Unknown model: ${modelName}`);
    process.exit(1);
  }

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
    },
  });

  replay.loadDataset(candles);
  replay.setStrategy(strategy);

  const regimeSignals = new Map<number, string>();
  const t0 = Date.now();

  while (replay.getState() !== 'COMPLETED') {
    replay.stepForward();
    const sig = strategy.getLastSignalOutput();
    if (sig) {
      regimeSignals.set(sig.timestamp, sig.regime);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const rawTrades = replay.getClosedTrades();
  console.log(`[${modelName}] Finished in ${elapsed}s: ${rawTrades.length} trades.`);

  fs.writeFileSync(cacheFile, JSON.stringify({
    model: modelName,
    trades: rawTrades,
    regimeSignals: Array.from(regimeSignals.entries()),
  }, null, 2));

  console.log(`Saved to ${cacheFile} (${fs.statSync(cacheFile).size} bytes).`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
