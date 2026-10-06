import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Clock, 
  ShieldCheck, 
  Layers, 
  AlertCircle,
  DatabaseZap,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { ConnectionStatus, MarketDataStatus } from '../types/terminal';
import { RateLimitBudgetTelemetry } from '../market-data/twelve-data-provider';
import { formatSystemClock } from '../utils/formatters';

interface TopBarProps {
  providerName?: string;
  connectionStatus: ConnectionStatus;
  marketDataStatus: MarketDataStatus;
  currentSession: string;
  lastUpdated?: string | null;
  nextUpdateSeconds?: number;
  isPolling?: boolean;
  onRefresh?: () => void;
  rateLimitTelemetry?: RateLimitBudgetTelemetry;
}

export const TopBar: React.FC<TopBarProps> = ({
  providerName = 'Twelve Data',
  connectionStatus,
  marketDataStatus,
  currentSession,
  lastUpdated,
  nextUpdateSeconds,
  isPolling = false,
  onRefresh,
  rateLimitTelemetry,
}) => {
  const [clock, setClock] = useState(() => formatSystemClock(new Date()));

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(formatSystemClock(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Connection status color and context helper (Requirement 9)
  const getConnectionBadge = () => {
    switch (connectionStatus) {
      case 'CONNECTED':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
          containerClass: 'bg-[#0f1d19] border-[#1d4033] text-emerald-300',
          labelClass: 'text-emerald-500/80',
          valueClass: 'text-emerald-400 font-bold',
          contextNote: null,
        };
      case 'RATE LIMITED':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
          containerClass: 'bg-[#22180b] border-[#5a3a14] text-amber-300',
          labelClass: 'text-amber-500/80',
          valueClass: 'text-amber-400 font-bold',
          contextNote: 'Cached verified data available',
        };
      case 'STALE':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
          containerClass: 'bg-[#1c1a24] border-[#4d3319] text-amber-300',
          labelClass: 'text-amber-500/80',
          valueClass: 'text-amber-300 font-bold',
          contextNote: 'Verified cache available • Freshness threshold exceeded',
        };
      case 'ERROR':
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
          containerClass: 'bg-[#201317] border-[#4d1f26] text-rose-300',
          labelClass: 'text-rose-500/80',
          valueClass: 'text-rose-400 font-bold',
          contextNote: 'Provider/server error',
        };
      case 'CONNECTING':
        return {
          icon: <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />,
          containerClass: 'bg-[#0f1726] border-[#1e304d] text-cyan-300',
          labelClass: 'text-cyan-500/80',
          valueClass: 'text-cyan-400 font-bold',
          contextNote: 'Connecting to provider...',
        };
      case 'NOT CONNECTED':
      default:
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
          containerClass: 'bg-[#201317] border-[#4d1f26] text-rose-300',
          labelClass: 'text-rose-500/80',
          valueClass: 'text-rose-400 font-bold',
          contextNote: 'No verified connection established',
        };
    }
  };

  const connectionStyle = getConnectionBadge();

  const resetDisplay = (rateLimitTelemetry?.nextResetSeconds !== undefined && rateLimitTelemetry.nextResetSeconds > 0)
    ? `${rateLimitTelemetry.nextResetSeconds}s`
    : (rateLimitTelemetry?.isRateLimited ? 'RESET AVAILABLE' : '0s');

  return (
    <header 
      id="terminal-topbar"
      className="bg-[#0b0f19] border-b border-[#1b2537] px-4 py-2 flex flex-wrap items-center justify-between text-xs select-none gap-3 z-30"
    >
      {/* Brand & Terminal Identifier */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-amber-500 rounded-none transform rotate-45"></div>
          <h1 className="font-bold text-sm tracking-wider text-slate-100 uppercase">
            FOREX &amp; GOLD ROBO
          </h1>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-[#121927] border border-[#223147] text-[10px] text-slate-400 font-mono">
          <span className="text-cyan-400 font-semibold">TERMINAL</span>
          <span>PHASE 2</span>
        </div>
        <div className="hidden md:flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-500 font-mono">
          <span>PERSONAL RESEARCH &amp; PAPER TRADING</span>
        </div>
      </div>

      {/* Terminal Telemetry / Status Cluster (Requirement 9) */}
      <div className="flex items-center gap-2 sm:gap-3 font-mono text-[11px] flex-wrap">
        
        {/* 1. PROVIDER: TWELVE DATA */}
        <div 
          id="status-data-provider"
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0f1726] border border-[#1e304d] text-slate-200"
        >
          <DatabaseZap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-slate-400 text-[10px] uppercase">PROVIDER:</span>
          <span className="font-bold text-cyan-300 tracking-wide">
            {providerName}
          </span>
        </div>

        {/* 2. CONNECTION: STATUS */}
        <div 
          id="status-connection"
          className={`flex items-center gap-1.5 px-2.5 py-1 border ${connectionStyle.containerClass}`}
          title={connectionStyle.contextNote || undefined}
        >
          {connectionStyle.icon}
          <span className={`${connectionStyle.labelClass} text-[10px] uppercase`}>CONNECTION:</span>
          <span className={`tracking-wide ${connectionStyle.valueClass}`}>
            {connectionStatus}
          </span>
          {connectionStyle.contextNote && (
            <span className="hidden 2xl:inline text-[9px] text-slate-400 border-l border-[#3a2a1b] pl-1.5 ml-0.5">
              {connectionStyle.contextNote}
            </span>
          )}
        </div>

        {/* 3. BUDGET / REMAINING / RESET CLUSTER */}
        <div 
          id="status-budget-telemetry"
          className="flex items-center gap-2 px-2.5 py-1 bg-[#101724] border border-[#1e2a3c] text-[10px] text-slate-300"
        >
          <span className="text-slate-500 uppercase">BUDGET:</span>
          <span className={`font-mono font-bold ${
            (rateLimitTelemetry?.requestsThisMinute ?? 0) >= 8 ? 'text-amber-400' : 'text-slate-200'
          }`}>
            {rateLimitTelemetry?.requestsThisMinute ?? 0}/8
          </span>
          
          <span className="text-slate-600">|</span>
          <span className="text-slate-500 uppercase">REMAINING:</span>
          <span className={`font-mono font-bold ${
            (rateLimitTelemetry?.remainingCredits ?? 8) === 0 ? 'text-rose-400' : 'text-emerald-400'
          }`}>
            {rateLimitTelemetry?.remainingCredits ?? 8}
          </span>

          <span className="text-slate-600">|</span>
          <span className="text-slate-500 uppercase">RESET:</span>
          <span className={`font-mono font-bold ${
            (rateLimitTelemetry?.nextResetSeconds ?? 0) > 0 ? 'text-amber-400' : (rateLimitTelemetry?.isRateLimited ? 'text-amber-300' : 'text-slate-300')
          }`}>
            {resetDisplay}
          </span>
        </div>

        {/* Refresh & Rate Limit Polling Telemetry */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[#101724] border border-[#1e2a3c] text-[10px] text-slate-400">
          <button
            id="btn-refresh-feed"
            onClick={onRefresh}
            disabled={isPolling}
            title="Manual feed poll (respects 30s cache/rate limit)"
            className="flex items-center gap-1 text-slate-300 hover:text-cyan-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isPolling ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
            <span>{isPolling ? 'FETCHING' : 'POLL'}</span>
          </button>
          {nextUpdateSeconds !== undefined && (
            <span className="text-slate-500 border-l border-[#1e2a3c] pl-1.5">
              T-{nextUpdateSeconds}s
            </span>
          )}
        </div>

        {/* Market Session */}
        <div 
          id="status-market-session"
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-[#131b29] border border-[#23334d] text-slate-300"
        >
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-500 text-[10px] uppercase">Session:</span>
          <span className="font-semibold text-slate-300">
            {currentSession}
          </span>
        </div>

        {/* Data Safety Mode Badge */}
        <div 
          id="safety-protocol-badge"
          className="hidden 2xl:flex items-center gap-1.5 px-2 py-1 bg-[#0f1d19] border border-[#1d4033] text-emerald-400 text-[10px]"
          title="Synthetic candle & price generation strictly suppressed."
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="tracking-wide">ZERO SYNTHETICS</span>
        </div>

        {/* Live System Clock */}
        <div 
          id="system-clock-display"
          className="flex items-center gap-2 px-2.5 py-1 bg-[#101724] border border-[#1e2a3c] text-slate-300 tabular-nums"
        >
          <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 leading-tight">
            <span className="font-bold text-slate-200">{clock.utcTime}</span>
            <span className="hidden xl:inline text-slate-500 text-[10px]">({clock.utcDate})</span>
          </div>
        </div>

      </div>
    </header>
  );
};

