import React, { useState } from 'react';
import { 
  FileText, 
  Layers, 
  History, 
  Terminal, 
  ShieldCheck, 
  Database,
  Cpu,
  Radio,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { BottomTabType, ConnectionStatus, MarketDataStatus } from '../types/terminal';
import { ProviderTelemetry } from '../market-data/twelve-data-provider';

interface BottomPanelProps {
  connectionStatus: ConnectionStatus;
  marketDataStatus: MarketDataStatus;
  providerName?: string;
  telemetry?: ProviderTelemetry | null;
  onRefresh?: () => void;
}

export const BottomPanel: React.FC<BottomPanelProps> = ({
  connectionStatus,
  marketDataStatus,
  providerName = 'TWELVE DATA',
  telemetry = null,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<BottomTabType>('positions');

  return (
    <div 
      id="terminal-bottom-panel"
      className="bg-[#090e18] border-t border-[#1b263b] flex flex-col font-mono text-xs select-none min-h-[190px]"
    >
      {/* Tabs Navigation Bar */}
      <div className="bg-[#0b101b] border-b border-[#182338] px-3 flex items-center justify-between">
        <div className="flex items-center space-x-1">
          <button
            id="tab-btn-positions"
            onClick={() => setActiveTab('positions')}
            className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'positions'
                ? 'border-cyan-400 text-cyan-300 bg-[#121a2a]'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#0e1422]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Open Positions (0)</span>
          </button>

          <button
            id="tab-btn-orders"
            onClick={() => setActiveTab('orders')}
            className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'orders'
                ? 'border-cyan-400 text-cyan-300 bg-[#121a2a]'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#0e1422]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Paper Orders (0)</span>
          </button>

          <button
            id="tab-btn-history"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'border-cyan-400 text-cyan-300 bg-[#121a2a]'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#0e1422]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Trade History (0)</span>
          </button>

          <button
            id="tab-btn-system-status"
            onClick={() => setActiveTab('system_status')}
            className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'system_status'
                ? 'border-cyan-400 text-cyan-300 bg-[#121a2a]'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#0e1422]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>System Status</span>
            {telemetry?.error && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            )}
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[10px] text-slate-500">
          <span>PORTFOLIO EQUITY: <strong className="text-slate-400">$100,000.00 (PAPER)</strong></span>
          <span className="text-slate-700">|</span>
          <span>MARGIN UTIL: <strong className="text-slate-400">0.00%</strong></span>
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="p-3 flex-1 flex flex-col justify-center overflow-auto bg-[#070b13]">
        {/* 1. Open Positions */}
        {activeTab === 'positions' && (
          <div id="tab-content-positions" className="flex flex-col h-full">
            {/* Table Header Structure */}
            <div className="grid grid-cols-7 gap-2 px-3 py-1.5 bg-[#0e1524] border border-[#182338] text-[10px] text-slate-500 font-semibold uppercase">
              <span>Position ID</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Units / Lots</span>
              <span>Entry Price</span>
              <span>Current LTP</span>
              <span className="text-right">Unrealized P&amp;L</span>
            </div>

            {/* Empty State */}
            <div className="flex-1 flex flex-col items-center justify-center py-6 text-center text-slate-500 space-y-1">
              <span className="text-sm font-bold tracking-widest text-slate-400 uppercase">
                NO PAPER POSITIONS
              </span>
              <p className="text-[11px] text-slate-600 max-w-sm">
                No active exposure in memory. Positions will only be instantiated during manual paper testing or validated setups.
              </p>
            </div>
          </div>
        )}

        {/* 2. Paper Orders */}
        {activeTab === 'orders' && (
          <div id="tab-content-orders" className="flex flex-col h-full">
            <div className="grid grid-cols-7 gap-2 px-3 py-1.5 bg-[#0e1524] border border-[#182338] text-[10px] text-slate-500 font-semibold uppercase">
              <span>Order ID</span>
              <span>Symbol</span>
              <span>Order Type</span>
              <span>Limit / Stop</span>
              <span>Volume</span>
              <span>Time Placed</span>
              <span className="text-right">Status</span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center py-6 text-center text-slate-500 space-y-1">
              <span className="text-sm font-bold tracking-widest text-slate-400 uppercase">
                NO PAPER ORDERS
              </span>
              <p className="text-[11px] text-slate-600 max-w-sm">
                Order book queue is empty. Pending limit/stop orders will appear here during future execution phases.
              </p>
            </div>
          </div>
        )}

        {/* 3. Trade History */}
        {activeTab === 'history' && (
          <div id="tab-content-history" className="flex flex-col h-full">
            <div className="grid grid-cols-7 gap-2 px-3 py-1.5 bg-[#0e1524] border border-[#182338] text-[10px] text-slate-500 font-semibold uppercase">
              <span>Trade ID</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>P&amp;L ($)</span>
              <span className="text-right">Realized Return</span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center py-6 text-center text-slate-500 space-y-1">
              <span className="text-sm font-bold tracking-widest text-slate-400 uppercase">
                NO TRADE HISTORY
              </span>
              <p className="text-[11px] text-slate-600 max-w-sm">
                Zero simulated or fabricated transactions exist. All trade journal entries must stem from verified paper execution.
              </p>
            </div>
          </div>
        )}

        {/* 4. System Status */}
        {activeTab === 'system_status' && (
          <div id="tab-content-system-status" className="grid grid-cols-1 md:grid-cols-4 gap-3 p-1">
            {/* Box 1: MANDATORY PROVIDER & STATUS */}
            <div className="p-3 bg-[#0c121e] border border-[#19263b] space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[10px]">
                <span>DATA PROVIDER</span>
                <Radio className="w-3 h-3 text-cyan-400" />
              </div>
              <div className="text-xs font-bold text-cyan-300">
                {providerName.toUpperCase()}
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-slate-500">CONNECTION:</span>
                <span className={`font-bold ${
                  connectionStatus === 'CONNECTED'
                    ? 'text-emerald-400'
                    : (connectionStatus === 'RATE LIMITED' ? 'text-amber-400' : (connectionStatus === 'STALE' ? 'text-amber-300' : 'text-rose-400'))
                }`}>
                  {connectionStatus}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-slate-500">FEED:</span>
                <span className={`font-bold ${
                  marketDataStatus === 'LIVE' 
                    ? 'text-emerald-400' 
                    : (marketDataStatus === 'STALE' ? 'text-amber-400' : (marketDataStatus === 'RATE LIMITED' ? 'text-amber-400' : 'text-rose-400'))
                }`}>
                  {marketDataStatus === 'RATE LIMITED' ? 'RATE LIMITED — WAITING FOR RESET' : marketDataStatus}
                </span>
              </div>
              {telemetry?.error ? (
                <div className="text-[9px] text-amber-400/90 leading-tight pt-1 border-t border-[#182436]">
                  <span className="font-semibold text-slate-400">Technical Note: </span>
                  {telemetry.error}
                </div>
              ) : (
                <div className="text-[9px] text-slate-500">
                  Twelve Data server-side proxy feed active
                </div>
              )}
            </div>

            {/* Box 2: INTEGRITY PROTOCOL */}
            <div className="p-3 bg-[#0c121e] border border-[#19263b] space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[10px]">
                <span>INTEGRITY PROTOCOL</span>
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
              </div>
              <div className="text-xs font-bold text-emerald-300">
                STRICT ZERO-FAKE POLICY
              </div>
              <div className="text-[10px] text-slate-400 leading-relaxed">
                Feed: {telemetry?.liveInstrumentsCount ?? 0} Live / {telemetry?.staleInstrumentsCount ?? 0} Stale / {telemetry?.rateLimitedCount ?? 0} Rate Limited / {telemetry?.waitingCount ?? 0} Waiting / {telemetry?.unconnectedCount ?? 0} Not Connected
              </div>
              <div className="text-[9px] text-slate-500">
                All random numbers, mock candles &amp; fake prices blocked
              </div>
            </div>

            {/* Box 3: RATE-LIMIT & POLLING TELEMETRY (RULE 6) */}
            <div className="p-3 bg-[#0c121e] border border-[#19263b] space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[10px]">
                <span>TWELVE DATA RATE LIMIT</span>
                <RefreshCw className={`w-3 h-3 ${telemetry?.isPolling ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
              </div>
              <div className="text-xs font-bold text-slate-200 flex items-center justify-between">
                <span>Requests this minute:</span>
                <span className={telemetry?.rateLimit?.isRateLimited ? 'text-rose-400' : 'text-cyan-300'}>
                  {telemetry?.rateLimit?.requestsThisMinute ?? 0} / 8
                </span>
              </div>
              <div className="text-[10px] text-slate-300 flex items-center justify-between">
                <span>Remaining credits:</span>
                <strong className={telemetry?.rateLimit?.remainingCredits === 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {telemetry?.rateLimit?.remainingCredits ?? 8}
                </strong>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-0.5 border-t border-[#182338]">
                <span>Next reset:</span>
                <strong className="text-amber-400 font-mono">
                  {telemetry?.rateLimit?.nextResetSeconds !== undefined && telemetry.rateLimit.nextResetSeconds > 0 
                    ? `${telemetry.rateLimit.nextResetSeconds}s countdown` 
                    : (telemetry?.rateLimit?.isRateLimited ? 'RESET AVAILABLE' : 'Ready')}
                </strong>
              </div>
              {telemetry?.rateLimit?.isRateLimited && (
                <div className="text-[9px] font-bold text-amber-400 bg-amber-950/50 px-1.5 py-0.5 border border-amber-800">
                  RATE LIMITED — WAITING FOR RESET
                </div>
              )}
            </div>

            {/* Box 4: SECRETS / SERVER PROXY STATUS */}
            <div className="p-3 bg-[#0c121e] border border-[#19263b] space-y-1">
              <div className="flex items-center justify-between text-slate-500 text-[10px]">
                <span>API SECURITY</span>
                <Database className="w-3 h-3 text-cyan-400" />
              </div>
              <div className="text-xs font-bold text-slate-200">
                SERVER-SIDE ONLY
              </div>
              <div className="text-[10px] text-slate-400">
                API Key: <strong className="text-emerald-400">100% Hidden From Client</strong>
              </div>
              <div className="text-[9px] text-slate-500">
                {telemetry?.hasConfiguredKey ? 'Custom API key active' : 'Using verified demo connectivity'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

