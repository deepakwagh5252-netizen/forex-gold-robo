import React from 'react';
import { ListFilter, ArrowLeft, DatabaseZap, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { WATCHLIST_INSTRUMENTS } from '../market-data/constants';
import { InstrumentQuote } from '../types/terminal';
import { formatPrice, formatPercent, formatTimestamp } from '../utils/formatters';

interface WatchlistViewProps {
  quotes: Record<string, InstrumentQuote>;
  onBackToCommandCenter: () => void;
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  quotes,
  onBackToCommandCenter,
}) => {
  return (
    <div 
      id="forex-watchlist-page"
      className="flex-1 flex flex-col bg-[#070b13] p-4 overflow-y-auto font-mono select-none"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1b273b] mb-4">
        <div className="flex items-center gap-3">
          <button
            id="watchlist-back-btn"
            onClick={onBackToCommandCenter}
            className="p-1.5 bg-[#0f1725] hover:bg-[#162338] border border-[#233550] text-slate-300 cursor-pointer"
            title="Return to Command Center"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <ListFilter className="w-4 h-4 text-cyan-400" />
              FOREX &amp; GOLD WATCHLIST ({WATCHLIST_INSTRUMENTS.length} INSTRUMENTS)
            </h2>
            <p className="text-[11px] text-slate-500">
              Active watchlist tracking Spot Gold (XAU/USD) and core major Forex pairs via Twelve Data API.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-[#101b2c] border border-[#213757] text-cyan-300 font-semibold text-[10px] flex items-center gap-1.5">
            <DatabaseZap className="w-3 h-3 text-cyan-400" />
            PROVIDER: TWELVE DATA API PROXY
          </span>
        </div>
      </div>

      {/* Watchlist Table */}
      <div className="bg-[#0b101b] border border-[#1b273b] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#0e1524] border-b border-[#1c293e] text-[10px] text-slate-400 uppercase">
                <th className="py-2.5 px-4">Instrument</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Base / Quote</th>
                <th className="py-2.5 px-3 text-right">LTP</th>
                <th className="py-2.5 px-3 text-right">Change %</th>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-4 text-right">Data Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151f30]">
              {WATCHLIST_INSTRUMENTS.map((item) => {
                const quote = quotes[item.symbol] || {
                  symbol: item.symbol,
                  provider: 'Twelve Data',
                  ltp: null,
                  changePercent: null,
                  timestamp: null,
                  status: 'NOT CONNECTED',
                };
                const isGold = item.symbol === 'XAU/USD';
                const hasPrice = quote.ltp !== null && quote.ltp !== undefined;

                const getStatusBadge = () => {
                  switch (quote.status) {
                    case 'LIVE':
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-[9px] font-semibold">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                          LIVE
                        </span>
                      );
                    case 'STALE':
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-950/60 border border-amber-800 text-amber-300 text-[9px] font-semibold">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                          STALE
                        </span>
                      );
                    case 'RATE LIMITED':
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-950/60 border border-amber-800 text-amber-300 text-[9px] font-semibold">
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                          RATE LIMITED
                        </span>
                      );
                    case 'NOT CONNECTED':
                    default:
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-950/40 border border-rose-900 text-rose-400 text-[9px] font-semibold">
                          <XCircle className="w-2.5 h-2.5 text-rose-400" />
                          {quote.status || 'NOT CONNECTED'}
                        </span>
                      );
                  }
                };

                return (
                  <tr 
                    key={item.symbol} 
                    id={`watchlist-row-${item.symbol.replace('/', '-')}`}
                    className="hover:bg-[#0f1726] transition-colors"
                  >
                    <td className="py-3 px-4 font-bold">
                      <span className={isGold ? 'text-amber-400' : 'text-slate-100'}>
                        {item.symbol}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[11px]">
                      {item.name}
                    </td>
                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {item.category}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[11px]">
                      {item.baseCurrency} / {item.quoteCurrency}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold tabular-nums ${
                      hasPrice ? (quote.status === 'LIVE' ? 'text-emerald-300' : 'text-amber-300') : 'text-slate-500'
                    }`}>
                      {formatPrice(quote.ltp, item.pipPrecision)}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold tabular-nums ${
                      quote.changePercent !== null && quote.changePercent > 0
                        ? 'text-emerald-400'
                        : (quote.changePercent !== null && quote.changePercent < 0 ? 'text-rose-400' : 'text-slate-500')
                    }`}>
                      {formatPercent(quote.changePercent)}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[10px] tabular-nums">
                      {formatTimestamp(quote.timestamp)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {getStatusBadge()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Notice Footer */}
        <div className="p-3 bg-[#080d16] border-t border-[#182335] flex items-center justify-between text-[10px] text-slate-500">
          <span>SOURCE: SERVER-SIDE TWELVE DATA API INTEGRATION</span>
          <span className="text-cyan-400 font-semibold">NO SYNTHETIC OR SIMULATED TICKS</span>
        </div>
      </div>
    </div>
  );
};
