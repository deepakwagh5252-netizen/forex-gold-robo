import React, { useState, useEffect } from 'react';
import { 
  Coins, 
  BarChart2, 
  Clock, 
  ShieldAlert, 
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  DatabaseZap,
  Activity,
  Layers,
  TrendingUp,
  TrendingDown,
  Compass,
  Zap,
  Target
} from 'lucide-react';
import { InstrumentQuote } from '../types/terminal';
import { Candle, CandleSeriesMeta } from '../market-data/provider.interface';
import { XauUsdMarketIntelligence } from '../types/intelligence';
import { PaperPosition, PaperTradeJournalEntry } from '../types/paper-trading';
import { ForwardPosition, ForwardTrade } from '../types/forward-validation';
import { MarketSuperChart } from './chart/MarketSuperChart';
import { SupportedChartTimeframe } from '../utils/candle-integrity';
import { formatPrice, formatPercent, formatTimestamp } from '../utils/formatters';

interface XauUsdFocusPanelProps {
  quote?: InstrumentQuote;
  activeSession?: string;
  candles?: Candle[];
  candlesError?: string | null;
  isLoadingCandles?: boolean;
  intelligence?: XauUsdMarketIntelligence | null;
  meta?: CandleSeriesMeta | null;
  selectedSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
  openPositions?: PaperPosition[];
  tradeHistory?: PaperTradeJournalEntry[];
  forwardTrades?: ForwardTrade[];
  forwardPositions?: ForwardPosition[];
  onTimeframeChange?: (tf: string) => void;
  onRefresh?: () => void;
}

