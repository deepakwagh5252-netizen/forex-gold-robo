import { ForwardTrade } from '../types/forward-validation';

/**
 * Confirmed Step 6E deployment timestamp extracted from project test suite metadata:
 * tests/step6e-idempotency-identity.test.ts (mtime: 2026-10-05 08:16:15.264 UTC).
 * 
 * Only trades whose entryExecutedAtUtc is STRICTLY AFTER this boundary are admitted into
 * the Clean Post-Step-6E Forward Validation dataset.
 */
export const STEP_6E_DEPLOYMENT_CUTOFF_UTC = '2026-10-05T08:16:15.264Z';
export const STEP_6E_DEPLOYMENT_CUTOFF_MS = new Date(STEP_6E_DEPLOYMENT_CUTOFF_UTC).getTime();

export interface CleanForwardMetrics {
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalFees: number;
}

export interface HistoricalArchiveMetrics {
  totalRecords: number;
  duplicateRecords: number;
  genuineRecords: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  totalFees: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface ClassifiedHistoricalTrade {
  trade: ForwardTrade;
  isDuplicate: boolean;
  duplicateReason?: string;
}

export interface ForwardReportingPartition {
  cutoffUtc: string;
  cleanTrades: ForwardTrade[];
  cleanMetrics: CleanForwardMetrics;
  historicalTrades: ForwardTrade[];
  classifiedHistoricalTrades: ClassifiedHistoricalTrade[];
  historicalMetrics: HistoricalArchiveMetrics;
}

/**
 * Pure calculation of the 11 required forward statistics for the clean subset.
 */
export function calculateCleanMetrics(trades: ForwardTrade[]): CleanForwardMetrics {
  const tradeCount = trades.length;
  const wins = trades.filter(t => t.isWin).length;
  const losses = tradeCount - wins;
  const winRate = tradeCount > 0 ? Number(((wins / tradeCount) * 100).toFixed(2)) : 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let netPnL = 0;
  let totalFees = 0;

  for (const t of trades) {
    netPnL += t.netPnL;
    totalFees += t.totalFees || 0;
    if (t.netPnL > 0) {
      grossProfit += t.netPnL;
    } else {
      grossLoss += Math.abs(t.netPnL);
    }
  }

  const profitFactor = grossLoss > 0
    ? Number((grossProfit / grossLoss).toFixed(2))
    : grossProfit > 0 ? 99.99 : 0;

  const expectancy = tradeCount > 0
    ? Number((netPnL / tradeCount).toFixed(2))
    : 0;

  let peak = 100_000;
  let equity = 100_000;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const t of trades) {
    equity += t.netPnL;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPercent = peak > 0 ? Number(((dd / peak) * 100).toFixed(2)) : 0;
    }
  }

  return {
    tradeCount,
    wins,
    losses,
    winRate,
    netPnL: Number(netPnL.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor,
    expectancy,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPercent,
    totalFees: Number(totalFees.toFixed(2)),
  };
}

/**
 * Pure calculation of metrics for the historical/forensic archive.
 */
export function calculateHistoricalMetrics(trades: ForwardTrade[]): HistoricalArchiveMetrics {
  const totalRecords = trades.length;
  const wins = trades.filter(t => t.isWin).length;
  const losses = totalRecords - wins;
  const winRate = totalRecords > 0 ? Number(((wins / totalRecords) * 100).toFixed(2)) : 0;

  let grossProfit = 0;
  let grossLoss = 0;
  let netPnL = 0;
  let totalFees = 0;

  for (const t of trades) {
    netPnL += t.netPnL;
    totalFees += t.totalFees || 0;
    if (t.netPnL > 0) grossProfit += t.netPnL;
    else grossLoss += Math.abs(t.netPnL);
  }

  // Identify duplicate records
  const seenKeys = new Set<string>();
  let duplicateRecords = 0;
  for (const t of trades) {
    const key = `${t.signalCandleTimeUtc || ''}_${t.direction}`;
    if (seenKeys.has(key)) {
      duplicateRecords++;
    } else {
      seenKeys.add(key);
    }
  }
  const genuineRecords = totalRecords - duplicateRecords;

  return {
    totalRecords,
    duplicateRecords,
    genuineRecords,
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    netPnL: Number(netPnL.toFixed(2)),
    totalFees: Number(totalFees.toFixed(2)),
    wins,
    losses,
    winRate,
  };
}

/**
 * Derived reporting partition:
 * Splits raw trade records into:
 *   A. Historical / Forensic Archive (all records <= Step 6E boundary)
 *   B. Clean Post-Step-6E Forward Validation (strictly > Step 6E boundary)
 * 
 * DOES NOT mutate any trade records, localStorage, or engine state.
 */
export function partitionForwardTrades(rawTrades: ForwardTrade[]): ForwardReportingPartition {
  const cleanTrades: ForwardTrade[] = [];
  const historicalTrades: ForwardTrade[] = [];

  for (const trade of rawTrades) {
    const execTimeStr = trade.entryExecutedAtUtc || trade.openedAt;
    const execTimeMs = execTimeStr ? new Date(execTimeStr).getTime() : 0;

    // Strictly after Step 6E deployment boundary
    if (execTimeMs > STEP_6E_DEPLOYMENT_CUTOFF_MS) {
      cleanTrades.push(trade);
    } else {
      historicalTrades.push(trade);
    }
  }

  // Classify historical trades (identify duplicates without modifying underlying objects)
  const seenSignalKeys = new Set<string>();
  const classifiedHistoricalTrades: ClassifiedHistoricalTrade[] = historicalTrades.map(trade => {
    const key = `${trade.signalCandleTimeUtc || ''}_${trade.direction}`;
    if (seenSignalKeys.has(key)) {
      return {
        trade,
        isDuplicate: true,
        duplicateReason: `Duplicate signal candle timestamp (${trade.signalCandleTimeUtc}) and direction (${trade.direction}) prior to Step 6E idempotency gate`,
      };
    }
    seenSignalKeys.add(key);
    return {
      trade,
      isDuplicate: false,
    };
  });

  return {
    cutoffUtc: STEP_6E_DEPLOYMENT_CUTOFF_UTC,
    cleanTrades,
    cleanMetrics: calculateCleanMetrics(cleanTrades),
    historicalTrades,
    classifiedHistoricalTrades,
    historicalMetrics: calculateHistoricalMetrics(historicalTrades),
  };
}
