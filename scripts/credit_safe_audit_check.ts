import * as fs from 'fs';
import * as path from 'path';

// 1. DATASET CHECK
const dataPath = path.join(process.cwd(), 'data/xauusd_15m_historical_10k.json');
const fileExists = fs.existsSync(dataPath);
const stats = fileExists ? fs.statSync(dataPath) : null;
const rawData = fileExists ? JSON.parse(fs.readFileSync(dataPath, 'utf-8')) : [];

let validOhlcCount = 0;
let ohlcAnomalies = 0;
let duplicateTimestamps = 0;
const seenTimestamps = new Set<string>();

for (const c of rawData) {
  if (seenTimestamps.has(c.datetime)) duplicateTimestamps++;
  seenTimestamps.add(c.datetime);

  const o = parseFloat(c.open);
  const h = parseFloat(c.high);
  const l = parseFloat(c.low);
  const cl = parseFloat(c.close);

  if (h >= Math.max(o, cl) && l <= Math.min(o, cl) && h >= l) {
    validOhlcCount++;
  } else {
    ohlcAnomalies++;
  }
}

const firstCandle = rawData[0];
const lastCandle = rawData[rawData.length - 1];

// 2. RECONCILE REPORTED TRADES IN tests/phase_7f_audit_report.json
const reportPath = path.join(process.cwd(), 'tests/phase_7f_audit_report.json');
const reportExists = fs.existsSync(reportPath);
const report = reportExists ? JSON.parse(fs.readFileSync(reportPath, 'utf-8')) : null;

let ledgerSumPnL = 0;
let ledgerWins = 0;
let ledgerLosses = 0;

if (report && report.trades) {
  for (const t of report.trades) {
    ledgerSumPnL += t.pnl;
    if (t.pnl > 0) ledgerWins++;
    else ledgerLosses++;
  }
}

// 3. STATISTICAL CONFIDENCE INTERVAL VERIFICATION
const N = 18;
const wins = 5;
const p = wins / N;
const se = Math.sqrt((p * (1 - p)) / N);
const waldLower = Math.max(0, p - 1.96 * se);
const waldUpper = Math.min(1, p + 1.96 * se);

// Wilson score interval
const z = 1.96;
const z2 = z * z;
const denom = 1 + z2 / N;
const center = (p + z2 / (2 * N)) / denom;
const halfWidth = (z * Math.sqrt((p * (1 - p)) / N + z2 / (4 * N * N))) / denom;
const wilsonLower = Math.max(0, center - halfWidth);
const wilsonUpper = Math.min(1, center + halfWidth);

console.log(JSON.stringify({
  dataset: {
    present: fileExists,
    bytes: stats?.size,
    candleCount: rawData.length,
    firstDatetime: firstCandle?.datetime,
    lastDatetime: lastCandle?.datetime,
    validOhlcCount,
    ohlcAnomalies,
    duplicateTimestamps,
  },
  tradeLedgerReconciliation: {
    reportExists,
    reportedTradeCount: report?.overallStats?.totalTrades,
    ledgerTradeCount: report?.trades?.length,
    reportedNetPnL: report?.overallStats?.netPnL,
    ledgerSumPnL: Number(ledgerSumPnL.toFixed(2)),
    reportedWins: report?.overallStats?.winningTrades,
    ledgerWins,
    reportedLosses: report?.overallStats?.losingTrades,
    ledgerLosses,
    reportedWinRate: report?.overallStats?.winRate,
    ledgerWinRate: Number(((ledgerWins / report?.trades?.length) * 100).toFixed(2)),
  },
  confidenceInterval: {
    reportedCI: report?.overallStats?.ci95,
    calculatedWaldCI: `[${(waldLower * 100).toFixed(2)}%, ${(waldUpper * 100).toFixed(2)}%]`,
    calculatedWilsonCI: `[${(wilsonLower * 100).toFixed(2)}%, ${(wilsonUpper * 100).toFixed(2)}%]`,
    metricMeasured: 'Win Rate (Proportion of Winning Trades)',
    isMathematicallyCorrect: report?.overallStats?.ci95 === `[${(waldLower * 100).toFixed(2)}%, ${(waldUpper * 100).toFixed(2)}%]`,
    sampleSmallnessWarning: 'Normal approximation (Wald) is imprecise for N=18 (np=5 < 10). Wilson score interval is recommended.'
  }
}, null, 2));
