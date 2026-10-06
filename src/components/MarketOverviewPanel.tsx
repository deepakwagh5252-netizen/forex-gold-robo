import React from 'react';
import { Activity, ShieldAlert, Layers, CheckCircle2, AlertTriangle, XCircle, DatabaseZap } from 'lucide-react';
import { InstrumentQuote } from '../types/terminal';
import { MARKET_OVERVIEW_SYMBOLS, WATCHLIST_INSTRUMENTS } from '../market-data/constants';
import { formatPrice, formatPercent, formatTimestamp } from '../utils/formatters';

interface MarketOverviewPanelProps {
  quotes: Record<string, InstrumentQuote>;
  selectedSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
}

export const MarketOverviewPanel: React.FC<MarketOverviewPanelProps> = ({
  quotes,
  selectedSymbol = 'XAU/USD',
  onSelectSymbol,
}) => {
  // Determine overall status
  const quotesList = Object.values(quotes);
  const liveQuotesCount = quotesList.filter(q => q.status === 'LIVE').length;
  const staleQuotesCount = quotesList.filter(q => q.status === 'STALE').length;

  return (
    <div 
      id="panel-market-overview"
      className="bg-[#0b101b] border border-[#1b273b] flex flex-col h-full overflow-hidden"
    >
      {/* Panel Header */}
      <div className="px-3 py-2 bg-[#0e1524] border-b border-[#1c293e] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
            PANEL 1 — MARKET OVERVIEW
          </h2>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="px-1.5 py-0.5 bg-[#141e30] border border-[#233550] text-slate-400 flex items-center gap-1">
            <DatabaseZap className="w-2.5 h-2.5 text-cyan-400" />
            TWELVE DATA
          </span>
          <span className="px-1.5 py-0.5 bg-[#141e30] border border-[#233550] text-slate-400">
            {MARKET_OVERVIEW_SYMBOLS.length} CORE PAIRS
          </span>
          {liveQuotesCount > 0 ? (
            <span className="text-emerald-400 flex items-center gap-1 font-semibold px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-800/60">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              {liveQuotesCount} LIVE
            </span>
          ) : staleQuotesCount > 0 ? (
            <span className="text-amber-400 flex items-center gap-1 font-semibold px-1.5 py-0.5 bg-amber-950/40 border border-amber-800/60">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              {staleQuotesCount} STALE
            </span>
          ) : (
            <span className="text-rose-400 flex items-center gap-1 font-semibold px-1.5 py-0.5 bg-rose-950/40 border border-rose-900/60">
              <XCircle className="w-3 h-3 text-rose-400" />
              AWAITING KEYS / SYNC
            </span>
          )}
        </div>
      </div>

      {/* Cards Grid */}
      <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 overflow-y-auto flex-1">
        {MARKET_OVERVIEW_SYMBOLS.map((sym) => {
          const instrument = WATCHLIST_INSTRUMENTS.find(i => i.symbol === sym);
          const quote = quotes[sym] || {
            symbol: sym,
            provider: 'Twelve Data',
            ltp: null,
            changePercent: null,
            bid: null,
            ask: null,
            spreadPips: null,
            timestamp: null,
            status: 'NOT CONNECTED',
            source: 'Twelve Data API',
            freshness: 'NONE',
          };

          const isSelected = selectedSymbol === sym;
          const isGold = sym === 'XAU/USD';
          const hasPrice = quote.ltp !== null && quote.ltp !== undefined;

          // Status Badge styling
          const getStatusStyle = () => {
            switch (quote.status) {
              case 'LIVE':
                return 'bg-emerald-950/80 border-emerald-700 text-emerald-300';
              case 'STALE':
                return 'bg-amber-950/80 border-amber-700 text-amber-300';
              case 'RATE LIMITED':
                return 'bg-amber-950/60 border-amber-800 text-amber-300';
              case 'WAITING':
                return 'bg-cyan-950/60 border-cyan-800 text-cyan-300';
              case 'NOT CONNECTED':
              default:
                return 'bg-rose-950/40 border-rose-900/80 text-rose-400';
            }
          };

          // Change percent text styling
          const getChangeColor = () => {
            if (quote.changePercent === null || quote.changePercent === undefined) return 'text-slate-500';
            if (quote.changePercent > 0) return 'text-emerald-400';
            if (quote.changePercent < 0) return 'text-rose-400';
            return 'text-slate-300';
          };

          return (
            <div
              key={sym}
              id={`market-card-${sym.replace('/', '-')}`}
              onClick={() => onSelectSymbol && onSelectSymbol(sym)}
              className={`p-2.5 border transition-all cursor-pointer select-none font-mono flex flex-col justify-between ${
                isSelected
                  ? 'bg-[#121c2d] border-cyan-500/70 shadow-sm'
                  : 'bg-[#0e1422] border-[#1a2538] hover:border-[#2b3d5c] hover:bg-[#111929]'
              }`}
            >
              {/* Card Header: Symbol & Type */}
              <div className="flex items-center justify-between pb-1.5 border-b border-[#182335]">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold ${isGold ? 'text-amber-400' : 'text-slate-100'}`}>
                    {sym}
                  </span>
                  {isGold && (
                    <span className="text-[9px] px-1 bg-amber-950/80 text-amber-300 border border-amber-800/80">
                      SPOT
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-slate-500 uppercase tracking-tight">
                  {instrument?.category.replace(' Forex', '') || 'FX'}
                </span>
              </div>

              {/* Price & Change Row */}
              <div className="py-2 flex items-baseline justify-between">
                <div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">LTP</div>
                  <div className={`text-base font-bold tabular-nums ${
                    hasPrice ? (quote.status === 'LIVE' ? 'text-emerald-300' : 'text-amber-300') : 'text-slate-500'
                  }`}>
                    {formatPrice(quote.ltp, instrument?.pipPrecision ?? 4)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">Change %</div>
                  <div className={`text-xs font-bold tabular-nums ${getChangeColor()}`}>
                    {formatPercent(quote.changePercent)}
                  </div>
                </div>
              </div>

              {/* Status & Timestamp */}
              <div className="pt-1.5 border-t border-[#182335] space-y-1 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[9px] uppercase">Status:</span>
                  <span className={`px-1 py-0.2 border text-[9px] font-semibold tracking-wide ${getStatusStyle()}`}>
                    {quote.status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-500 text-[9px]">
                  <span>Timestamp:</span>
                  <span className="text-slate-400 truncate max-w-[120px]" title={quote.timestamp || undefined}>
                    {formatTimestamp(quote.timestamp)}
                  </span>
                </div>

                {quote.error && (
                  <div className="text-[9px] text-amber-400/90 truncate pt-0.5 border-t border-[#182335]/60" title={quote.error}>
                    {quote.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Safety Notice Footer inside panel */}
      <div className="px-3 py-1 bg-[#090d16] border-t border-[#162030] text-[10px] font-mono text-slate-500 flex items-center justify-between">
        <span className="text-[9px]">FEED SOURCE: TWELVE DATA API PROXY</span>
        <span className="text-cyan-400 font-semibold text-[9px]">ZERO-FABRICATION RULE ENFORCED</span>
      </div>
    </div>
  );
};
