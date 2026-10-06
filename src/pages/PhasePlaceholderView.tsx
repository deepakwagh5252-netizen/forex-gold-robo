import React from 'react';
import { ShieldAlert, ArrowLeft, Terminal } from 'lucide-react';
import { NavigationPage } from '../types/terminal';

interface PhasePlaceholderViewProps {
  pageId: NavigationPage;
  pageTitle: string;
  onBackToCommandCenter: () => void;
}

export const PhasePlaceholderView: React.FC<PhasePlaceholderViewProps> = ({
  pageTitle,
  onBackToCommandCenter,
}) => {
  return (
    <div 
      id="phase-placeholder-view"
      className="flex-1 bg-[#070b13] flex flex-col items-center justify-center p-8 select-none font-mono"
    >
      <div className="max-w-md w-full bg-[#0b101b] border border-[#1d2a3f] p-8 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 mx-auto bg-[#141d2d] border border-[#233550] flex items-center justify-center text-cyan-400">
          <Terminal className="w-6 h-6 text-cyan-400" />
        </div>

        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">
            WORKSTATION MODULE: {pageTitle}
          </div>
          <h2 className="text-xl font-bold tracking-wider text-slate-100 uppercase">
            COMING IN NEXT PHASE
          </h2>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          In accordance with system specifications, module functionality is reserved for the subsequent phase after a verified Forex &amp; Gold institutional data provider is integrated.
        </p>

        <div className="p-3 bg-[#0e1422] border border-[#1b263b] text-[10px] text-slate-400 text-left space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Status:</span>
            <span className="text-amber-400 font-semibold">Planned for Phase 2</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Fake Functionality:</span>
            <span className="text-emerald-400 font-semibold">Suppressed (100% Data Safety)</span>
          </div>
        </div>

        <button
          id="btn-return-command-center"
          onClick={onBackToCommandCenter}
          className="w-full py-2.5 px-4 bg-[#142033] hover:bg-[#1a2c47] text-cyan-300 border border-[#233754] text-xs font-semibold tracking-wider transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>RETURN TO COMMAND CENTER</span>
        </button>
      </div>
    </div>
  );
};
