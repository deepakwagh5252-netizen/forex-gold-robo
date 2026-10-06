import React from 'react';
import { BookOpen, ArrowLeft, ShieldAlert, BarChart3, Database } from 'lucide-react';

interface TradeJournalViewProps {
  onBackToCommandCenter: () => void;
}

export const TradeJournalView: React.FC<TradeJournalViewProps> = ({
  onBackToCommandCenter,
}) => {
  return (
    <div 
      id="trade-journal-page"
      className="flex-1 flex flex-col bg-[#070b13] p-4 overflow-y-auto font-mono select-none"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1b273b] mb-4">
        <div className="flex items-center gap-3">
          <button
            id="journal-back-btn"
            onClick={onBackToCommandCenter}
            className="p-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300"
            title="Return to Command Center"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan-400" />
              TRADE JOURNAL &amp; ANALYTICS
            </h2>
            <p className="text-[11px] text-slate-500">
              Personal execution audit log and post-trade performance analytics.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-[#1c1815] border border-[#4a2e19] text-amber-400 font-semibold text-[10px]">
            COMING IN NEXT PHASE
          </span>
        </div>
      </div>

      {/* Main Journal Empty State Panel */}
      <div className="flex-1 bg-[#0b101b] border border-[#1b273b] p-8 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 bg-[#141d2d] border border-[#233550] flex items-center justify-center text-slate-400 mb-4">
          <Database className="w-6 h-6 text-slate-400" />
        </div>

        <h3 className="text-base font-bold tracking-widest text-slate-200 uppercase mb-2">
          NO TRADE HISTORY
        </h3>

        <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-6">
          Strict Data Safety Protocol: Fake trade logs, backtest profits, and fabricated track records are strictly prohibited. 
          The trade journal will record verified paper trades once the execution engine is unlocked in Phase 2.
        </p>

        <div className="grid grid-cols-3 gap-4 max-w-md w-full text-left p-3 bg-[#0d1422] border border-[#1a2538] text-[10px] text-slate-400">
          <div>
            <span className="text-slate-500 block">Total Trades</span>
            <span className="text-slate-300 font-bold">0</span>
          </div>
          <div>
            <span className="text-slate-500 block">Win Rate</span>
            <span className="text-slate-300 font-bold">—</span>
          </div>
          <div className="text-right">
            <span className="text-slate-500 block">Net P&amp;L</span>
            <span className="text-slate-300 font-bold">$0.00</span>
          </div>
        </div>

        <div className="mt-6 px-3 py-1 bg-[#162032] border border-[#20314b] text-[11px] text-cyan-300 font-semibold">
          COMING IN NEXT PHASE: TRADE JOURNAL ENGINE
        </div>
      </div>
    </div>
  );
};
