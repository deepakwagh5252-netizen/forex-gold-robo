import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Play,
  Pause,
  RotateCcw,
  Activity,
  Layers,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Info,
  DollarSign,
  Filter,
  RefreshCw,
  Bell,
  Send,
  Copy,
  Check,
  ArrowRightLeft,
} from 'lucide-react';
import { Step5EquivalenceReportView } from './Step5EquivalenceReportView';
import { forwardPaperEngine } from '../services/paper-trading/forward-paper-engine';
import { telegramNotificationService } from '../services/notifications/telegram-notification-service';
import { TelegramNotificationStatus } from '../types/telegram';
import {
  ForwardEngineStatus,
  ForwardPerformanceMetrics,
  ForwardValidationProgress,
  ForwardSignal,
  ForwardTrade,
  ForwardPosition,
  ForwardAccountState,
} from '../types/forward-validation';
import {
  partitionForwardTrades,
  STEP_6E_DEPLOYMENT_CUTOFF_UTC,
} from '../utils/forward-partition';

export const ForwardPaperDashboard: React.FC = () => {
  const [status, setStatus] = useState<ForwardEngineStatus>(() => forwardPaperEngine.getStatus());
  const [account, setAccount] = useState<ForwardAccountState>(() => forwardPaperEngine.getAccount());
  const [metrics, setMetrics] = useState<ForwardPerformanceMetrics>(() => forwardPaperEngine.getMetrics());
  const [progress, setProgress] = useState<ForwardValidationProgress>(() => forwardPaperEngine.getProgress());
  const [signals, setSignals] = useState<ForwardSignal[]>(() => forwardPaperEngine.getSignals());
  const [trades, setTrades] = useState<ForwardTrade[]>(() => forwardPaperEngine.getTrades());
  const [positions, setPositions] = useState<ForwardPosition[]>(() => forwardPaperEngine.getOpenPositions());
  const [activeTab, setActiveTab] = useState<'overview' | 'signals' | 'clean_trades' | 'historical_archive' | 'trades' | 'attribution' | 'step5_equivalence'>('overview');

  const partition = React.useMemo(() => partitionForwardTrades(trades), [trades]);

  const [telegramStatus, setTelegramStatus] = useState<TelegramNotificationStatus | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedRawTrades, setCopiedRawTrades] = useState(false);
  const [copiedRawSignals, setCopiedRawSignals] = useState(false);

  useEffect(() => {
    const unsubStatus = forwardPaperEngine.onStatusChange((s) => {
      setStatus(s);
      setAccount(forwardPaperEngine.getAccount());
      setMetrics(forwardPaperEngine.getMetrics());
      setProgress(forwardPaperEngine.getProgress());
      setPositions(forwardPaperEngine.getOpenPositions());
    });

    const unsubSignal = forwardPaperEngine.onSignal(() => {
      setSignals(forwardPaperEngine.getSignals());
      setStatus(forwardPaperEngine.getStatus());
      setProgress(forwardPaperEngine.getProgress());
    });

    const unsubTrade = forwardPaperEngine.onTrade(() => {
      setTrades(forwardPaperEngine.getTrades());
      setMetrics(forwardPaperEngine.getMetrics());
      setProgress(forwardPaperEngine.getProgress());
      setPositions(forwardPaperEngine.getOpenPositions());
      setAccount(forwardPaperEngine.getAccount());
    });

    return () => {
      unsubStatus();
      unsubSignal();
      unsubTrade();
    };
  }, []);

  useEffect(() => {
    telegramNotificationService.getStatus().then(setTelegramStatus).catch(() => {});
  }, []);

  const handleTestTelegram = async () => {
    setIsTestingTelegram(true);
    setTelegramFeedback(null);
    try {
      const res = await telegramNotificationService.sendTestNotification();
      if (res.sent) {
        setTelegramFeedback('Test notification sent successfully to Telegram.');
      } else if (res.status === 'NOT_CONFIGURED') {
        setTelegramFeedback('TELEGRAM_NOT_CONFIGURED: Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to server environment to receive notifications.');
      } else {
        setTelegramFeedback(`Delivery note: ${res.error || 'Check server logs.'}`);
      }
      const updated = await telegramNotificationService.getStatus();
      setTelegramStatus(updated);
    } catch (err: any) {
      setTelegramFeedback(`Error: ${err.message}`);
    } finally {
      setIsTestingTelegram(false);
      setTimeout(() => setTelegramFeedback(null), 6000);
    }
  };

  const handleToggleTrading = () => {
    const nextState = !forwardPaperEngine.isPaperTradingActive();
    forwardPaperEngine.setPaperTradingActive(nextState);
    setStatus(forwardPaperEngine.getStatus());
    setAccount(forwardPaperEngine.getAccount());
  };

  const handleReset = () => {
    if (window.confirm('Reset forward paper account to $100,000 starting capital? All forward signals and trade records will be cleared.')) {
      forwardPaperEngine.resetForwardState(100_000);
      setStatus(forwardPaperEngine.getStatus());
      setAccount(forwardPaperEngine.getAccount());
      setMetrics(forwardPaperEngine.getMetrics());
      setProgress(forwardPaperEngine.getProgress());
      setSignals([]);
      setTrades([]);
      setPositions([]);
    }
  };

  const generateReportText = (): string => {
    const timestampUTC = new Date().toISOString();
    const latestTrade = trades.length > 0 ? trades[trades.length - 1] : null;
    const latestTradeStr = latestTrade
      ? `${latestTrade.tradeId} | ${latestTrade.direction} | Entry: $${latestTrade.entryPrice.toFixed(2)} | Exit: $${latestTrade.exitPrice.toFixed(2)} | Net P&L: ${latestTrade.netPnL >= 0 ? '+' : ''}$${latestTrade.netPnL.toFixed(2)} (${latestTrade.closeReason}) | Closed: ${latestTrade.closedAt}`
      : 'None';

    const latestSignal = status.lastSignal;
    const latestSignalStr = latestSignal
      ? `${latestSignal.signalId} | ${latestSignal.direction} | Decision: ${latestSignal.decision} (${latestSignal.decisionReason}) | Candle: ${latestSignal.candleTimestampUTC}`
      : 'None';

    const cleanM = partition.cleanMetrics;
    const histM = partition.historicalMetrics;

    const cleanNetSign = cleanM.netPnL >= 0 ? '+' : '';
    const cleanExpSign = cleanM.expectancy >= 0 ? '+' : '';
    const unrealizedSign = account.unrealizedPnL >= 0 ? '+' : '';
    const realizedSign = account.realizedPnL >= 0 ? '+' : '';

    return [
      '================================================================',
      'FOREX & GOLD ROBO — FORWARD PAPER VALIDATION REPORT',
      '================================================================',
      `Generated At UTC:           ${timestampUTC}`,
      'Asset & Timeframe:          XAU/USD M15',
      'Execution Mode:             PAPER TRADING ONLY (ZERO REAL BROKER ROUTE)',
      'Strategy Configuration:     Phase 7F/7G Frozen Rules',
      'Combined Filter AB:         FROZEN Candidate (Short in Bearish / Asian 00-07 UTC)',
      '',
      '----------------------------------------------------------------',
      '1. ENGINE & PAPER ACCOUNT STATUS',
      '----------------------------------------------------------------',
      `Engine Status:              ${status.engineStatus}`,
      `Paper Trading Status:       ${status.paperStatus}`,
      `Data Integrity Status:      ${status.dataStatus}`,
      `Starting Balance:           $${account.startingBalance.toFixed(2)}`,
      `Current Equity:             $${account.currentEquity.toFixed(2)}`,
      `Current Balance:            $${account.currentBalance.toFixed(2)}`,
      `Peak Equity:                $${account.peakEquity.toFixed(2)}`,
      `Unrealized P&L:             ${unrealizedSign}$${account.unrealizedPnL.toFixed(2)}`,
      `Realized P&L:               ${realizedSign}$${account.realizedPnL.toFixed(2)}`,
      `Total Fees Paid:            $${account.totalFeesPaid.toFixed(2)}`,
      `Open Positions:             ${positions.length} / 3 MAX`,
      '',
      '----------------------------------------------------------------',
      '2. CLEAN POST-STEP-6E FORWARD VALIDATION METRICS',
      '----------------------------------------------------------------',
      `Step 6E Deployment Cutoff:  ${STEP_6E_DEPLOYMENT_CUTOFF_UTC}`,
      `Admission Criterion:        entryExecutedAtUtc strictly > Cutoff`,
      `Clean Forward Trades:       ${cleanM.tradeCount}`,
      `Wins:                       ${cleanM.wins}`,
      `Losses:                     ${cleanM.losses}`,
      `Win Rate:                   ${cleanM.winRate.toFixed(1)}%`,
      `Net P&L:                    ${cleanNetSign}$${cleanM.netPnL.toFixed(2)}`,
      `Gross Profit:               $${cleanM.grossProfit.toFixed(2)}`,
      `Gross Loss:                 $${cleanM.grossLoss.toFixed(2)}`,
      `Profit Factor:              ${cleanM.tradeCount > 0 ? cleanM.profitFactor.toFixed(2) : '—'}`,
      `Expectancy:                 ${cleanExpSign}$${cleanM.expectancy.toFixed(2)}/trade`,
      `Maximum Drawdown:           ${cleanM.maxDrawdownPercent.toFixed(2)}% ($${cleanM.maxDrawdown.toFixed(2)})`,
      `Total Fees:                 $${cleanM.totalFees.toFixed(2)}`,
      '',
      '----------------------------------------------------------------',
      '2B. HISTORICAL / FORENSIC ARCHIVE (PRE-STEP-6E)',
      '----------------------------------------------------------------',
      `Archive Preservation:       PRESERVED UNCHANGED (ZERO MUTATION)`,
      `Total Preserved Records:    ${histM.totalRecords}`,
      `Duplicate Incident Records: ${histM.duplicateRecords} (Quarantined from Clean Validation)`,
      `Genuine Pre-6E Test Trades: ${histM.genuineRecords}`,
      `Preserved Raw Net P&L:      +$${histM.netPnL.toFixed(2)}`,
      `Preserved Total Fees:       $${histM.totalFees.toFixed(2)}`,
      `Quarantine Verification:    SEPARATED AT REPORTING LAYER ONLY`,
      '',
      '----------------------------------------------------------------',
      '3. FORWARD OBSERVATION & AUDIT COUNTERS',
      '----------------------------------------------------------------',
      `Observation Period:         ${progress.daysObserved} days`,
      `M15 Candles Confirmed:      ${progress.m15CandlesObserved}`,
      `Signals Evaluated:          ${progress.forwardObservationCount}`,
      `Executed Trades:            ${progress.executedTrades}`,
      `Filtered Signals:           ${progress.filteredSignals}`,
      `Risk Rejections:            ${progress.riskRejections}`,
      `Data Warnings / Rejections: ${progress.dataRejections}`,
      '',
      '----------------------------------------------------------------',
      '4. LATEST ACTIVITY',
      '----------------------------------------------------------------',
      `Latest Candle:              ${status.lastCandle ? `${status.lastCandle.datetime} ($${status.lastCandle.close.toFixed(2)})` : 'None'}`,
      `Latest Signal:              ${latestSignalStr}`,
      `Latest Trade:               ${latestTradeStr}`,
      '',
      '================================================================',
      'END OF REPORT',
      '================================================================',
    ].join('\n');
  };

  const handleCopyReport = async () => {
    const text = generateReportText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch (err) {
      console.error('Failed to copy report to clipboard:', err);
    }
  };

  const handleCopyRawForwardTradesJson = async () => {
    try {
      const raw = localStorage.getItem('forex_gold_robo_forward_trades_v1') || '';
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(raw);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = raw;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedRawTrades(true);
      setTimeout(() => setCopiedRawTrades(false), 2500);
    } catch (err) {
      console.error('Failed to copy raw forward trades to clipboard:', err);
    }
  };

  const handleCopyRawForwardSignalsJson = async () => {
    try {
      const raw = localStorage.getItem('forex_gold_robo_forward_signals_v1') || '';
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(raw);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = raw;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedRawSignals(true);
      setTimeout(() => setCopiedRawSignals(false), 2500);
    } catch (err) {
      console.error('Failed to copy raw forward signals to clipboard:', err);
    }
  };

  const isSafe = status.dataStatus === 'DATA_SAFE';
  const isPaperActive = status.paperStatus === 'PAPER_ACTIVE';

  return (
    <div className="flex flex-col h-full bg-[#070b13] text-slate-100 font-mono text-xs overflow-y-auto p-4 space-y-4">
      {/* 1. TOP HEADER & SAFETY CALLOUT */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-[#0d1524] border border-[#1b2a44] rounded">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded ${isSafe ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'}`}>
            {isSafe ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wide text-slate-100 uppercase">
                PHASE 8: LIVE FORWARD PAPER VALIDATION
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/50 font-semibold">
                FROZEN CANDIDATE AB
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/50 font-semibold">
                PAPER ONLY — ZERO BROKER ROUTE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Deterministic 24/7 validation layer observing live XAU/USD M15 candles under strict Phase 7F/7G frozen rules.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleTrading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors border ${
              isPaperActive
                ? 'bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 border-rose-700/60'
                : 'bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-200 border-emerald-700/60'
            }`}
          >
            {isPaperActive ? (
              <>
                <Pause className="w-3.5 h-3.5" /> DEACTIVATE PAPER TRADING
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> ACTIVATE FORWARD PAPER TRADING
              </>
            )}
          </button>

          <button
            id="open-step5-equivalence-btn"
            onClick={() => setActiveTab('step5_equivalence')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-colors ${
              activeTab === 'step5_equivalence'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-600'
                : 'bg-[#131f33] hover:bg-[#1b2b45] text-cyan-400 hover:text-cyan-300 border border-[#223554]'
            }`}
            title="Open Step 5 Golden Forward ↔ Replay Equivalence Report"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>STEP 5 EQUIVALENCE</span>
          </button>

          <button
            id="copy-forward-report-btn"
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#131f33] hover:bg-[#1b2b45] text-cyan-300 hover:text-cyan-200 border border-[#223554] text-xs transition-colors font-semibold"
            title="Copy complete Forward Paper report to clipboard"
          >
            {copiedReport ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">COPIED!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>COPY REPORT</span>
              </>
            )}
          </button>

          <button
            id="copy-raw-forward-trades-btn"
            onClick={handleCopyRawForwardTradesJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#131f33] hover:bg-[#1b2b45] text-amber-300 hover:text-amber-200 border border-[#223554] text-xs transition-colors font-semibold"
            title="Copy Raw Forward Trades JSON from localStorage"
          >
            {copiedRawTrades ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">COPIED RAW JSON!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Raw Forward Trades JSON</span>
              </>
            )}
          </button>

          <button
            id="copy-raw-forward-signals-btn"
            onClick={handleCopyRawForwardSignalsJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#131f33] hover:bg-[#1b2b45] text-purple-300 hover:text-purple-200 border border-[#223554] text-xs transition-colors font-semibold"
            title="Copy Raw Forward Signals JSON from localStorage"
          >
            {copiedRawSignals ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">COPIED RAW SIGNALS!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Raw Forward Signals JSON</span>
              </>
            )}
          </button>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#131f33] hover:bg-[#1b2b45] text-slate-300 border border-[#223554] text-xs transition-colors"
            title="Reset Forward Validation State"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* 2. REAL-TIME ENGINE STATUS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {/* Card 1: Data Status */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">DATA STATUS</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${isSafe ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            <span className={`font-bold ${isSafe ? 'text-emerald-400' : 'text-rose-400'}`}>
              {status.dataStatus}
            </span>
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block">
            {isSafe ? 'OHLC & Monotonicity Valid' : 'Trading Halted: Data Unsafe'}
          </span>
        </div>

        {/* Card 2: Engine Status */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">ENGINE STATUS</span>
          <div className="flex items-center gap-1.5 mt-1">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-bold text-cyan-300">{status.engineStatus}</span>
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block">Deterministic 24/7 Loop</span>
        </div>

        {/* Card 3: Paper Status */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">PAPER STATUS</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`font-bold ${isPaperActive ? 'text-emerald-300' : 'text-amber-400'}`}>
              {status.paperStatus}
            </span>
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block">
            {isPaperActive ? 'Simulated Orders Active' : 'User Activation Required'}
          </span>
        </div>

        {/* Card 4: Last Closed Candle */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">LAST M15 CANDLE</span>
          <div className="font-bold text-slate-200 mt-1 truncate">
            {status.lastCandle ? `$${status.lastCandle.close.toFixed(2)}` : 'Awaiting Feed'}
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block truncate">
            {status.lastCandle ? status.lastCandle.datetime.substring(11, 19) + ' UTC' : 'Pending Polling'}
          </span>
        </div>

        {/* Card 5: Last Signal Decision */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">LAST SIGNAL</span>
          <div className="flex items-center gap-1 mt-1 truncate">
            <span className={`font-bold ${
              status.lastSignal?.decision === 'EXECUTED' ? 'text-emerald-400' :
              status.lastSignal?.decision === 'FILTERED' ? 'text-amber-400' :
              status.lastSignal?.decision === 'RISK_REJECTED' || status.lastSignal?.decision === 'CAPACITY_REJECTED' ? 'text-purple-400' :
              'text-slate-400'
            }`}>
              {status.lastSignal?.decision || 'NO_SIGNALS'}
            </span>
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block truncate">
            {status.lastSignal?.marketRegime || 'Waiting'}
          </span>
        </div>

        {/* Card 6: Open Positions */}
        <div className="p-2.5 bg-[#0a101b] border border-[#142033] rounded">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block">OPEN POSITIONS</span>
          <div className="font-bold text-slate-200 mt-1">
            {status.openPositionsCount} / 3 <span className="text-[10px] text-slate-500 font-normal">MAX</span>
          </div>
          <span className="text-[9px] text-slate-500 mt-1 block">
            {account.unrealizedPnL >= 0 ? '+' : ''}${account.unrealizedPnL.toFixed(2)} MTM
          </span>
        </div>
      </div>

      {/* 3. STRICT SEPARATION: HISTORICAL REFERENCE vs CLEAN POST-6E VALIDATION vs HISTORICAL ARCHIVE */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {/* Historical Frozen Reference Box (Phase 7G-D Verified Result) */}
        <div className="p-3 bg-[#090f1a] border border-[#172338] rounded flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#141f32] pb-1.5 mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-500" />
                HISTORICAL BENCHMARK (OOS)
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                FROZEN BENCHMARK
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              Phase 7G-D untouched Out-of-Sample (OOS) results (candles 8,401–12,000). Never blended with live forward stats:
            </p>
            <div className="grid grid-cols-5 gap-1.5 text-center py-2 bg-[#0c1320] border border-[#142033] rounded">
              <div>
                <span className="text-[8px] text-slate-500 block">OOS TRADES</span>
                <span className="text-xs font-bold text-slate-200">20</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-500 block">WIN RATE</span>
                <span className="text-xs font-bold text-slate-200">40.0%</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-500 block">PROFIT FACTOR</span>
                <span className="text-xs font-bold text-emerald-400">1.29</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-500 block">NET P&amp;L</span>
                <span className="text-xs font-bold text-emerald-400">+$4,174.58</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-500 block">MAX DD</span>
                <span className="text-xs font-bold text-amber-400">4.78%</span>
              </div>
            </div>
          </div>
          <div className="text-[9px] text-slate-600 mt-2 italic">
            * Historical reference point. Strategy and filters permanently frozen.
          </div>
        </div>

        {/* Clean Post-Step-6E Forward Validation Metrics Box */}
        <div className="p-3 bg-[#0a1220] border border-[#1b2b45] rounded flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#17253d] pb-1.5 mb-2">
              <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                CLEAN POST-STEP-6E FORWARD VALIDATION
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-semibold">
                VERIFIED CLEAN
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">
              Admitting ONLY trades strictly after Step 6E cutoff (<code className="text-cyan-300">{STEP_6E_DEPLOYMENT_CUTOFF_UTC.substring(11, 19)}Z</code>):
            </p>
            <div className="grid grid-cols-5 gap-1.5 text-center py-2 bg-[#0c1626] border border-[#192840] rounded">
              <div>
                <span className="text-[8px] text-slate-400 block">FWD TRADES</span>
                <span className="text-xs font-bold text-slate-100">{partition.cleanMetrics.tradeCount}</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">W / L (WR)</span>
                <span className="text-xs font-bold text-slate-100">
                  {partition.cleanMetrics.wins} / {partition.cleanMetrics.losses} ({partition.cleanMetrics.winRate.toFixed(1)}%)
                </span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">PROFIT FACTOR</span>
                <span className={`text-xs font-bold ${partition.cleanMetrics.profitFactor >= 1.0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {partition.cleanMetrics.tradeCount > 0 ? partition.cleanMetrics.profitFactor.toFixed(2) : '—'}
                </span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">NET P&amp;L</span>
                <span className={`text-xs font-bold ${partition.cleanMetrics.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {partition.cleanMetrics.netPnL >= 0 ? '+' : ''}${partition.cleanMetrics.netPnL.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">GROSS P / L</span>
                <span className="text-xs font-bold text-slate-200">
                  +${partition.cleanMetrics.grossProfit.toFixed(0)} / -${partition.cleanMetrics.grossLoss.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between text-[9px] text-slate-400 mt-2 gap-1 border-t border-[#142033] pt-1.5">
            <span>Expectancy: <b className="text-slate-200">${partition.cleanMetrics.expectancy.toFixed(2)}</b>/trade</span>
            <span>Max DD: <b className="text-slate-200">{partition.cleanMetrics.maxDrawdownPercent.toFixed(2)}%</b> (${partition.cleanMetrics.maxDrawdown.toFixed(2)})</span>
            <span>Total Fees: <b className="text-slate-200">${partition.cleanMetrics.totalFees.toFixed(2)}</b></span>
          </div>
        </div>

        {/* Historical / Forensic Archive Box */}
        <div className="p-3 bg-[#0a0f1d] border border-[#232f48] rounded flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-[#1c283f] pb-1.5 mb-2">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                HISTORICAL / FORENSIC ARCHIVE
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                PRESERVED RAW JOURNAL
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">
              Pre-Step-6E historical records preserved untouched. Duplicates quarantined from live forward metrics:
            </p>
            <div className="grid grid-cols-5 gap-1.5 text-center py-2 bg-[#0c1424] border border-[#18243c] rounded">
              <div>
                <span className="text-[8px] text-slate-400 block">TOTAL RECORDS</span>
                <span className="text-xs font-bold text-slate-100">{partition.historicalMetrics.totalRecords}</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">DUPLICATES</span>
                <span className="text-xs font-bold text-rose-400">{partition.historicalMetrics.duplicateRecords}</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">GENUINE TEST</span>
                <span className="text-xs font-bold text-cyan-300">{partition.historicalMetrics.genuineRecords}</span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">RAW NET P&amp;L</span>
                <span className="text-xs font-bold text-emerald-400">
                  +${partition.historicalMetrics.netPnL.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[8px] text-slate-400 block">RAW FEES</span>
                <span className="text-xs font-bold text-slate-200">
                  ${partition.historicalMetrics.totalFees.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[9px] text-slate-400 mt-2 border-t border-[#142033] pt-1.5">
            <span>Quarantine: <b className="text-amber-400">ISOLATED FROM CLEAN STATS</b></span>
            <span>Persistence: <b className="text-slate-300">100% UNCHANGED</b></span>
          </div>
        </div>
      </div>

      {/* 4. VALIDATION PROGRESS DISCIPLINE (NO FALSE PROFITABILITY CLAIMS) */}
      <div className="p-3 bg-[#090f1a] border border-[#162236] rounded">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            FORWARD OBSERVATION &amp; AUDIT PROGRESS
          </span>
          <span className="text-[10px] text-slate-500">
            Phase 8 Observation Gate
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-center">
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">OBSERVATION COUNT</span>
            <span className="text-xs font-bold text-slate-200">{progress.forwardObservationCount}</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">DAYS OBSERVED</span>
            <span className="text-xs font-bold text-slate-200">{progress.daysObserved} d</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">M15 CANDLES</span>
            <span className="text-xs font-bold text-slate-200">{progress.m15CandlesObserved}</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">EXECUTED TRADES</span>
            <span className="text-xs font-bold text-emerald-400">{progress.executedTrades}</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">FILTERED SIGNALS</span>
            <span className="text-xs font-bold text-amber-400">{progress.filteredSignals}</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">RISK / CAPACITY REJECTIONS</span>
            <span className="text-xs font-bold text-purple-400">{progress.riskRejections}</span>
          </div>
          <div className="p-2 bg-[#0c1322] border border-[#141e30] rounded">
            <span className="text-[9px] text-slate-500 block">DATA REJECTIONS</span>
            <span className="text-xs font-bold text-rose-400">{progress.dataRejections}</span>
          </div>
        </div>
      </div>

      {/* 4B. PHASE 8A: TELEGRAM TRADE NOTIFICATIONS (OUTBOUND ONLY) */}
      <div className="p-3 bg-[#09111e] border border-[#17253d] rounded">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#142033] pb-2 mb-2.5">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              PHASE 8A: TELEGRAM TRADE NOTIFICATIONS
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60 font-semibold">
              ONE-WAY OUTBOUND ONLY
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-semibold">
              ZERO BROKER ROUTE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTestTelegram}
              disabled={isTestingTelegram}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#132035] hover:bg-[#1a2d4b] text-cyan-300 border border-[#22395d] text-[11px] font-bold transition-colors disabled:opacity-50"
            >
              <Send className={`w-3 h-3 ${isTestingTelegram ? 'animate-pulse' : ''}`} />
              {isTestingTelegram ? 'SENDING TEST...' : 'TEST TELEGRAM'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2 text-[11px]">
          <div className="p-2 bg-[#0c1626] border border-[#16253c] rounded">
            <span className="text-[9px] text-slate-500 block">STATUS</span>
            <div className="flex items-center gap-1.5 mt-0.5 font-bold">
              <span
                className={`w-2 h-2 rounded-full ${
                  telegramStatus?.status === 'CONNECTED'
                    ? 'bg-emerald-400 animate-pulse'
                    : telegramStatus?.status === 'ERROR'
                    ? 'bg-rose-400'
                    : 'bg-amber-400'
                }`}
              />
              <span
                className={
                  telegramStatus?.status === 'CONNECTED'
                    ? 'text-emerald-400'
                    : telegramStatus?.status === 'ERROR'
                    ? 'text-rose-400'
                    : 'text-amber-400'
                }
              >
                {telegramStatus?.status || 'NOT_CONFIGURED'}
              </span>
            </div>
          </div>

          <div className="p-2 bg-[#0c1626] border border-[#16253c] rounded">
            <span className="text-[9px] text-slate-500 block">NOTIFICATIONS DISPATCHED</span>
            <span className="text-xs font-bold text-slate-200 mt-0.5 block">
              {telegramStatus?.totalSentCount || 0} sent
            </span>
          </div>

          <div className="p-2 bg-[#0c1626] border border-[#16253c] rounded">
            <span className="text-[9px] text-slate-500 block">LAST NOTIFICATION</span>
            <span className="text-xs font-bold text-slate-300 mt-0.5 block truncate">
              {telegramStatus?.lastSentAt
                ? new Date(telegramStatus.lastSentAt).toISOString().substring(11, 19) + ' UTC'
                : 'None Yet'}
            </span>
          </div>

          <div className="p-2 bg-[#0c1626] border border-[#16253c] rounded">
            <span className="text-[9px] text-slate-500 block">EVENT CHANNELS COVERED</span>
            <span className="text-[10px] text-cyan-300 mt-0.5 block font-semibold truncate">
              6/6 EVENTS ACTIVE
            </span>
          </div>
        </div>

        {telegramFeedback && (
          <div className="text-[10px] px-2.5 py-1.5 rounded bg-[#101c30] border border-[#1f3352] text-cyan-200 mb-2">
            {telegramFeedback}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-slate-400 pt-1.5 border-t border-[#131f32]">
          <span className="text-slate-500">Events:</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-900/50">🟢 TRADE OPENED</span>
          <span className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-900/50">🔴 TRADE CLOSED</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-900/50">⚠️ TRADE REJECTED</span>
          <span className="px-1.5 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-900/50">🛑 RISK LOCK</span>
          <span className="px-1.5 py-0.5 rounded bg-orange-950/60 text-orange-400 border border-orange-900/50">⚠️ DATA WARNING</span>
          <span className="px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-900/50">🟢/🔴 ENGINE STATUS</span>
        </div>
      </div>

      {/* 5. TAB NAVIGATION (SIGNALS / TRADES / POSITIONS) */}
      <div className="flex items-center gap-2 border-b border-[#17253d] pb-1">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'overview'
              ? 'bg-[#15233b] text-cyan-300 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Active Positions ({positions.length})
        </button>
        <button
          onClick={() => setActiveTab('signals')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'signals'
              ? 'bg-[#15233b] text-cyan-300 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Signal Journal ({signals.length})
        </button>
        <button
          id="tab-clean-trades-btn"
          onClick={() => setActiveTab('clean_trades')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'clean_trades' || activeTab === 'trades'
              ? 'bg-[#15233b] text-cyan-300 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Clean Post-Step-6E Trades ({partition.cleanTrades.length})
        </button>
        <button
          id="tab-historical-archive-btn"
          onClick={() => setActiveTab('historical_archive')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'historical_archive'
              ? 'bg-[#15233b] text-amber-300 border-b-2 border-amber-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Historical / Forensic Archive ({partition.historicalTrades.length})
        </button>
        <button
          onClick={() => setActiveTab('attribution')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'attribution'
              ? 'bg-[#15233b] text-cyan-300 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Attribution &amp; Lineage
        </button>
        <button
          id="tab-step5-equivalence-btn"
          onClick={() => setActiveTab('step5_equivalence')}
          className={`px-3 py-1 rounded-t text-xs font-bold transition-colors ${
            activeTab === 'step5_equivalence'
              ? 'bg-[#15233b] text-cyan-300 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Step 5 Golden Parity Report
        </button>
      </div>

      {/* 6. TAB CONTENT */}

      {/* TAB 1: ACTIVE POSITIONS */}
      {activeTab === 'overview' && (
        <div className="bg-[#090f1a] border border-[#162236] rounded p-3">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-2">
            OPEN POSITIONS (MAX 3 CONCURRENT)
          </span>
          {positions.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              No open positions. Standing by for confirmed Phase 8 setups.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#0d1626] text-slate-400 uppercase text-[9px]">
                  <tr>
                    <th className="p-2">Position ID</th>
                    <th className="p-2">Opened (UTC)</th>
                    <th className="p-2">Dir</th>
                    <th className="p-2">Size</th>
                    <th className="p-2">Entry</th>
                    <th className="p-2">Current</th>
                    <th className="p-2">SL</th>
                    <th className="p-2">TP</th>
                    <th className="p-2">Unrealized P&amp;L</th>
                    <th className="p-2">R-Mult</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#142033]">
                  {positions.map((pos, idx) => {
                    const isWin = pos.unrealizedPnL >= 0;
                    return (
                      <tr key={`${pos.positionId}-${idx}`} className="hover:bg-[#0c1424]">
                        <td className="p-2 font-mono text-cyan-300">{pos.positionId}</td>
                        <td className="p-2 text-slate-400">{pos.openedAt.substring(11, 19)}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            pos.direction === 'LONG' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                          }`}>
                            {pos.direction}
                          </span>
                        </td>
                        <td className="p-2 text-slate-300">{pos.lotSize} lots ({pos.positionSize} oz)</td>
                        <td className="p-2 font-bold text-slate-200">${pos.entryPrice.toFixed(2)}</td>
                        <td className="p-2 text-slate-300">${pos.currentPrice.toFixed(2)}</td>
                        <td className="p-2 text-rose-400">${pos.stopLoss.toFixed(2)}</td>
                        <td className="p-2 text-emerald-400">${pos.takeProfit.toFixed(2)}</td>
                        <td className={`p-2 font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isWin ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                        </td>
                        <td className="p-2 font-bold text-slate-300">{pos.unrealizedRMultiple.toFixed(2)}R</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SIGNAL JOURNAL (CRITICAL SECTION 7) */}
      {activeTab === 'signals' && (
        <div className="bg-[#090f1a] border border-[#162236] rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              FORWARD SIGNAL JOURNAL (EVERY CANDLE EVALUATED)
            </span>
            <span className="text-[10px] text-slate-500">
              Showing last {Math.min(signals.length, 50)} signals
            </span>
          </div>
          {signals.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              No forward signals recorded yet. Awaiting live candle evaluations.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-[#0d1626] text-slate-400 uppercase text-[9px] sticky top-0">
                  <tr>
                    <th className="p-1.5">Candle Time</th>
                    <th className="p-1.5">Dir</th>
                    <th className="p-1.5">Regime</th>
                    <th className="p-1.5">Session</th>
                    <th className="p-1.5">Filter A</th>
                    <th className="p-1.5">Filter B</th>
                    <th className="p-1.5">Filter AB</th>
                    <th className="p-1.5">Risk Check</th>
                    <th className="p-1.5">Decision</th>
                    <th className="p-1.5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#142033]">
                  {signals.slice(-50).reverse().map((sig, idx) => (
                    <tr key={`${sig.signalId || 'sig'}-${idx}`} className="hover:bg-[#0c1424]">
                      <td className="p-1.5 text-slate-400 whitespace-nowrap">
                        {sig.candleTimestampUTC?.substring(5, 16).replace('T', ' ') || '—'}
                      </td>
                      <td className="p-1.5">
                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                          sig.direction === 'LONG' ? 'bg-emerald-950 text-emerald-400' :
                          sig.direction === 'SHORT' ? 'bg-rose-950 text-rose-400' : 'text-slate-500'
                        }`}>
                          {sig.direction}
                        </span>
                      </td>
                      <td className="p-1.5 text-slate-300 whitespace-nowrap">{sig.marketRegime}</td>
                      <td className="p-1.5 text-slate-400 whitespace-nowrap">{sig.session}</td>
                      <td className="p-1.5">
                        <span className={`px-1 py-0.2 rounded text-[9px] ${sig.filterAResult === 'PASS' ? 'text-emerald-400' : 'text-rose-400 font-bold'}`}>
                          {sig.filterAResult}
                        </span>
                      </td>
                      <td className="p-1.5">
                        <span className={`px-1 py-0.2 rounded text-[9px] ${sig.filterBResult === 'PASS' ? 'text-emerald-400' : 'text-rose-400 font-bold'}`}>
                          {sig.filterBResult}
                        </span>
                      </td>
                      <td className="p-1.5">
                        <span className={`px-1 py-0.2 rounded text-[9px] ${sig.combinedFilterResult === 'PASS' ? 'text-emerald-400' : 'text-rose-400 font-bold'}`}>
                          {sig.combinedFilterResult}
                        </span>
                      </td>
                      <td className="p-1.5 text-slate-400 whitespace-nowrap">{sig.riskCheckResult}</td>
                      <td className="p-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          sig.decision === 'EXECUTED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                          sig.decision === 'FILTERED' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                          sig.decision === 'RISK_REJECTED' || sig.decision === 'CAPACITY_REJECTED' ? 'bg-purple-950 text-purple-300 border border-purple-800' :
                          'text-slate-500'
                        }`}>
                          {sig.decision}
                        </span>
                      </td>
                      <td className="p-1.5 text-slate-400 max-w-xs truncate" title={sig.decisionReason}>
                        {sig.decisionReason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CLEAN POST-STEP-6E FORWARD TRADES */}
      {(activeTab === 'clean_trades' || activeTab === 'trades') && (
        <div className="bg-[#090f1a] border border-[#162236] rounded p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#142033] pb-2">
            <div>
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider block">
                CLEAN POST-STEP-6E FORWARD TRADES ({partition.cleanTrades.length})
              </span>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Strict forward admission boundary: <code className="text-cyan-300">entryExecutedAtUtc &gt; {STEP_6E_DEPLOYMENT_CUTOFF_UTC}</code>. Zero historical duplicates permitted.
              </p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
              {partition.cleanTrades.length === 0 ? 'AWAITING FORWARD EXECUTIONS' : 'ACTIVE LIVE SUBSET'}
            </span>
          </div>

          {partition.cleanTrades.length === 0 ? (
            <div className="p-6 bg-[#0c1322] border border-[#162338] rounded text-center space-y-2">
              <div className="text-slate-300 font-bold text-xs uppercase tracking-wide">
                Clean Post-Step-6E Forward Validation Ledger: 0 Executed Trades
              </div>
              <p className="text-[11px] text-slate-400 max-w-xl mx-auto leading-relaxed">
                All 15 prior records (including the 6 duplicate incident records) are quarantined into the 
                <b className="text-amber-300 ml-1">Historical / Forensic Archive</b> tab without deleting or modifying underlying storage.
              </p>
              <p className="text-[10px] text-slate-500 max-w-lg mx-auto">
                As new real-time M15 candles close and evaluate under the frozen Step 6E single-processing idempotency gate, verified forward trades will record and display here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#0d1626] text-slate-400 uppercase text-[9px] sticky top-0">
                  <tr>
                    <th className="p-2">Trade ID</th>
                    <th className="p-2">Direction</th>
                    <th className="p-2">Signal Candle (UTC)</th>
                    <th className="p-2">Entry Executed (UTC)</th>
                    <th className="p-2">Closed (UTC)</th>
                    <th className="p-2">Entry</th>
                    <th className="p-2">Exit</th>
                    <th className="p-2">Size</th>
                    <th className="p-2">Fees</th>
                    <th className="p-2">Net P&amp;L</th>
                    <th className="p-2">R-Mult</th>
                    <th className="p-2">Close Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#142033]">
                  {partition.cleanTrades.slice().reverse().map((t, idx) => {
                    const isWin = t.isWin;
                    return (
                      <tr key={`${t.tradeId}-${idx}`} className="hover:bg-[#0c1424]">
                        <td className="p-2 text-cyan-300 font-mono text-[10px]">{t.tradeId}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            t.direction === 'LONG' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                          }`}>
                            {t.direction}
                          </span>
                        </td>
                        <td className="p-2 text-slate-400 whitespace-nowrap">{t.signalCandleTimeUtc?.substring(5, 16).replace('T', ' ') || '—'}</td>
                        <td className="p-2 text-slate-400 whitespace-nowrap">{(t.entryExecutedAtUtc || t.openedAt)?.substring(5, 16).replace('T', ' ')}</td>
                        <td className="p-2 text-slate-400 whitespace-nowrap">{t.closedAt?.substring(5, 16).replace('T', ' ')}</td>
                        <td className="p-2 text-slate-200">${t.entryPrice.toFixed(2)}</td>
                        <td className="p-2 text-slate-200">${t.exitPrice.toFixed(2)}</td>
                        <td className="p-2 text-slate-300">{t.lotSize} lots</td>
                        <td className="p-2 text-slate-400">${t.totalFees.toFixed(2)}</td>
                        <td className={`p-2 font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isWin ? '+' : ''}${t.netPnL.toFixed(2)}
                        </td>
                        <td className={`p-2 font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.rMultiple.toFixed(2)}R
                        </td>
                        <td className="p-2 text-slate-400 text-[10px]">{t.closeReason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3B: HISTORICAL / FORENSIC ARCHIVE */}
      {activeTab === 'historical_archive' && (
        <div className="bg-[#090f1a] border border-[#162236] rounded p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#142033] pb-2">
            <div>
              <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block">
                HISTORICAL / FORENSIC ARCHIVE ({partition.historicalTrades.length} Preserved Records)
              </span>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Pre-Step-6E historical executions preserved untouched. Duplicate incident records are quarantined from clean forward metrics.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800">
                {partition.historicalMetrics.duplicateRecords} Duplicates Quarantined
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                {partition.historicalMetrics.genuineRecords} Genuine Historical
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-[#0d1525] border border-[#1c2c48] rounded text-[10px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>Preserved Raw Journal:</b> All {partition.historicalTrades.length} records remain in localStorage. Zero records deleted, modified, or re-ordered.
            </span>
            <span className="text-slate-300 font-mono">
              Raw Cumulative Net P&amp;L: <b className="text-emerald-400">+${partition.historicalMetrics.netPnL.toFixed(2)}</b> | Total Fees: <b>${partition.historicalMetrics.totalFees.toFixed(2)}</b>
            </span>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#0d1626] text-slate-400 uppercase text-[9px] sticky top-0">
                <tr>
                  <th className="p-2">Classification</th>
                  <th className="p-2">Trade ID</th>
                  <th className="p-2">Dir</th>
                  <th className="p-2">Signal Candle (UTC)</th>
                  <th className="p-2">Entry Executed (UTC)</th>
                  <th className="p-2">Closed (UTC)</th>
                  <th className="p-2">Entry</th>
                  <th className="p-2">Exit</th>
                  <th className="p-2">Fees</th>
                  <th className="p-2">Net P&amp;L</th>
                  <th className="p-2">Close Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#142033]">
                {partition.classifiedHistoricalTrades.map((item, idx) => {
                  const t = item.trade;
                  const isWin = t.isWin;
                  return (
                    <tr 
                      key={`${t.tradeId}-${idx}`} 
                      className={`hover:bg-[#0c1424] ${item.isDuplicate ? 'bg-rose-950/20' : ''}`}
                    >
                      <td className="p-2">
                        {item.isDuplicate ? (
                          <span 
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800"
                            title={item.duplicateReason}
                          >
                            DUPLICATE INCIDENT
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            HISTORICAL TEST
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-cyan-300 font-mono text-[10px]">{t.tradeId}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          t.direction === 'LONG' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                        }`}>
                          {t.direction}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400 whitespace-nowrap">{t.signalCandleTimeUtc?.substring(5, 16).replace('T', ' ') || '—'}</td>
                      <td className="p-2 text-slate-400 whitespace-nowrap">{(t.entryExecutedAtUtc || t.openedAt)?.substring(5, 16).replace('T', ' ')}</td>
                      <td className="p-2 text-slate-400 whitespace-nowrap">{t.closedAt?.substring(5, 16).replace('T', ' ')}</td>
                      <td className="p-2 text-slate-200">${t.entryPrice.toFixed(2)}</td>
                      <td className="p-2 text-slate-200">${t.exitPrice.toFixed(2)}</td>
                      <td className="p-2 text-slate-400">${t.totalFees.toFixed(2)}</td>
                      <td className={`p-2 font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isWin ? '+' : ''}${t.netPnL.toFixed(2)}
                      </td>
                      <td className="p-2 text-slate-400 text-[10px]">{t.closeReason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ATTRIBUTION & LINEAGE (SECTION 13 & 16) */}
      {activeTab === 'attribution' && (
        <div className="bg-[#090f1a] border border-[#162236] rounded p-3 space-y-3">
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
            FORWARD TRADE ATTRIBUTION &amp; LINEAGE AUDIT
          </span>
          <p className="text-[10px] text-slate-400">
            Every trade is fully auditable through its complete source lineage:
            <code className="text-cyan-300 mx-1">Candle → Signal → Filter Decision → Risk Decision → Simulated Fill → Position → Exit → P&amp;L</code>.
          </p>
          {trades.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              No trade lineage entries to attribute yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {trades.map((t, idx) => (
                <div key={`${t.tradeId}-${idx}`} className="p-2.5 bg-[#0c1424] border border-[#17253d] rounded text-[10px] space-y-1">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-cyan-300">{t.tradeId} — {t.direction} {t.lotSize} Lots</span>
                    <span className={t.isWin ? 'text-emerald-400' : 'text-rose-400'}>
                      {t.isWin ? '+' : ''}${t.netPnL.toFixed(2)} ({t.rMultiple}R)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-400 pt-1">
                    <div><b>Regime:</b> {t.attribution?.regime}</div>
                    <div><b>Session:</b> {t.attribution?.session}</div>
                    <div><b>Exit Reason:</b> {t.closeReason}</div>
                    <div><b>Filter State:</b> {t.attribution?.filterStatus}</div>
                  </div>
                  <div className="text-[9px] text-slate-500 pt-1 border-t border-[#131d2e]">
                    Quality Evidence: {t.attribution?.entryQualityEvidence.join(' | ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: STEP 5 GOLDEN FORWARD <-> REPLAY EQUIVALENCE REPORT */}
      {activeTab === 'step5_equivalence' && (
        <Step5EquivalenceReportView />
      )}
    </div>
  );
};
