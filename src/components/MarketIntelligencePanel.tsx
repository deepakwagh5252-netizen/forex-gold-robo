import React from 'react';
import { Cpu, ShieldAlert, BarChart, Activity, CheckCircle2 } from 'lucide-react';
import { MarketIntelligenceMetrics } from '../types/terminal';
import { XauUsdMarketIntelligence } from '../types/intelligence';

interface MarketIntelligencePanelProps {
  metrics: MarketIntelligenceMetrics;
  xauIntelligence?: XauUsdMarketIntelligence | null;
}

export const MarketIntelligencePanel: React.FC<MarketIntelligencePanelProps> = ({
  metrics,
  xauIntelligence = null,
}) => {
  // If verified XAU/USD intelligence has been computed from real Twelve Data candles, display live metrics
  const isVerified = xauIntelligence && xauIntelligence.status === 'VERIFIED';
  const struct = xauIntelligence?.marketStructure;
  const vol = xauIntelligence?.volatility;
  const sweeps = xauIntelligence?.liquiditySweeps || [];

  const regimeVal = isVerified ? (struct?.rangeState || 'TRENDING') : metrics.regime;
  const volatilityVal = isVerified ? (vol?.classification ? `${vol.classification} (ATR $${vol.atr?.toFixed(2)})` : 'NORMAL') : metrics.volatility;
  const marketStructureVal = isVerified ? (struct?.lastStructurePoint ? `${struct.lastStructurePoint} (Confirmed)` : 'CONFIRMED SWINGS') : metrics.marketStructure;
  const liquidityVal = isVerified ? (sweeps.length > 0 ? `${sweeps[0].direction}` : 'STABLE POOLS') : metrics.liquidityCondition;
  const trendVal = isVerified ? (struct?.trendState || 'RANGING') : metrics.trendState;

  const fields = [
    { label: 'Market Regime', value: regimeVal, tag: 'MODEL_OUTPUT' },
    { label: 'Volatility', value: volatilityVal, tag: 'CALCULATION' },
    { label: 'Market Structure', value: marketStructureVal, tag: 'CALCULATION' },
    { label: 'Liquidity Condition', value: liquidityVal, tag: 'MODEL_OUTPUT' },
    { label: 'Trend State', value: trendVal, tag: 'MODEL_OUTPUT' },
  ];

  return (
    <div 
      id="panel-market-intelligence"
      className="bg-[#0b101b] border border-[#1b273b] flex flex-col h-full overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-[#0e1524] border-b border-[#1c293e] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
            PANEL 4 — MARKET INTELLIGENCE
          </h2>
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] text-amber-400 font-semibold">
          <ShieldAlert className="w-3 h-3 text-amber-400" />
          <span>ZERO SPECULATION</span>
        </div>
      </div>

      {/* Grid of indicators */}
      <div className="p-3 space-y-2 flex-1 overflow-y-auto font-mono text-xs">
        {fields.map((field) => (
          <div
            key={field.label}
            id={`intel-metric-${field.label.toLowerCase().replace(/\s+/g, '-')}`}
            className="p-2 bg-[#0e1422] border border-[#1b263b] flex items-center justify-between transition-colors hover:border-[#283b5c]"
          >
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 ${isVerified ? 'bg-emerald-400' : 'bg-slate-600'}`}></div>
              <span className="text-[11px] font-medium text-slate-300">
                {field.label}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="px-1 text-[8px] bg-[#151c2c] border border-[#212f47] text-slate-400">
                {field.tag}
              </span>
              <span className={`px-2 py-0.5 border text-[10px] font-semibold tracking-wider ${
                isVerified 
                  ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300' 
                  : 'bg-[#171b26] border-[#2b2f3d] text-amber-300'
              }`}>
                {field.value ?? metrics.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 bg-[#090e18] border-t border-[#182335] text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          {isVerified && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
          {isVerified ? 'QUANT ENGINE: AUDITED REAL FEED' : 'QUANT ENGINE: RESTRICTED TO AUDITED FEEDS'}
        </span>
        <span className={isVerified ? 'text-emerald-400 font-semibold text-[9px]' : 'text-slate-400 text-[9px]'}>
          {isVerified ? `${xauIntelligence.candleCount} BARS ANALYZED` : 'AWAITING REAL TICKS'}
        </span>
      </div>
    </div>
  );
};
