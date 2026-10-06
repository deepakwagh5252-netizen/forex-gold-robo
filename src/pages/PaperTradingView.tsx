import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Play, 
  Pause, 
  RotateCcw, 
  Sliders, 
  AlertTriangle, 
  ArrowLeft, 
  ArrowUpRight, 
  ArrowDownRight, 
  Layers, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Info, 
  DollarSign, 
  Activity, 
  FileText, 
  RefreshCw,
  Zap,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { paperTradingEngine } from '../services/paper-trading/paper-trading-engine';
import { riskEngine } from '../services/paper-trading/risk-manager';
import { marketService } from '../services/market-service';
import { 
  PaperAccount, 
  PaperPosition, 
  PaperOrder, 
  PaperRiskConfig, 
  PaperTradeJournalEntry 
} from '../types/paper-trading';
import { ScannerSummary, SetupRecord } from '../types/scanner';
import { ForwardPaperDashboard } from '../components/ForwardPaperDashboard';

interface PaperTradingViewProps {
  onBackToCommandCenter: () => void;
  onNavigateToJournal?: () => void;
}

export const PaperTradingView: React.FC<PaperTradingViewProps> = ({
  onBackToCommandCenter,
  onNavigateToJournal,
}) => {
  const accountService = paperTradingEngine.getAccountService();
  const orderService = paperTradingEngine.getOrderService();
  const journalService = paperTradingEngine.getJournalService();
  const riskManager = paperTradingEngine.getRiskManager();

  const [account, setAccount] = useState<PaperAccount>(() => accountService.getAccount());
  const [positions, setPositions] = useState<PaperPosition[]>(() => paperTradingEngine.getOpenPositions());
  const [orders, setOrders] = useState<PaperOrder[]>(() => orderService.getAllOrders());
  const [closedTrades, setClosedTrades] = useState<PaperTradeJournalEntry[]>(() => journalService.getEntries());
  const [riskConfig, setRiskConfig] = useState<PaperRiskConfig>(() => riskManager.getConfig());

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [viewMode, setViewMode] = useState<'forward_paper' | 'interactive_lab'>('forward_paper');
  const [isScanning, setIsScanning] = useState(false);
  const [scannerSummary, setScannerSummary] = useState<ScannerSummary | null>(null);

  // Editable settings form
  const [tempRiskPercent, setTempRiskPercent] = useState(riskConfig.riskPerTradePercent.toString());
  const [tempMaxPositions, setTempMaxPositions] = useState(riskConfig.maxOpenPositions.toString());
  const [tempMinRR, setTempMinRR] = useState(riskConfig.minRiskReward.toString());
  const [tempMaxDailyLoss, setTempMaxDailyLoss] = useState(riskConfig.maxDailyLossPercent.toString());
  const [tempMaxDrawdown, setTempMaxDrawdown] = useState(riskConfig.maxAccountDrawdownPercent.toString());
  const [tempXauSpec, setTempXauSpec] = useState(riskConfig.contractSpecifications['XAU/USD']?.toString() || '');
  const [tempRequireContractSpec, setTempRequireContractSpec] = useState(riskConfig.requireContractSpec);

  // Explicit simulation friction parameters (Phase 4B Execution Integrity)
  const [tempCommissionDisabled, setTempCommissionDisabled] = useState(riskConfig.commissionDisabled);
  const [tempCommissionPerLot, setTempCommissionPerLot] = useState(
    riskConfig.commissionPerLot !== null && riskConfig.commissionPerLot !== undefined
      ? riskConfig.commissionPerLot.toString()
      : ''
  );
  const [tempSpreadDisabled, setTempSpreadDisabled] = useState(riskConfig.spreadDisabled);
  const [tempSpreadMarkupPips, setTempSpreadMarkupPips] = useState(
    riskConfig.spreadMarkupPips !== null && riskConfig.spreadMarkupPips !== undefined
      ? riskConfig.spreadMarkupPips.toString()
      : ''
  );
  const [tempSlippageDisabled, setTempSlippageDisabled] = useState(riskConfig.slippageDisabled);
  const [tempSlippagePips, setTempSlippagePips] = useState(
    riskConfig.slippagePips !== null && riskConfig.slippagePips !== undefined
      ? riskConfig.slippagePips.toString()
      : ''
  );

  const openSettingsModal = () => {
    setTempRiskPercent(riskConfig.riskPerTradePercent.toString());
    setTempMaxPositions(riskConfig.maxOpenPositions.toString());
    setTempMinRR(riskConfig.minRiskReward.toString());
    setTempMaxDailyLoss(riskConfig.maxDailyLossPercent.toString());
    setTempMaxDrawdown(riskConfig.maxAccountDrawdownPercent.toString());
    setTempXauSpec(riskConfig.contractSpecifications['XAU/USD']?.toString() || '');
    setTempRequireContractSpec(riskConfig.requireContractSpec);
    setTempCommissionDisabled(riskConfig.commissionDisabled);
    setTempCommissionPerLot(
      riskConfig.commissionPerLot !== null && riskConfig.commissionPerLot !== undefined
        ? riskConfig.commissionPerLot.toString()
        : ''
    );
    setTempSpreadDisabled(riskConfig.spreadDisabled);
    setTempSpreadMarkupPips(
      riskConfig.spreadMarkupPips !== null && riskConfig.spreadMarkupPips !== undefined
        ? riskConfig.spreadMarkupPips.toString()
        : ''
    );
    setTempSlippageDisabled(riskConfig.slippageDisabled);
    setTempSlippagePips(
      riskConfig.slippagePips !== null && riskConfig.slippagePips !== undefined
        ? riskConfig.slippagePips.toString()
        : ''
    );
    setIsSettingsOpen(true);
  };

  // Real-time subscriptions
  useEffect(() => {
    const unsubAccount = accountService.subscribe((acc) => setAccount(acc));
    const unsubPositions = paperTradingEngine.subscribePositions((pos) => setPositions(pos));
    const unsubOrders = orderService.subscribe((ord) => setOrders(ord));
    const unsubJournal = journalService.subscribe((entries) => setClosedTrades(entries));

    return () => {
      unsubAccount();
      unsubPositions();
      unsubOrders();
      unsubJournal();
    };
  }, [accountService, orderService, journalService]);

  // Handle Enable / Disable Paper Trading
  const toggleTradingEnabled = () => {
    const nextState = !account.isTradingEnabled;
    const updated = paperTradingEngine.enablePaperTrading(nextState);
    setAccount(updated);
    setActionMessage({
      text: nextState ? 'PAPER TRADING ENABLED (Simulation Mode Active)' : 'PAPER TRADING PAUSED',
      type: nextState ? 'success' : 'info',
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  // Handle Account Reset
  const handleConfirmReset = () => {
    paperTradingEngine.resetAll(1_000_000);
    setIsResetConfirmOpen(false);
    setActionMessage({
      text: 'Paper account and trade journal reset to initial $1,000,000 USD virtual capital.',
      type: 'success',
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  // Save Settings
  const handleSaveSettings = () => {
    const parsedRisk = parseFloat(tempRiskPercent) || 1.0;
    const parsedMaxPos = parseInt(tempMaxPositions, 10) || 3;
    const parsedMinRR = parseFloat(tempMinRR) || 2.0;
    const parsedDailyLoss = parseFloat(tempMaxDailyLoss) || 3.0;
    const parsedMaxDD = parseFloat(tempMaxDrawdown) || 10.0;
    const parsedXau = tempXauSpec.trim() ? parseFloat(tempXauSpec) : null;

    const parsedCommission = tempCommissionDisabled
      ? 0
      : (tempCommissionPerLot.trim() ? parseFloat(tempCommissionPerLot) : null);

    const parsedSpread = tempSpreadDisabled
      ? 0
      : (tempSpreadMarkupPips.trim() ? parseFloat(tempSpreadMarkupPips) : null);

    const parsedSlippage = tempSlippageDisabled
      ? 0
      : (tempSlippagePips.trim() ? parseFloat(tempSlippagePips) : null);

    const updated = riskManager.updateConfig({
      riskPerTradePercent: parsedRisk,
      maxOpenPositions: parsedMaxPos,
      minRiskReward: parsedMinRR,
      maxDailyLossPercent: parsedDailyLoss,
      maxAccountDrawdownPercent: parsedMaxDD,
      requireContractSpec: tempRequireContractSpec,
      contractSpecifications: {
        ...riskConfig.contractSpecifications,
        'XAU/USD': parsedXau,
      },
      commissionDisabled: tempCommissionDisabled,
      commissionPerLot: parsedCommission,
      spreadDisabled: tempSpreadDisabled,
      spreadMarkupPips: parsedSpread,
      slippageDisabled: tempSlippageDisabled,
      slippagePips: parsedSlippage,
    });

    setRiskConfig(updated);
    setIsSettingsOpen(false);
    setActionMessage({
      text: 'Paper risk & simulation friction settings updated successfully.',
      type: 'success',
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  // Run scanner and evaluate any VALIDATED_CANDIDATE
  const handleScanForCandidates = async () => {
    setIsScanning(true);
    setActionMessage(null);
    try {
      const candles = await marketService.getHistoricalCandles('XAU/USD', '15min');
      const intel = await marketService.getXauUsdIntelligence('15min');

      if (!intel || intel.status !== 'VERIFIED' || !candles || candles.length < 10) {
        setActionMessage({
          text: 'NO VERIFIED MARKET DATA: Scanner requires verified Twelve Data candles to scan.',
          type: 'error',
        });
        setIsScanning(false);
        return;
      }

      const summary = marketService.scanXauUsdCandles(intel, candles, { minRiskReward: riskConfig.minRiskReward });
      setScannerSummary(summary);

      if (!summary.candidates || summary.candidates.length === 0) {
        setActionMessage({
          text: 'NO VALIDATED SETUP: Zero candidate setups found. No paper order created.',
          type: 'info',
        });
      } else {
        const validated = summary.candidates.filter((c) => c.status === 'VALIDATED_CANDIDATE');
        if (validated.length === 0) {
          setActionMessage({
            text: `Evaluated ${summary.candidates.length} candidates, but none reached VALIDATED_CANDIDATE status. No paper orders created.`,
            type: 'info',
          });
        } else {
          // Phase 4A: Evaluate candidates using RiskEngine WITHOUT executing trades
          const quote = marketService.getQuote('XAU/USD');
          let allowedCount = 0;
          let blockedCount = 0;
          const blockedReasons: string[] = [];

          for (const cand of validated) {
            const riskEval = riskEngine.evaluateOrderEligibility(cand, account, positions.length);
            if (riskEval.isEligible && riskEval.decision === 'ALLOWED') {
              allowedCount++;
            } else {
              blockedCount++;
              const reason = riskEval.decision || riskEval.rejectionReason || 'BLOCKED';
              if (!blockedReasons.includes(reason)) {
                blockedReasons.push(reason);
              }
            }
          }

          if (!account.isTradingEnabled) {
            setActionMessage({
              text: `Phase 4B Execution Engine: Found ${validated.length} candidate(s). All BLOCKED_PAPER_DISABLED. Enable Paper Trading to execute simulated paper orders.`,
              type: 'info',
            });
          } else {
            // Phase 4B: Full simulated execution engine processing
            let filledCount = 0;
            let pendingCount = 0;
            let rejectedCount = 0;
            const rejectionReasons: string[] = [];

            for (const cand of validated) {
              const res = paperTradingEngine.evaluateAndProcessSetup(cand, quote, 'MARKET');
              if (res.success) {
                if (res.position) {
                  filledCount++;
                } else {
                  pendingCount++;
                }
              } else {
                rejectedCount++;
                if (res.rejectionReason && !rejectionReasons.includes(res.rejectionReason)) {
                  rejectionReasons.push(res.rejectionReason);
                }
              }
            }

            if (filledCount > 0 || pendingCount > 0) {
              setActionMessage({
                text: `Phase 4B Simulation: ${filledCount} position(s) opened with verified market fills (spread + slippage + commission fees applied), ${pendingCount} pending order(s) placed.${rejectedCount > 0 ? ` (${rejectedCount} blocked: ${rejectionReasons.join(', ')})` : ''}`,
                type: 'success',
              });
            } else {
              setActionMessage({
                text: `Phase 4B Risk & Sizing: ${rejectedCount} candidate(s) rejected by deterministic risk rules (${rejectionReasons.join(', ') || 'Requirements breached'}).`,
                type: 'info',
              });
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error evaluating scanner';
      setActionMessage({ text: `Scanner Error: ${msg}`, type: 'error' });
    } finally {
      setIsScanning(false);
    }
  };

  // Manual Paper Close
  const handlePaperClose = (positionId: string) => {
    const quote = marketService.getQuote('XAU/USD');
    const success = paperTradingEngine.closePositionManually(positionId, quote);
    if (success) {
      setActionMessage({
        text: `Paper position ${positionId} closed manually at verified market rate.`,
        type: 'success',
      });
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Partial Take Profit (50%)
  const handlePartialClose = (positionId: string) => {
    const quote = marketService.getQuote('XAU/USD');
    const success = paperTradingEngine.partialClosePosition(positionId, 50, quote);
    if (success) {
      setActionMessage({
        text: `Partial Take Profit executed for position ${positionId} (50% closed at verified market rate with fees applied).`,
        type: 'success',
      });
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  // Cancel Pending Order
  const handleCancelOrder = (orderId: string) => {
    orderService.updateOrderStatus(orderId, 'CANCELLED', {
      closedAt: new Date().toISOString(),
      closeReason: 'MANUAL_PAPER_CLOSE',
      rejectionDetails: 'Cancelled by user from Paper Trading Dashboard.',
    });
    setActionMessage({
      text: `Pending paper order ${orderId} cancelled.`,
      type: 'info',
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === 'PENDING'), [orders]);

  return (
    <div 
      id="paper-trading-page"
      className="flex-1 flex flex-col bg-[#070b13] text-slate-100 p-4 overflow-y-auto font-mono select-none"
    >
      {/* View Switcher: Phase 8 24/7 Forward vs Interactive */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#1b273b] mb-4">
        <div className="flex items-center gap-3">
          <button
            id="paper-back-btn"
            onClick={onBackToCommandCenter}
            className="p-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300 transition-colors"
            title="Return to Command Center"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <button
              id="switch-forward-paper-btn"
              onClick={() => setViewMode('forward_paper')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                viewMode === 'forward_paper'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 shadow-sm'
                  : 'bg-[#0f1725] text-slate-400 hover:text-slate-200 border border-[#233550]'
              }`}
            >
              PHASE 8: 24/7 FORWARD PAPER VALIDATION
            </button>
            <button
              id="switch-interactive-lab-btn"
              onClick={() => setViewMode('interactive_lab')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                viewMode === 'interactive_lab'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 shadow-sm'
                  : 'bg-[#0f1725] text-slate-400 hover:text-slate-200 border border-[#233550]'
              }`}
            >
              INTERACTIVE RISK LAB
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'forward_paper' ? (
        <ForwardPaperDashboard />
      ) : (
        <>
          {/* 1. HEADER: EXPLICIT SAFETY DISCLAIMER & CONTROLS (Section 20) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1b273b] mb-4">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    PAPER TRADING ENGINE
                  </h2>
                  {/* MANDATORY SIMULATION BADGE (Section 20) */}
                  <span className="px-2 py-0.5 bg-amber-950/70 border border-amber-600 text-amber-300 font-bold text-[10px] tracking-wide animate-pulse">
                    PAPER MODE — SIMULATION ONLY
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                  <span>NO BROKER CONNECTED</span>
                  <span>•</span>
                  <span>NO REAL ORDERS</span>
                  <span>•</span>
                  <span className="text-slate-500">Source: Existing Twelve Data Request Manager</span>
                </p>
              </div>
            </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Scan for Candidates button (Phase 4A Risk Evaluation only) */}
          <button
            id="paper-scan-btn"
            onClick={handleScanForCandidates}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0c1829] hover:bg-[#132742] border border-[#1b3b66] text-cyan-300 font-semibold transition-colors disabled:opacity-50"
            title="Scan market to evaluate candidate risk eligibility"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'EVALUATING RISK...' : 'SCAN & EVALUATE RISK'}</span>
          </button>

          {/* Risk Settings */}
          <button
            id="paper-settings-btn"
            onClick={openSettingsModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300 transition-colors"
            title="Configure Risk Controls & Friction"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-400" />
            <span>RISK &amp; FRICTION CONFIG</span>
          </button>

          {/* Reset Account */}
          <button
            id="paper-reset-btn"
            onClick={() => setIsResetConfirmOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1f1315] hover:bg-[#2c181b] border border-[#522329] text-rose-300 transition-colors"
            title="Reset Paper Account to $1,000,000"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>RESET</span>
          </button>

          {/* Phase 4A Explicit Enable / Disable Controls */}
          {account.isTradingEnabled ? (
            <button
              id="paper-disable-trading-btn"
              onClick={toggleTradingEnabled}
              className="flex items-center gap-2 px-3 py-1.5 font-bold uppercase tracking-wider text-xs border border-emerald-500 bg-emerald-950/80 text-emerald-300 hover:bg-emerald-900/80 transition-colors"
              title="Disable Paper Trading"
            >
              <Pause className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
              <span>PAPER TRADING: ENABLED (CLICK TO DISABLE)</span>
            </button>
          ) : (
            <button
              id="paper-enable-trading-btn"
              onClick={toggleTradingEnabled}
              className="flex items-center gap-2 px-3 py-1.5 font-bold uppercase tracking-wider text-xs border border-[#293d5c] bg-[#151d2d] text-slate-200 hover:bg-[#1c273c] hover:border-cyan-500 hover:text-cyan-300 transition-colors"
              title="Enable Paper Trading"
            >
              <Play className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400" />
              <span>ENABLE PAPER TRADING</span>
            </button>
          )}
        </div>
      </div>

      {/* Account State Indicator Pill */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 p-2 bg-[#090d17] border border-[#162133] text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 uppercase text-[10px]">Account State:</span>
          {account.state === 'RISK_BLOCKED' ? (
            <span className="px-2 py-0.5 bg-rose-950 border border-rose-600 text-rose-300 font-bold text-[11px]">
              RISK_BLOCKED ({account.riskBlockReason || 'LIMIT_EXCEEDED'})
            </span>
          ) : account.paperTradingEnabled || account.isTradingEnabled ? (
            <span className="px-2 py-0.5 bg-emerald-950 border border-emerald-600 text-emerald-300 font-bold text-[11px]">
              PAPER_ENABLED
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 text-slate-400 font-bold text-[11px]">
              PAPER_DISABLED (DEFAULT)
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-400">
          Account ID: <span className="text-slate-200 font-bold">{account.accountId || 'PAPER-ACT-001'}</span>
          <span className="mx-2">•</span>
          Mode: <span className="text-amber-400 font-bold">PAPER ONLY (NO BROKER)</span>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div 
          id="paper-action-banner"
          className={`p-2.5 mb-3 border text-xs flex items-center justify-between transition-all ${
            actionMessage.type === 'success' 
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              : actionMessage.type === 'error'
              ? 'bg-rose-950/60 border-rose-800 text-rose-200'
              : 'bg-cyan-950/60 border-cyan-800 text-cyan-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : actionMessage.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button 
            onClick={() => setActionMessage(null)}
            className="text-[10px] uppercase opacity-70 hover:opacity-100"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Circuit Breaker Alert Banner */}
      {account.circuitBreakerTripped && (
        <div id="paper-circuit-breaker-banner" className="p-3 mb-4 bg-rose-950/90 border border-rose-600 text-rose-200 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 animate-bounce" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider">
              CIRCUIT BREAKER TRIPPED — PAPER TRADING HALTED
            </div>
            <div className="text-[11px] text-rose-300">
              Reason: {account.circuitBreakerReason}. No new paper orders will be created until risk limits are cleared or reset.
            </div>
          </div>
        </div>
      )}

      {/* 2. ACCOUNT OVERVIEW CARDS (Section 6: UI) */}
      <div id="paper-account-cards" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4 text-xs">
        {/* Virtual Equity */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Virtual Equity</span>
          <div className={`text-sm font-bold mt-0.5 ${
            account.currentEquity >= account.initialCapital ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            ${account.currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[9px] text-slate-500">
            Initial: ${account.initialCapital.toLocaleString()}
          </span>
        </div>

        {/* Available Balance */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Available Balance</span>
          <div className="text-sm font-bold text-slate-200 mt-0.5">
            ${account.availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[9px] text-slate-500">Cash Equivalent</span>
        </div>

        {/* Realized P&L */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Realized P&amp;L</span>
          <div className={`text-sm font-bold mt-0.5 ${
            account.realizedPnL > 0 ? 'text-emerald-400' : account.realizedPnL < 0 ? 'text-rose-400' : 'text-slate-400'
          }`}>
            {account.realizedPnL >= 0 ? '+' : ''}${account.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[9px] text-slate-500">
            {account.totalTrades} Trades ({account.winningTrades}W / {account.losingTrades}L)
          </span>
        </div>

        {/* Unrealized P&L */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Unrealized P&amp;L</span>
          <div className={`text-sm font-bold mt-0.5 ${
            account.unrealizedPnL > 0 ? 'text-emerald-400' : account.unrealizedPnL < 0 ? 'text-rose-400' : 'text-slate-400'
          }`}>
            {account.unrealizedPnL >= 0 ? '+' : ''}${account.unrealizedPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[9px] text-slate-500">{positions.length} Open Positions</span>
        </div>

        {/* Daily P&L */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Daily P&amp;L</span>
          <div className={`text-sm font-bold mt-0.5 ${
            account.dailyPnL > 0 ? 'text-emerald-400' : account.dailyPnL < 0 ? 'text-rose-400' : 'text-slate-200'
          }`}>
            {account.dailyPnL >= 0 ? '+' : ''}${account.dailyPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[9px] text-slate-500">
            Loss: {account.dailyLossPercent.toFixed(2)}% / {riskConfig.maxDailyLossPercent}% Cap
          </span>
        </div>

        {/* Drawdown */}
        <div className="p-2.5 bg-[#0b101b] border border-[#1b273b]">
          <span className="text-[10px] text-slate-500 uppercase block">Drawdown</span>
          <div className={`text-sm font-bold mt-0.5 ${
            account.drawdownPercent >= riskConfig.maxAccountDrawdownPercent ? 'text-rose-400' : 'text-slate-200'
          }`}>
            ${account.currentDrawdown.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({account.drawdownPercent.toFixed(2)}%)
          </div>
          <span className="text-[9px] text-slate-500">Max Limit: {riskConfig.maxAccountDrawdownPercent}%</span>
        </div>
      </div>

      {/* 3. RISK CONTROLS & STATUS BAR (Section 6 & 15: RISK) */}
      <div id="paper-risk-bar" className="p-3 bg-[#0a0f1a] border border-[#18263a] mb-4 text-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Risk / Trade:</span>
            <span className="text-cyan-300 font-bold">{riskConfig.riskPerTradePercent.toFixed(1)}%</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Max Daily Loss:</span>
            <span className="text-slate-200 font-bold">{riskConfig.maxDailyLossPercent.toFixed(1)}%</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Max Drawdown:</span>
            <span className="text-slate-200 font-bold">{riskConfig.maxAccountDrawdownPercent.toFixed(1)}%</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Minimum R:R:</span>
            <span className="text-slate-200 font-bold">{riskConfig.minRiskReward.toFixed(1)}:1</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Open Position Limit:</span>
            <span className="text-slate-200 font-bold">
              {positions.length} / {riskConfig.maxOpenPositions}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {/* Position Sizing Rule Note (Section 4) */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#121927] border border-[#1f2f48] text-slate-400">
            <span>Position Sizing:</span>
            <span className="text-amber-400 font-bold">VERIFIED SPEC REQUIRED</span>
            <span className="text-slate-600 text-[10px]">(No Fabricated Sizes)</span>
          </div>

          {/* Contract Spec notice */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#121927] border border-[#1f2f48] text-slate-400">
            <span>XAU/USD Spec:</span>
            <span className={riskConfig.contractSpecifications['XAU/USD'] ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
              {riskConfig.contractSpecifications['XAU/USD'] ? `${riskConfig.contractSpecifications['XAU/USD']} oz` : 'NOT AVAILABLE'}
            </span>
          </div>
        </div>
      </div>

      {/* 3b. EXECUTION FRICTION & SIMULATION INTEGRITY BAR (Phase 4B Requirement 4) */}
      <div id="paper-friction-bar" className="p-3 bg-[#080d16] border border-[#162133] mb-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#141d2c]">
          <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            EXECUTION FRICTION &amp; SIMULATION PARAMETERS
          </span>
          <span className="text-[10px] text-slate-400">
            Source: <strong className="text-slate-300">USER CONFIGURED SIMULATION PARAMETER</strong> (NO ASSUMED BROKER VALUES)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* Commission status */}
          <div className="p-2 bg-[#05080e] border border-[#172338] flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Commission</span>
              <div className="font-bold text-xs mt-0.5">
                {riskConfig.commissionDisabled ? (
                  <span className="text-emerald-400">Commission: OFF</span>
                ) : riskConfig.commissionPerLot !== null && riskConfig.commissionPerLot !== undefined && riskConfig.commissionPerLot >= 0 ? (
                  <span className="text-cyan-300">
                    ${riskConfig.commissionPerLot.toFixed(2)} / lot <span className="text-[10px] text-slate-400 font-normal">(Simulation Parameter)</span>
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold">Commission: NOT CONFIGURED</span>
                )}
              </div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${
              riskConfig.commissionDisabled 
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : riskConfig.commissionPerLot !== null && riskConfig.commissionPerLot !== undefined && riskConfig.commissionPerLot >= 0
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
            }`}>
              {riskConfig.commissionDisabled ? 'OFF' : riskConfig.commissionPerLot !== null && riskConfig.commissionPerLot !== undefined && riskConfig.commissionPerLot >= 0 ? 'CONFIGURED' : 'BLOCKED'}
            </span>
          </div>

          {/* Spread status */}
          <div className="p-2 bg-[#05080e] border border-[#172338] flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Spread Markup</span>
              <div className="font-bold text-xs mt-0.5">
                {riskConfig.spreadDisabled ? (
                  <span className="text-emerald-400">Spread: OFF</span>
                ) : riskConfig.spreadMarkupPips !== null && riskConfig.spreadMarkupPips !== undefined && riskConfig.spreadMarkupPips >= 0 ? (
                  <span className="text-cyan-300">
                    {riskConfig.spreadMarkupPips} pips <span className="text-[10px] text-slate-400 font-normal">(Simulation Parameter)</span>
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold">Spread: NOT CONFIGURED</span>
                )}
              </div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${
              riskConfig.spreadDisabled 
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : riskConfig.spreadMarkupPips !== null && riskConfig.spreadMarkupPips !== undefined && riskConfig.spreadMarkupPips >= 0
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
            }`}>
              {riskConfig.spreadDisabled ? 'OFF' : riskConfig.spreadMarkupPips !== null && riskConfig.spreadMarkupPips !== undefined && riskConfig.spreadMarkupPips >= 0 ? 'CONFIGURED' : 'BLOCKED'}
            </span>
          </div>

          {/* Slippage status */}
          <div className="p-2 bg-[#05080e] border border-[#172338] flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Market Slippage</span>
              <div className="font-bold text-xs mt-0.5">
                {riskConfig.slippageDisabled ? (
                  <span className="text-emerald-400">Slippage: OFF</span>
                ) : riskConfig.slippagePips !== null && riskConfig.slippagePips !== undefined && riskConfig.slippagePips >= 0 ? (
                  <span className="text-cyan-300">
                    {riskConfig.slippagePips} pips <span className="text-[10px] text-slate-400 font-normal">(Simulation Parameter)</span>
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold">Slippage: NOT CONFIGURED</span>
                )}
              </div>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${
              riskConfig.slippageDisabled 
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : riskConfig.slippagePips !== null && riskConfig.slippagePips !== undefined && riskConfig.slippagePips >= 0
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
            }`}>
              {riskConfig.slippageDisabled ? 'OFF' : riskConfig.slippagePips !== null && riskConfig.slippagePips !== undefined && riskConfig.slippagePips >= 0 ? 'CONFIGURED' : 'BLOCKED'}
            </span>
          </div>
        </div>

        {/* Warning if any unconfigured */}
        {((!riskConfig.commissionDisabled && (riskConfig.commissionPerLot === null || riskConfig.commissionPerLot === undefined || isNaN(riskConfig.commissionPerLot))) ||
          (!riskConfig.spreadDisabled && (riskConfig.spreadMarkupPips === null || riskConfig.spreadMarkupPips === undefined || isNaN(riskConfig.spreadMarkupPips))) ||
          (!riskConfig.slippageDisabled && (riskConfig.slippagePips === null || riskConfig.slippagePips === undefined || isNaN(riskConfig.slippagePips)))) && (
          <div className="mt-2.5 p-2 bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>SIMULATION FRICTION INCOMPLETE:</strong> Orders will be blocked from execution until Commission, Spread, and Slippage are configured or explicitly selected OFF.
              </span>
            </div>
            <button
              onClick={openSettingsModal}
              className="px-2.5 py-1 bg-rose-900/80 hover:bg-rose-800 border border-rose-600 text-white font-bold text-[10px] uppercase tracking-wider shrink-0"
            >
              CONFIGURE NOW
            </button>
          </div>
        )}
      </div>

      {/* 4. OPEN POSITIONS TABLE (Section 15: OPEN POSITIONS) */}
      <div id="paper-positions-section" className="bg-[#0b101b] border border-[#1b273b] p-3 mb-4">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#172338]">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              OPEN PAPER POSITIONS ({positions.length})
            </h3>
          </div>
          <span className="text-[10px] text-slate-500">Monitored via Verified Quotes &amp; Candles</span>
        </div>

        {positions.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center text-slate-500">
            <Layers className="w-6 h-6 text-slate-600 mb-1.5" />
            <span className="text-xs uppercase tracking-wider">NO OPEN PAPER POSITIONS</span>
            <p className="text-[11px] text-slate-600 mt-0.5 max-w-sm">
              Paper orders are only created from verified VALIDATED_CANDIDATE setups when Paper Trading is enabled.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-slate-400 uppercase bg-[#080d16] border-b border-[#172338]">
                <tr>
                  <th className="py-2 px-2.5">Symbol</th>
                  <th className="py-2 px-2">Direction</th>
                  <th className="py-2 px-2">Setup Family</th>
                  <th className="py-2 px-2">Entry</th>
                  <th className="py-2 px-2">Current</th>
                  <th className="py-2 px-2">SL</th>
                  <th className="py-2 px-2">TP</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">Risk ($)</th>
                  <th className="py-2 px-2">Unrealized P&amp;L</th>
                  <th className="py-2 px-2">R Multiple</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#131d2d]">
                {positions.map((pos, idx) => {
                  const isLong = pos.direction === 'LONG';
                  const isProfitable = pos.unrealizedPnL > 0;
                  const isLosing = pos.unrealizedPnL < 0;

                  return (
                    <tr key={`${pos.positionId}-${idx}`} className="hover:bg-[#0f1725] transition-colors">
                      <td className="py-2.5 px-2.5 font-bold text-slate-100">{pos.symbol}</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-1.5 py-0.5 border text-[10px] font-bold ${
                          isLong 
                            ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300' 
                            : 'bg-rose-950/60 border-rose-600 text-rose-300'
                        }`}>
                          {pos.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-[11px] text-slate-400">{pos.setupFamily}</td>
                      <td className="py-2.5 px-2 text-slate-200">{pos.entryPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-2 font-bold text-cyan-300">{pos.currentPrice.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-rose-400">{pos.stopLoss.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-emerald-400">{pos.takeProfit.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-slate-300">{pos.positionSizeDisplay}</td>
                      <td className="py-2.5 px-2 text-slate-300">${pos.initialRisk.toFixed(2)}</td>
                      <td className={`py-2.5 px-2 font-bold ${
                        isProfitable ? 'text-emerald-400' : isLosing ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {pos.unrealizedPnL >= 0 ? '+' : ''}${pos.unrealizedPnL.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-2 font-bold ${
                        pos.unrealizedRMultiple > 0 ? 'text-emerald-400' : pos.unrealizedRMultiple < 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {pos.unrealizedRMultiple > 0 ? `+${pos.unrealizedRMultiple.toFixed(2)}R` : `${pos.unrealizedRMultiple.toFixed(2)}R`}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="px-1.5 py-0.5 bg-cyan-950/60 border border-cyan-700 text-cyan-300 text-[9px] uppercase font-semibold">
                          {pos.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Section 4B: Partial Exit / Scale Out */}
                          <button
                            id={`paper-partial-tp-btn-${pos.positionId}`}
                            onClick={() => handlePartialClose(pos.positionId)}
                            className="px-2 py-1 bg-[#101b2b] hover:bg-[#192b45] border border-cyan-800 text-cyan-300 text-[10px] font-bold uppercase transition-colors"
                            title="Scale out 50% partial take profit at current market rate"
                          >
                            50% TP
                          </button>
                          {/* Section 20: No "SELL" or "CLOSE REAL" -> Use "PAPER CLOSE" */}
                          <button
                            id={`paper-close-btn-${pos.positionId}`}
                            onClick={() => handlePaperClose(pos.positionId)}
                            className="px-2 py-1 bg-[#1c1417] hover:bg-[#2b181c] border border-rose-800 text-rose-300 text-[10px] font-bold uppercase transition-colors"
                            title="Close position in simulation at current market rate"
                          >
                            PAPER CLOSE
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PENDING ORDERS TABLE */}
      {pendingOrders.length > 0 && (
        <div id="paper-pending-orders-section" className="bg-[#0b101b] border border-[#1b273b] p-3 mb-4">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#172338]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                PENDING PAPER ORDERS ({pendingOrders.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500">Waiting for verified entry condition</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-slate-400 uppercase bg-[#080d16] border-b border-[#172338]">
                <tr>
                  <th className="py-2 px-2.5">Order ID</th>
                  <th className="py-2 px-2">Symbol</th>
                  <th className="py-2 px-2">Direction</th>
                  <th className="py-2 px-2">Target Entry</th>
                  <th className="py-2 px-2">SL</th>
                  <th className="py-2 px-2">TP</th>
                  <th className="py-2 px-2">Planned R:R</th>
                  <th className="py-2 px-2">Size</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#131d2d]">
                {pendingOrders.map((ord, idx) => (
                  <tr key={`${ord.paperOrderId}-${idx}`} className="hover:bg-[#0f1725] transition-colors">
                    <td className="py-2 px-2.5 font-mono text-[11px] text-slate-400">{ord.paperOrderId}</td>
                    <td className="py-2 px-2 font-bold text-slate-100">{ord.symbol}</td>
                    <td className="py-2 px-2">
                      <span className={`px-1.5 py-0.5 border text-[10px] font-bold ${
                        ord.direction === 'LONG' 
                          ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300' 
                          : 'bg-rose-950/60 border-rose-600 text-rose-300'
                      }`}>
                        {ord.direction}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-slate-200">{ord.plannedEntryPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-rose-400">{ord.stopLoss.toFixed(2)}</td>
                    <td className="py-2 px-2 text-emerald-400">{ord.takeProfit.toFixed(2)}</td>
                    <td className="py-2 px-2 text-slate-300">{ord.plannedRR.toFixed(2)}:1</td>
                    <td className="py-2 px-2 text-slate-300">{ord.positionSizeDisplay}</td>
                    <td className="py-2 px-2">
                      <span className="px-1.5 py-0.5 bg-amber-950/60 border border-amber-700 text-amber-300 text-[9px] uppercase font-semibold">
                        PENDING
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => handleCancelOrder(ord.paperOrderId)}
                        className="px-2 py-0.5 bg-[#171c26] hover:bg-[#222a3a] border border-[#2b3a50] text-slate-300 text-[10px] uppercase font-semibold"
                      >
                        CANCEL
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. CLOSED TRADES SUMMARY (Section 15: CLOSED TRADES) */}
      <div id="paper-closed-trades-section" className="bg-[#0b101b] border border-[#1b273b] p-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#172338]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              CLOSED PAPER TRADES ({closedTrades.length})
            </h3>
          </div>
          {onNavigateToJournal && (
            <button
              onClick={onNavigateToJournal}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
            >
              <span>VIEW FULL JOURNAL</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {closedTrades.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center text-slate-500">
            <Activity className="w-6 h-6 text-slate-600 mb-1.5" />
            <span className="text-xs uppercase tracking-wider">NO CLOSED PAPER TRADES</span>
            <p className="text-[11px] text-slate-600 mt-0.5 max-w-sm">
              Completed trades will be permanently recorded in the immutable Trade Journal with three-tier evidence provenance.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-slate-400 uppercase bg-[#080d16] border-b border-[#172338]">
                <tr>
                  <th className="py-2 px-2.5">Closed Date</th>
                  <th className="py-2 px-2">Symbol</th>
                  <th className="py-2 px-2">Direction</th>
                  <th className="py-2 px-2">Setup Family</th>
                  <th className="py-2 px-2">Entry</th>
                  <th className="py-2 px-2">Exit</th>
                  <th className="py-2 px-2">SL</th>
                  <th className="py-2 px-2">TP</th>
                  <th className="py-2 px-2">R:R</th>
                  <th className="py-2 px-2">P&amp;L ($)</th>
                  <th className="py-2 px-2">R Multiple</th>
                  <th className="py-2 px-2">Close Reason</th>
                  <th className="py-2 px-2 text-right">Setup ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#131d2d]">
                {closedTrades.map((trade, idx) => {
                  const isWin = trade.realizedPnL > 0;
                  const isLoss = trade.realizedPnL < 0;

                  return (
                    <tr key={`${trade.journalId || trade.tradeId || 'trade'}-${idx}`} className="hover:bg-[#0f1725] transition-colors">
                      <td className="py-2 px-2.5 text-[11px] text-slate-400 font-mono">
                        {new Date(trade.closedAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-2 font-bold text-slate-100">{trade.symbol}</td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 border text-[10px] font-bold ${
                          trade.direction === 'LONG' 
                            ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300' 
                            : 'bg-rose-950/60 border-rose-600 text-rose-300'
                        }`}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-[11px] text-slate-400">{trade.setupFamily}</td>
                      <td className="py-2 px-2 text-slate-300">{trade.entryPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-slate-100 font-bold">{trade.exitPrice.toFixed(2)}</td>
                      <td className="py-2 px-2 text-rose-400">{trade.stopLoss.toFixed(2)}</td>
                      <td className="py-2 px-2 text-emerald-400">{trade.takeProfit.toFixed(2)}</td>
                      <td className="py-2 px-2 text-slate-300">{trade.plannedRR.toFixed(2)}:1</td>
                      <td className={`py-2 px-2 font-bold ${
                        isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {trade.realizedPnL >= 0 ? '+' : ''}${trade.realizedPnL.toFixed(2)}
                      </td>
                      <td className={`py-2 px-2 font-bold ${
                        trade.rMultiple > 0 ? 'text-emerald-400' : trade.rMultiple < 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}>
                        {trade.rMultipleDisplay}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 border text-[9px] uppercase font-semibold ${
                          trade.closeReason === 'TAKE_PROFIT'
                            ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                            : trade.closeReason === 'STOP_LOSS'
                            ? 'bg-rose-950/60 border-rose-700 text-rose-300'
                            : 'bg-[#182333] border-[#293d5c] text-slate-300'
                        }`}>
                          {trade.closeReason.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[10px] text-slate-500">
                        {trade.setupId.substring(0, 16)}...
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. RISK SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0b101b] border border-[#233550] w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1b273b]">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold uppercase text-slate-100">Paper Risk Settings</h3>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Risk per trade */}
              <div className="flex items-center justify-between">
                <label className="text-slate-400">Risk per Trade (% of Equity):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={tempRiskPercent}
                  onChange={(e) => setTempRiskPercent(e.target.value)}
                  className="w-28 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right"
                />
              </div>

              {/* Max Open Positions */}
              <div className="flex items-center justify-between">
                <label className="text-slate-400">Maximum Open Positions:</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="10"
                  value={tempMaxPositions}
                  onChange={(e) => setTempMaxPositions(e.target.value)}
                  className="w-28 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right"
                />
              </div>

              {/* Minimum R:R */}
              <div className="flex items-center justify-between">
                <label className="text-slate-400">Minimum Risk:Reward Ratio:</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="10"
                  value={tempMinRR}
                  onChange={(e) => setTempMinRR(e.target.value)}
                  className="w-28 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right"
                />
              </div>

              {/* Max Daily Loss */}
              <div className="flex items-center justify-between">
                <label className="text-slate-400">Daily Loss Limit (% Circuit Breaker):</label>
                <input
                  type="number"
                  step="0.5"
                  min="1.0"
                  max="20"
                  value={tempMaxDailyLoss}
                  onChange={(e) => setTempMaxDailyLoss(e.target.value)}
                  className="w-28 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right"
                />
              </div>

              {/* Max Account Drawdown */}
              <div className="flex items-center justify-between">
                <label className="text-slate-400">Max Account Drawdown (% Circuit Breaker):</label>
                <input
                  type="number"
                  step="0.5"
                  min="2.0"
                  max="50"
                  value={tempMaxDrawdown}
                  onChange={(e) => setTempMaxDrawdown(e.target.value)}
                  className="w-28 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right"
                />
              </div>

              {/* Contract Spec Enforcement */}
              <div className="pt-2 border-t border-[#172338]">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-slate-400">Require Verified Contract Specification:</label>
                  <input
                    type="checkbox"
                    checked={tempRequireContractSpec}
                    onChange={(e) => setTempRequireContractSpec(e.target.checked)}
                    className="h-4 w-4 bg-[#060a12] border border-[#1b273b]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">XAU/USD Specification (oz / contract):</span>
                  <input
                    type="number"
                    step="1"
                    placeholder="Unset (Not Available)"
                    value={tempXauSpec}
                    onChange={(e) => setTempXauSpec(e.target.value)}
                    className="w-40 px-2 py-1 bg-[#060a12] border border-[#1b273b] text-slate-100 text-right text-xs"
                  />
                </div>
              </div>

              {/* Friction & Simulation Parameters (Phase 4B Execution Integrity) */}
              <div className="pt-3 border-t border-[#172338] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">
                    SIMULATION FRICTION (NO HIDDEN ASSUMPTIONS)
                  </span>
                  <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 border border-amber-800">
                    Explicit Settings Only
                  </span>
                </div>

                {/* 1. Commission */}
                <div className="p-2.5 bg-[#060a12] border border-[#172338] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold">Commission:</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="commissionMode"
                          checked={tempCommissionDisabled}
                          onChange={() => setTempCommissionDisabled(true)}
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <span>OFF ($0.00)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="commissionMode"
                          checked={!tempCommissionDisabled}
                          onChange={() => setTempCommissionDisabled(false)}
                          className="h-3.5 w-3.5 accent-cyan-500"
                        />
                        <span>Sim Parameter</span>
                      </label>
                    </div>
                  </div>
                  {!tempCommissionDisabled && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400">Rate ($ / standard lot):</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        placeholder="e.g. 3.50 (USD/lot)"
                        value={tempCommissionPerLot}
                        onChange={(e) => setTempCommissionPerLot(e.target.value)}
                        className="w-36 px-2 py-1 bg-[#090d16] border border-[#1b273b] text-slate-100 text-right text-xs"
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">
                    Source: USER CONFIGURED SIMULATION PARAMETER. Never presented as verified broker commission.
                  </p>
                </div>

                {/* 2. Spread */}
                <div className="p-2.5 bg-[#060a12] border border-[#172338] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold">Spread Markup:</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="spreadMode"
                          checked={tempSpreadDisabled}
                          onChange={() => setTempSpreadDisabled(true)}
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <span>OFF (0.0 pips)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="spreadMode"
                          checked={!tempSpreadDisabled}
                          onChange={() => setTempSpreadDisabled(false)}
                          className="h-3.5 w-3.5 accent-cyan-500"
                        />
                        <span>Sim Parameter</span>
                      </label>
                    </div>
                  </div>
                  {!tempSpreadDisabled && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400">Markup (pips):</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="e.g. 1.2 pips"
                        value={tempSpreadMarkupPips}
                        onChange={(e) => setTempSpreadMarkupPips(e.target.value)}
                        className="w-36 px-2 py-1 bg-[#090d16] border border-[#1b273b] text-slate-100 text-right text-xs"
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">
                    Source: USER CONFIGURED SIMULATION PARAMETER. Applied when live quote lacks bid/ask spread.
                  </p>
                </div>

                {/* 3. Slippage */}
                <div className="p-2.5 bg-[#060a12] border border-[#172338] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold">Market Slippage:</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="slippageMode"
                          checked={tempSlippageDisabled}
                          onChange={() => setTempSlippageDisabled(true)}
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <span>OFF (0.0 pips)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                        <input
                          type="radio"
                          name="slippageMode"
                          checked={!tempSlippageDisabled}
                          onChange={() => setTempSlippageDisabled(false)}
                          className="h-3.5 w-3.5 accent-cyan-500"
                        />
                        <span>Sim Parameter</span>
                      </label>
                    </div>
                  </div>
                  {!tempSlippageDisabled && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-400">Adverse Slippage (pips):</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="e.g. 0.5 pips"
                        value={tempSlippagePips}
                        onChange={(e) => setTempSlippagePips(e.target.value)}
                        className="w-36 px-2 py-1 bg-[#090d16] border border-[#1b273b] text-slate-100 text-right text-xs"
                      />
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">
                    Source: USER CONFIGURED SIMULATION PARAMETER. Adverse slippage on market orders (0 on limit touches).
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1b273b]">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-3 py-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300 text-xs"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-200 text-xs font-bold uppercase"
              >
                SAVE RISK &amp; FRICTION CONFIG
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* 8. RESET CONFIRMATION MODAL */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0b101b] border border-rose-800 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Reset Paper Account &amp; Journal</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will reset your paper trading account balance to <strong>$1,000,000.00 USD</strong>, close any active simulation positions, and clear all simulated trade journal entries.
            </p>
            <p className="text-[11px] text-slate-500">
              This action is strictly within local paper simulation storage and will not affect market feeds or scanner logs.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3 py-1.5 bg-[#0f1725] border border-[#233550] text-slate-300 text-xs"
              >
                CANCEL
              </button>
              <button
                onClick={handleConfirmReset}
                className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-700 text-rose-200 text-xs font-bold uppercase"
              >
                CONFIRM RESET
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
