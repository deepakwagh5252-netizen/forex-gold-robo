import React from 'react';
import { Globe2, Clock, ShieldCheck, MapPin } from 'lucide-react';
import { MarketSessionInfo } from '../types/terminal';

interface MarketSessionsPanelProps {
  sessions: MarketSessionInfo[];
}

export const MarketSessionsPanel: React.FC<MarketSessionsPanelProps> = ({
  sessions,
}) => {
  return (
    <div 
      id="panel-market-sessions"
      className="bg-[#0b101b] border border-[#1b273b] flex flex-col h-full overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[#0e1524] border-b border-[#1c293e] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
            PANEL 3 — MARKET SESSIONS
          </h2>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
          <span className="px-1.5 py-0.2 bg-[#121a28] border border-[#1e2d42] text-slate-400">
            TIMEZONE: UTC (CONFIGURABLE)
          </span>
        </div>
      </div>

      {/* Sessions Content */}
      <div className="p-3 space-y-2.5 overflow-y-auto flex-1 font-mono">
        {sessions.map((session) => {
          return (
            <div
              key={session.id}
              id={`session-card-${session.id.toLowerCase()}`}
              className="p-3 bg-[#0e1422] border border-[#1b263b] flex flex-col gap-2 transition-colors hover:border-[#283b5c]"
            >
              {/* Session Title & Open/Closed Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-none bg-slate-500"></div>
                  <span className="text-xs font-bold text-slate-200 tracking-wider">
                    {session.name}
                  </span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 text-slate-500" />
                    {session.cities}
                  </span>
                </div>

                {/* Open / Closed status (not faked) */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500 uppercase">State:</span>
                  <span className="px-1.5 py-0.2 bg-[#171e2c] border border-[#263750] text-slate-400 text-[10px] font-semibold">
                    {session.isOpen === null ? '—' : session.isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </div>
              </div>

              {/* Start / End Hours & Status */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#162033] text-[10px]">
                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Session Start</span>
                  <span className="text-slate-300 font-semibold tabular-nums">{session.startUtc}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[9px] uppercase">Session End</span>
                  <span className="text-slate-300 font-semibold tabular-nums">{session.endUtc}</span>
                </div>

                <div className="text-right">
                  <span className="text-slate-500 block text-[9px] uppercase">Status</span>
                  <span className="text-amber-400 font-semibold">{session.status}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Safety Note */}
      <div className="px-3 py-1.5 bg-[#090e18] border-t border-[#182335] text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span>DYNAMIC OVERLAP ENGINE: READY FOR FEED</span>
        <span className="text-slate-400 text-[9px]">UNVERIFIED FEED OVERRIDES SUPPRESSED</span>
      </div>
    </div>
  );
};