export const XauUsdFocusPanel: React.FC<XauUsdFocusPanelProps> = ({
  quote = {
    symbol: 'XAU/USD',
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
  },
  activeSession = '—',
  candles = [],
  candlesError = null,
  isLoadingCandles = false,
  intelligence = null,
  meta = null,
  selectedSymbol = 'XAU/USD',
  onSymbolChange,
  openPositions = [],
  tradeHistory = [],
  forwardTrades = [],
  forwardPositions = [],
  onTimeframeChange,
  onRefresh,
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState<SupportedChartTimeframe>('15m');
  const [activeTab, setActiveTab] = useState<'CHART' | 'INTELLIGENCE' | 'LEVELS' | 'MULTI_TF'>('CHART');
  const timeframes = ['5m', '15m', '1h', '4h', '1D'];

  const hasPrice = quote.ltp !== null && quote.ltp !== undefined;
  const hasCandles = candles && candles.length > 0;

  // Status Badge styling
  const getStatusBadge = () => {
    switch (quote.status) {
      case 'LIVE':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
          color: 'text-emerald-400',
          bg: 'bg-emerald-950/60 border-emerald-800',
        };
      case 'STALE':
      case 'RATE LIMITED':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
          color: 'text-amber-400',
          bg: 'bg-amber-950/60 border-amber-800',
        };
      case 'NOT CONNECTED':
      default:
        return {
          icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
          color: 'text-rose-400',
          bg: 'bg-rose-950/60 border-rose-900',
        };
    }
  };

  const statusStyle = getStatusBadge();

  // Calculate high / low range if candles exist
  const candleMetrics = React.useMemo(() => {
    if (!hasCandles) return null;
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    candles.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });
    return { minPrice, maxPrice, range: maxPrice - minPrice };
  }, [candles, hasCandles]);

  const marketStructure = intelligence?.marketStructure;
  const periodLevels = intelligence?.previousPeriodLevels;
  const volatility = intelligence?.volatility;
  const sessions = intelligence?.sessions || [];
  const liquidityLevels = intelligence?.liquidityLevels || [];
  const sweeps = intelligence?.liquiditySweeps || [];
  const fvgs = intelligence?.fairValueGaps || [];
  const displacements = intelligence?.displacements || [];

  return (
    <div 
      id="panel-xau-usd-focus"
      className="bg-[#0b101b] border border-[#1b273b] flex flex-col h-full overflow-hidden"
    >
      {/* Panel Top Header Bar */}
      <div className="px-3 py-2 bg-[#0e1524] border-b border-[#1c293e] flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-100 uppercase">
            PANEL 2 — XAU/USD FOCUS &amp; MARKET INTELLIGENCE
          </h2>
          <span className="px-1.5 py-0.2 text-[9px] font-mono bg-amber-950/80 border border-amber-800 text-amber-300 font-semibold">
            CORE STRATEGY ASSET
          </span>
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-cyan-400 bg-[#121d2f] border border-[#1f3250] px-1.5 py-0.5 font-mono">
            <DatabaseZap className="w-2.5 h-2.5 text-cyan-400" />
            FEED: TWELVE DATA
          </span>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <button
            id="view-tab-chart"
            onClick={() => setActiveTab('CHART')}
            className={`px-2 py-0.5 border cursor-pointer font-bold ${
              activeTab === 'CHART'
                ? 'bg-[#1b2b45] border-cyan-400 text-cyan-300'
                : 'bg-[#0e1422] border-[#1d293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            CHART
          </button>
          <button
            id="view-tab-intel"
            onClick={() => setActiveTab('INTELLIGENCE')}
            className={`px-2 py-0.5 border cursor-pointer font-bold flex items-center gap-1 ${
              activeTab === 'INTELLIGENCE'
                ? 'bg-[#1b2b45] border-amber-400 text-amber-300'
                : 'bg-[#0e1422] border-[#1d293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-2.5 h-2.5" />
            STRUCTURE &amp; ATR
          </button>
          <button
            id="view-tab-levels"
            onClick={() => setActiveTab('LEVELS')}
            className={`px-2 py-0.5 border cursor-pointer font-bold flex items-center gap-1 ${
              activeTab === 'LEVELS'
                ? 'bg-[#1b2b45] border-emerald-400 text-emerald-300'
                : 'bg-[#0e1422] border-[#1d293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Target className="w-2.5 h-2.5" />
            LIQUIDITY &amp; FVG
          </button>
          <button
            id="view-tab-multi"
            onClick={() => setActiveTab('MULTI_TF')}
            className={`px-2 py-0.5 border cursor-pointer font-bold flex items-center gap-1 ${
              activeTab === 'MULTI_TF'
                ? 'bg-[#1b2b45] border-purple-400 text-purple-300'
                : 'bg-[#0e1422] border-[#1d293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-2.5 h-2.5" />
            MULTI-TF
          </button>
        </div>
      </div>

      {/* Metrics Strip (MANDATORY FIELDS: Provider, LTP, Timestamp, Data Status, Intelligence Status) */}
      <div className="px-4 py-2 bg-[#0d1320] border-b border-[#182335] grid grid-cols-2 sm:grid-cols-6 gap-3 font-mono text-xs select-none">
        {/* 1. PROVIDER */}
        <div id="xau-provider-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Provider</span>
          <span className="text-sm font-bold text-cyan-300 mt-0.5">
            {quote.provider || 'Twelve Data'}
          </span>
        </div>

        {/* 2. ACTUAL LTP */}
        <div id="xau-ltp-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">XAU/USD LTP [FACT]</span>
          <span className={`text-lg font-bold tabular-nums ${
            hasPrice ? (quote.status === 'LIVE' ? 'text-emerald-300' : 'text-amber-300') : 'text-slate-500'
          }`}>
            {formatPrice(quote.ltp, 2)}
          </span>
        </div>

        {/* 3. CHANGE % */}
        <div id="xau-change-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Change % [FACT]</span>
          <span className={`text-base font-bold tabular-nums ${
            quote.changePercent !== null && quote.changePercent > 0 
              ? 'text-emerald-400' 
              : (quote.changePercent !== null && quote.changePercent < 0 ? 'text-rose-400' : 'text-slate-500')
          }`}>
            {formatPercent(quote.changePercent)}
          </span>
        </div>

        {/* 4. TIMESTAMP */}
        <div id="xau-timestamp-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Provider Time [FACT]</span>
          <span className="text-[11px] font-semibold text-slate-300 mt-1 truncate" title={quote.timestamp || undefined}>
            {formatTimestamp(quote.timestamp)}
          </span>
        </div>

        {/* 5. DATA STATUS */}
        <div id="xau-status-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Data Status</span>
          <div className="flex items-center gap-1 mt-1">
            {statusStyle.icon}
            <span className={`text-xs font-bold ${statusStyle.color}`}>
              {quote.status}
            </span>
          </div>
        </div>

        {/* 6. INTELLIGENCE ENGINE STATUS */}
        <div id="xau-engine-metric" className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Structure Engine</span>
          <span className={`text-xs font-bold mt-1 ${
            intelligence && intelligence.status === 'VERIFIED' ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {intelligence ? intelligence.status : 'AWAITING VERIFIED DATA'}
          </span>
        </div>
      </div>

      {/* Main Viewport depending on Active Tab */}
      <div 
        id="xau-usd-chart-container"
        className="relative flex-1 bg-[#070b13] flex flex-col justify-start p-3 select-none overflow-y-auto min-h-[300px]"
      >
        {/* TAB 1: CHART VIEW */}
        {activeTab === 'CHART' && (
          <div className="w-full h-full min-h-[460px] flex flex-col -m-3">
            <MarketSuperChart
              symbol={selectedSymbol || quote.symbol || 'XAU/USD'}
              onSymbolChange={onSymbolChange}
              candles={candles}
              isLoading={isLoadingCandles}
              error={candlesError}
              meta={meta}
              latestPrice={quote.ltp}
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={(tf) => {
                setSelectedTimeframe(tf);
                onTimeframeChange?.(tf);
              }}
              openPositions={openPositions}
              tradeHistory={tradeHistory}
              forwardTrades={forwardTrades}
              forwardPositions={forwardPositions}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* TAB 2: STRUCTURE & ATR */}
        {activeTab === 'INTELLIGENCE' && (
          <div className="w-full space-y-3 font-mono">
            {/* Top Stat Row */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>TREND STATE</span>
                  <span className="px-1 text-[8px] bg-[#1a2538] text-amber-300">MODEL_OUTPUT</span>
                </div>
                <div className="text-sm font-bold text-slate-200 mt-1 flex items-center gap-1.5">
                  {marketStructure?.trendState === 'BULLISH' && <TrendingUp className="w-4 h-4 text-emerald-400" />}
                  {marketStructure?.trendState === 'BEARISH' && <TrendingDown className="w-4 h-4 text-rose-400" />}
                  {marketStructure?.trendState || 'UNDEFINED'}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  Range: {marketStructure?.rangeState || 'UNDEFINED'}
                </div>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>ATR(14)</span>
                  <span className="px-1 text-[8px] bg-[#1a2538] text-cyan-300">CALCULATION</span>
                </div>
                <div className="text-sm font-bold text-cyan-300 mt-1">
                  {volatility?.atr !== null && volatility?.atr !== undefined ? `$${volatility.atr.toFixed(2)}` : '—'}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  Classification: <strong className="text-amber-400">{volatility?.classification || 'UNDEFINED'}</strong>
                </div>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>CONFIRMED SWINGS</span>
                  <span className="px-1 text-[8px] bg-[#1a2538] text-cyan-300">CALCULATION</span>
                </div>
                <div className="text-sm font-bold text-slate-200 mt-1">
                  HH: {marketStructure?.higherHighsCount ?? 0} | HL: {marketStructure?.higherLowsCount ?? 0}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  LH: {marketStructure?.lowerHighsCount ?? 0} | LL: {marketStructure?.lowerLowsCount ?? 0}
                </div>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>LAST EVENT</span>
                  <span className="px-1 text-[8px] bg-[#1a2538] text-amber-300">MODEL_OUTPUT</span>
                </div>
                <div className="text-sm font-bold text-amber-400 mt-1">
                  {marketStructure?.lastEvent ? `${marketStructure.lastEvent.type} ($${marketStructure.lastEvent.brokenLevel.toFixed(2)})` : 'None Confirmed'}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  {marketStructure?.lastEvent ? `${marketStructure.lastEvent.direction} at ${marketStructure.lastEvent.datetime.substring(11, 16)} UTC` : 'Stable Swings'}
                </div>
              </div>
            </div>

            {/* Swings Table */}
            <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
              <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-2 text-xs text-slate-300 font-bold">
                <span className="flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-cyan-400" />
                  CONFIRMED SWING POINTS (2-BAR DETERMINISTIC VALIDATION)
                </span>
                <span className="text-[10px] text-slate-500">CALCULATION: STRICT OHLCV</span>
              </div>
              
              {marketStructure && marketStructure.swingHighs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-emerald-400 font-semibold block mb-1">SWING HIGHS (CONFIRMED)</span>
                    <div className="space-y-1">
                      {marketStructure.swingHighs.slice(-4).map((s, idx) => (
                        <div key={idx} className="flex justify-between p-1.5 bg-[#0a0f1a] border border-[#182336] text-[11px]">
                          <span className="text-slate-400">{s.datetime ? s.datetime.substring(11, 16) : '—'} UTC</span>
                          <span className="text-amber-300 font-semibold">{s.structureType || 'PEAK'}</span>
                          <span className="text-emerald-400 font-bold">${s.price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-rose-400 font-semibold block mb-1">SWING LOWS (CONFIRMED)</span>
                    <div className="space-y-1">
                      {marketStructure.swingLows.slice(-4).map((s, idx) => (
                        <div key={idx} className="flex justify-between p-1.5 bg-[#0a0f1a] border border-[#182336] text-[11px]">
                          <span className="text-slate-400">{s.datetime ? s.datetime.substring(11, 16) : '—'} UTC</span>
                          <span className="text-amber-300 font-semibold">{s.structureType || 'TROUGH'}</span>
                          <span className="text-rose-400 font-bold">${s.price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 py-3 text-center">
                  INSUFFICIENT VERIFIED DATA FOR SWING CONFIRMATION (Requires ≥5 verified candles)
                </div>
              )}
            </div>

            {/* Displacements */}
            <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
              <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-2 text-xs text-slate-300 font-bold">
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  DISPLACEMENT CANDLES (BODY ≥ 65%, RANGE ≥ 1.35x ATR)
                </span>
                <span className="text-[10px] text-slate-500">CALCULATION</span>
              </div>
              {displacements.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {displacements.slice(0, 3).map((d, i) => (
                    <div key={i} className="p-2 bg-[#0a0f1a] border border-[#182336]">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400">{d.datetime.substring(11, 16)} UTC</span>
                        <span className={d.direction === 'BULLISH' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {d.direction}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-300">
                        Range: ${d.candleRange.toFixed(2)} ({d.atrRatio.toFixed(1)}x ATR)
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 py-2 text-center">
                  No active displacement candles detected in the current window.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LIQUIDITY & FVG */}
        {activeTab === 'LEVELS' && (
          <div className="w-full space-y-3 font-mono">
            {/* Reference Period Levels (PDH, PDL, PWH, PWL) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <span className="text-[10px] text-slate-500 block">PREVIOUS DAY HIGH (PDH)</span>
                <span className="text-base font-bold text-emerald-400">
                  {periodLevels?.pdh ? `$${periodLevels.pdh.toFixed(2)}` : '—'}
                </span>
                <span className="text-[9px] text-slate-500 block">FACT: Prior UTC Day</span>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <span className="text-[10px] text-slate-500 block">PREVIOUS DAY LOW (PDL)</span>
                <span className="text-base font-bold text-rose-400">
                  {periodLevels?.pdl ? `$${periodLevels.pdl.toFixed(2)}` : '—'}
                </span>
                <span className="text-[9px] text-slate-500 block">FACT: Prior UTC Day</span>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <span className="text-[10px] text-slate-500 block">PREV WEEK HIGH (PWH)</span>
                <span className="text-base font-bold text-emerald-400">
                  {periodLevels?.pwh ? `$${periodLevels.pwh.toFixed(2)}` : '—'}
                </span>
                <span className="text-[9px] text-slate-500 block">FACT: Prior UTC Week</span>
              </div>

              <div className="p-2.5 bg-[#0e1524] border border-[#1b273b]">
                <span className="text-[10px] text-slate-500 block">PREV WEEK LOW (PWL)</span>
                <span className="text-base font-bold text-rose-400">
                  {periodLevels?.pwl ? `$${periodLevels.pwl.toFixed(2)}` : '—'}
                </span>
                <span className="text-[9px] text-slate-500 block">FACT: Prior UTC Week</span>
              </div>
            </div>

            {/* Liquidity Map & Sweeps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Liquidity Levels */}
              <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-2 text-xs text-slate-300 font-bold">
                  <span>LIQUIDITY POOLS (PDH, PDL, SESSIONS, EQH/EQL)</span>
                  <span className="text-[10px] text-slate-500">CALCULATION</span>
                </div>
                {liquidityLevels.length > 0 ? (
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                    {liquidityLevels.slice(0, 6).map((lvl, idx) => (
                      <div key={idx} className="flex justify-between items-center p-1.5 bg-[#0a0f1a] border border-[#182336] text-[11px]">
                        <div>
                          <span className="text-slate-300 font-semibold">{lvl.source.replace(/_/g, ' ')}</span>
                          <span className="text-[9px] text-slate-500 ml-2">CONFIRMED</span>
                        </div>
                        <span className="text-amber-300 font-bold">${lvl.level.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 py-3 text-center">
                    No liquidity levels registered yet.
                  </div>
                )}
              </div>

              {/* Liquidity Sweeps */}
              <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
                <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-2 text-xs text-slate-300 font-bold">
                  <span>CONFIRMED LIQUIDITY SWEEPS</span>
                  <span className="text-[10px] text-amber-400">MODEL_OUTPUT</span>
                </div>
                {sweeps.length > 0 ? (
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                    {sweeps.map((swp, idx) => (
                      <div key={idx} className="p-2 bg-[#0a0f1a] border border-[#182336] text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-amber-300 font-semibold">{swp.direction}</span>
                          <span className="text-slate-400">{swp.datetime.substring(11, 16)} UTC</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                          <span>Swept Level: ${swp.levelSwept.toFixed(2)}</span>
                          <span className="text-emerald-400">Rejection Confirmed</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 py-3 text-center">
                    No confirmed sweeps (breach + close inside) in recent verified candles.
                  </div>
                )}
              </div>
            </div>

            {/* Fair Value Gaps (FVG) */}
            <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
              <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-2 text-xs text-slate-300 font-bold">
                <span>FAIR VALUE GAPS (3-CANDLE OBJECTIVE IMBALANCE)</span>
                <span className="text-[10px] text-cyan-400">CALCULATION</span>
              </div>
              {fvgs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {fvgs.slice(0, 3).map((fvg, idx) => (
                    <div key={idx} className="p-2 bg-[#0a0f1a] border border-[#182336]">
                      <div className="flex justify-between text-[10px]">
                        <span className={fvg.direction === 'BULLISH' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {fvg.direction} FVG
                        </span>
                        <span className="text-slate-500">{fvg.fillPercentage}% FILLED</span>
                      </div>
                      <div className="text-xs font-bold text-slate-200 mt-1">
                        ${fvg.lowerBoundary.toFixed(2)} - ${fvg.upperBoundary.toFixed(2)}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">
                        Gap: ${fvg.gapSize.toFixed(2)} | Formed: {fvg.datetime.substring(11, 16)} UTC
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 py-2 text-center">
                  No unfilled Fair Value Gaps detected in the loaded verified candle window.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: MULTI-TIMEFRAME VIEW */}
        {activeTab === 'MULTI_TF' && (
          <div className="w-full space-y-3 font-mono">
            <div className="p-3 bg-[#0e1524] border border-[#1b273b]">
              <div className="flex items-center justify-between pb-2 border-b border-[#1a263c] mb-3 text-xs text-slate-300 font-bold">
                <span>MULTI-TIMEFRAME STRUCTURE SYNTHESIS (M5, M15, M30, H1, H4, D1)</span>
                <span className="text-[10px] text-slate-500">PROTECTED RATE BUDGET (8 REQ/MIN)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#1f2d45] text-slate-400 text-[10px] uppercase">
                      <th className="py-2 px-3">Timeframe</th>
                      <th className="py-2 px-3">Data Status</th>
                      <th className="py-2 px-3">Trend State [MODEL]</th>
                      <th className="py-2 px-3">Structure [CALC]</th>
                      <th className="py-2 px-3">ATR(14) [CALC]</th>
                      <th className="py-2 px-3">Liquidity / Break</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#172236]">
                    {(intelligence?.multiTimeframeFacts || []).map((fact) => (
                      <tr key={fact.timeframe} className="hover:bg-[#0a0f1b]">
                        <td className="py-2.5 px-3 font-bold text-cyan-300">{fact.timeframe}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 text-[9px] font-bold ${
                            fact.hasData ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {fact.hasData ? `VERIFIED (${fact.candleCount} bars)` : 'STANDBY (BUDGET)'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-200">{fact.trend}</td>
                        <td className="py-2.5 px-3 text-slate-300">{fact.structure}</td>
                        <td className="py-2.5 px-3 text-amber-300">
                          {fact.atr !== null ? `$${fact.atr.toFixed(2)} (${fact.volatility})` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">{fact.liquidityState}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Panel Bottom Specs Bar */}
      <div className="px-3 py-1.5 bg-[#090e18] border-t border-[#182335] text-[10px] font-mono text-slate-400 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span>INSTRUMENT: <strong className="text-slate-200">XAU/USD (SPOT GOLD)</strong></span>
          <span className="hidden sm:inline text-slate-600">|</span>
          <span className="hidden sm:inline">BASE/QUOTE: <strong className="text-slate-300">XAU / USD</strong></span>
          <span className="hidden sm:inline text-slate-600">|</span>
          <span className="hidden sm:inline">DATA SOURCE: <strong className="text-cyan-300">TWELVE DATA</strong></span>
        </div>
        <div className="text-slate-500">
          STRICT DATA PROTOCOL: <span className="text-emerald-400 font-semibold">ACTIVE (NO SIGNALS)</span>
        </div>
      </div>
    </div>
  );
};
