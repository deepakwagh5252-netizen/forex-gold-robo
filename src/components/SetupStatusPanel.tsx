import React from 'react';
import { Radar, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import { SetupStatusInfo } from '../types/terminal';
import { ScannerSummary, SetupRecord, SetupState } from '../types/scanner';

interface SetupStatusPanelProps {
  setupStatus: SetupStatusInfo;
  scannerSummary?: ScannerSummary | null;
  onOpenScanner?: () => void;
}

export const SetupStatusPanel: React.FC<SetupStatusPanelProps> = ({
  setupStatus,
  scannerSummary = null,
  onOpenScanner,
}) => {
  const current = scannerSummary?.currentSetup;
  const isScanned = scannerSummary !== null && scannerSummary.dataVerified;

  // Derive display state
  let displayState: 'NO SETUP' | 'SETUP FORMING' | 'VALIDATED CANDIDATE' = 'NO SETUP';
  let stateReason = 'Missing confirmed liquidity sweep.';

  if (isScanned && current) {
    if (current.status === 'VALIDATED_CANDIDATE') {
      displayState = 'VALIDATED CANDIDATE';
      stateReason = current.statusReason;
    } else if (current.status === 'SETUP_FORMING') {
      displayState = 'SETUP FORMING';
      stateReason = current.statusReason;
    } else if (current.status === 'WATCH') {
      displayState = 'SETUP FORMING';
      stateReason = current.statusReason;
    } else {
      displayState = 'NO SETUP';
      stateReason = current.statusReason || 'Missing confirmed liquidity sweep.';
    }
  }

  const confluence = current?.validation?.confluence;

  const confluenceItems = [
    { label: 'Liquidity', val: confluence?.liquidity || 'FAIL' },
    { label: 'Structure', val: confluence?.structure || 'FAIL' },
    { label: 'Displacement', val: confluence?.displacement || 'FAIL' },
    { label: 'FVG', val: confluence?.fvg || 'FAIL' },
    { label: 'Retest', val: confluence?.retest || 'FAIL' },
    { label: 'Volatility', val: confluence?.volatility || 'PASS' },
    { label: 'Multi-TF', val: confluence?.multiTimeframe || 'NOT_AVAILABLE' },
    { label: 'R:R (>=2.0)', val: confluence?.riskReward || 'FAIL' },
  ];

  return (
    <div 
      id="panel-setup-status"
      className="bg-[#0b101b] border border-[#1b273b] flex flex-col h-full overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[#0e1524] border-b border-[#1c293e] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Radar className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
            PANEL 5 — SETUP STATUS
          </h2>
        </div>
        <span className={`px-1.5 py-0.2 font-mono text-[9px] border font-semibold ${
          displayState === 'VALIDATED CANDIDATE'
            ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
            : displayState === 'SETUP FORMING'
            ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
            : 'bg-[#121c2c] border-[#1c304d] text-amber-400'
        }`}>
          {isScanned ? 'SCANNER ACTIVE' : 'ALGO SCANNER IDLE'}
        </span>
      </div>

      {/* Main Status Display */}
      <div className="p-3 flex-1 flex flex-col justify-between font-mono text-xs overflow-y-auto">
        {/* COMPACT SECTION: CURRENT SETUP */}
        <div 
          id="current-setup-card"
          className="p-3 bg-[#0d1422] border border-[#1a293f] flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
              CURRENT SETUP
            </span>
            <span className={`px-2 py-0.5 border text-[10px] font-bold tracking-wider uppercase ${
              displayState === 'VALIDATED CANDIDATE'
                ? 'bg-emerald-950/90 border-emerald-700 text-emerald-300'
                : displayState === 'SETUP FORMING'
                ? 'bg-cyan-950/90 border-cyan-700 text-cyan-300'
                : 'bg-[#141a27] border-[#222a3d] text-amber-300'
            }`}>
              {displayState}
            </span>
          </div>

          {/* Reason */}
          <div id="current-setup-reason" className="text-[11px] text-slate-300 leading-relaxed bg-[#080d16] p-2 border border-[#141f30]">
            <span className="text-slate-500 font-semibold block text-[9px] uppercase mb-0.5">EVALUATION REASON:</span>
            {stateReason}
          </div>

          {/* Action to open full scanner */}
          {onOpenScanner && (
            <button
              id="open-setup-scanner-btn"
              onClick={onOpenScanner}
              className="mt-1 w-full py-1 px-2 bg-[#121d30] hover:bg-[#182842] border border-[#203454] text-cyan-300 hover:text-cyan-200 text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>OPEN SETUP SCANNER &amp; AUDIT</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Confluence Breakdown */}
        <div className="mt-2.5 pt-2 border-t border-[#182335] space-y-1">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Confluence Matrix</span>
            <span className="text-slate-400 text-[8px]">MODEL_OUTPUT</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            {confluenceItems.map((item) => (
              <div 
                key={item.label}
                className="flex items-center justify-between py-0.5 px-1.5 bg-[#0a101c] border border-[#152030]"
              >
                <span className="text-slate-400 text-[9px]">{item.label}</span>
                <span className={`text-[8px] font-bold px-1 ${
                  item.val === 'PASS' 
                    ? 'text-emerald-400' 
                    : item.val === 'FAIL' 
                    ? 'text-rose-400' 
                    : 'text-slate-500'
                }`}>
                  {item.val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 bg-[#090e18] border-t border-[#182335] text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <ShieldAlert className="w-3 h-3 text-emerald-400" />
          <span>ZERO SYNTHETIC SETUPS</span>
        </span>
        <span className="text-slate-400 text-[9px]">
          {isScanned ? `${scannerSummary?.candidates.length} CANDIDATES SCANNED` : 'WAITING FOR TICKS'}
        </span>
      </div>
    </div>
  );
};
