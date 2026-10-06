import React from 'react';
import { Settings2, ArrowLeft, ShieldCheck, DatabaseZap, Lock, Cpu, KeyRound, ListFilter } from 'lucide-react';
import { ConnectionStatus, MarketDataStatus } from '../types/terminal';
import { 
  ACTIVE_INSTRUMENTS, 
  AVAILABLE_INSTRUMENTS, 
  INACTIVE_PRESERVED_INSTRUMENTS,
  INSTRUMENT_PRIORITY 
} from '../config/watchlist-config';

interface SettingsViewProps {
  connectionStatus: ConnectionStatus;
  marketDataStatus: MarketDataStatus;
  onBackToCommandCenter: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  connectionStatus,
  marketDataStatus,
  onBackToCommandCenter,
}) => {
  return (
    <div 
      id="settings-page"
      className="flex-1 flex flex-col bg-[#070b13] p-4 overflow-y-auto font-mono select-none"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1b273b] mb-4">
        <div className="flex items-center gap-3">
          <button
            id="settings-back-btn"
            onClick={onBackToCommandCenter}
            className="p-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300 cursor-pointer"
            title="Return to Command Center"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-cyan-400" />
              TERMINAL CONFIGURATION &amp; DATA FEEDS
            </h2>
            <p className="text-[11px] text-slate-500">
              Workstation environment parameters and Twelve Data API market integration.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-[#101b2c] border border-[#213757] text-cyan-300 font-semibold text-[10px] flex items-center gap-1.5">
            <DatabaseZap className="w-3 h-3 text-cyan-400" />
            PHASE 2: REAL MARKET DATA INTEGRATED
          </span>
        </div>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        {/* Section 1: Market Data Provider */}
        <div className="bg-[#0b101b] border border-[#1b273b] p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#162133]">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-xs">
              <DatabaseZap className="w-4 h-4 text-cyan-400" />
              <span>MARKET DATA PROVIDER (PHASE 2)</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-[#121f2d] border border-[#233f5d] text-cyan-300 font-semibold">
              ACTIVE
            </span>
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Active Provider:</span>
              <span className="text-cyan-300 font-semibold">Twelve Data API (Server-Side Proxy)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Feed Connection:</span>
              <span className="text-slate-200 font-semibold">{connectionStatus}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Data Validation:</span>
              <span className="text-slate-200 font-semibold">{marketDataStatus}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Other Brokers (Upstox, Angel, FYERS):</span>
              <span className="text-rose-400 font-semibold">Strictly Prohibited</span>
            </div>
          </div>
        </div>

        {/* Section 2: Data Safety & Enforcement */}
        <div className="bg-[#0b101b] border border-[#1b273b] p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#162133]">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-xs">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>DATA INTEGRITY PROTOCOL</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-[#0d1f19] border border-[#1b3d32] text-emerald-400 font-semibold">
              ENFORCED
            </span>
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Synthetic Candles:</span>
              <span className="text-emerald-400 font-semibold">PROHIBITED (BLOCKED)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Fake Prices / LTP:</span>
              <span className="text-emerald-400 font-semibold">PROHIBITED (BLOCKED)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Simulated Signals:</span>
              <span className="text-emerald-400 font-semibold">PROHIBITED (BLOCKED)</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Multi-User / Cloud SaaS:</span>
              <span className="text-slate-400">DISABLED (Single-User Local)</span>
            </div>
          </div>
        </div>

        {/* Section 3: API Key Security */}
        <div className="bg-[#0b101b] border border-[#1b273b] p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#162133]">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-xs">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span>API KEY SECURITY ARCHITECTURE</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-[#0f1d19] border border-[#1d4033] text-emerald-400 font-semibold">
              SECURE
            </span>
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Key Location:</span>
              <span className="text-emerald-400 font-semibold">Server-Side Environment Only</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#121927]">
              <span className="text-slate-500">Client Exposure:</span>
              <span className="text-emerald-400 font-semibold">NEVER Sent to Browser</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Proxy Endpoints:</span>
              <span className="text-slate-300 font-mono text-[11px]">/api/market-data/*</span>
            </div>
          </div>
        </div>

        {/* Section 4: Phase Status */}
        <div className="bg-[#0b101b] border border-[#1b273b] p-4 space-y-3 flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold text-slate-200 mb-1">SYSTEM PHASE STATUS</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Phase 2 Twelve Data market data integration active. Quotes are validated against 15-minute freshness and positive LTP constraints. Polling is throttled to 45s intervals with server-side in-flight deduplication.
            </p>
          </div>

          <div className="p-2 bg-[#0c1626] border border-[#1b3457] text-center text-xs text-cyan-300 font-semibold">
            PHASE 2 OPERATIONAL — REAL DATA ACTIVE
          </div>
        </div>

        {/* Section 5: Controlled Active Watchlist Configuration */}
        <div className="bg-[#0b101b] border border-[#1b273b] p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between pb-2 border-b border-[#162133]">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-xs">
              <ListFilter className="w-4 h-4 text-cyan-400" />
              <span>ACTIVE WATCHLIST CONFIGURATION (CENTRAL INVENTORY)</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-[#121f2d] border border-[#233f5d] text-cyan-300 font-semibold">
              {ACTIVE_INSTRUMENTS.length} ACTIVE / {AVAILABLE_INSTRUMENTS.length} TOTAL IN CATALOG
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Active instruments */}
            <div className="bg-[#070b13] border border-[#162133] p-3 space-y-2">
              <div className="text-[11px] font-bold text-emerald-400 flex items-center justify-between">
                <span>ACTIVE INSTRUMENTS (LIVE ROTATION)</span>
                <span className="text-[9px] px-1 bg-[#0d1f19] border border-[#1b3d32] text-emerald-400">
                  MONITORED
                </span>
              </div>
              <div className="space-y-1.5 pt-1">
                {ACTIVE_INSTRUMENTS.map((symbol) => (
                  <div key={symbol} className="flex items-center justify-between text-slate-300 py-1 border-b border-[#111827] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100">{symbol}</span>
                      <span className="text-[10px] text-slate-500">
                        {symbol === 'XAU/USD' ? 'Spot Gold' : 'Major Forex'}
                      </span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-xs font-mono font-bold bg-cyan-950/40 text-cyan-300 border border-cyan-800/50">
                      Priority {INSTRUMENT_PRIORITY[symbol] ?? 2}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Preserved / Standby instruments */}
            <div className="bg-[#070b13] border border-[#162133] p-3 space-y-2">
              <div className="text-[11px] font-bold text-amber-400 flex items-center justify-between">
                <span>PRESERVED INSTRUMENTS (AVAILABLE IN CODEBASE)</span>
                <span className="text-[9px] px-1 bg-[#231a0e] border border-[#483318] text-amber-400">
                  STANDBY
                </span>
              </div>
              <div className="space-y-1.5 pt-1">
                {INACTIVE_PRESERVED_INSTRUMENTS.map((symbol) => (
                  <div key={symbol} className="flex items-center justify-between text-slate-400 py-1 border-b border-[#111827] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-400">{symbol}</span>
                      <span className="text-[10px] text-slate-500">Major Forex</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-xs font-mono text-slate-500 bg-slate-900 border border-slate-800">
                      Standby (Configurable)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 italic pt-1">
            Note: Architecture is centrally configurable. Preserved instruments remain fully supported in the codebase and can be enabled anytime by appending to the central watchlist configuration without deleting provider support.
          </p>
        </div>
      </div>
    </div>
  );
};
