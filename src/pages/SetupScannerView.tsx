import React, { useState, useEffect, useMemo } from 'react';
import { 
  Radar, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Target, 
  Filter, 
  Sliders, 
  ChevronRight, 
  RefreshCw,
  Layers,
  Info,
  ShieldCheck
} from 'lucide-react';
import { marketService } from '../services/market-service';
import { Candle } from '../market-data/provider.interface';
import { XauUsdMarketIntelligence } from '../types/intelligence';
import { SetupRecord, ScannerSummary, SetupState, SetupFamily } from '../types/scanner';

interface SetupScannerViewProps {
  onBackToCommandCenter?: () => void;
}

export const SetupScannerView: React.FC<SetupScannerViewProps> = ({
  onBackToCommandCenter,
}) => {
  const [timeframe, setTimeframe] = useState<string>('15min');
  const [minRR, setMinRR] = useState<number>(2.0);
  const [statusFilter, setStatusFilter] = useState<'ALL' | SetupState>('ALL');
  const [familyFilter, setFamilyFilter] = useState<'ALL' | SetupFamily>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [intelligence, setIntelligence] = useState<XauUsdMarketIntelligence | null>(null);
  const [summary, setSummary] = useState<ScannerSummary | null>(null);
  const [selectedSetup, setSelectedSetup] = useState<SetupRecord | null>(null);

  // Fetch real candles and run deterministic scanner
  const runScan = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch verified Twelve Data candles
      const fetchedCandles = await marketService.getHistoricalCandles('XAU/USD', timeframe);
      setCandles(fetchedCandles || []);

      // 2. Fetch or compute real intelligence
      const fetchedIntel = await marketService.getXauUsdIntelligence(timeframe);
      setIntelligence(fetchedIntel);

      // 3. Run deterministic scanner
      if (fetchedIntel && fetchedIntel.status === 'VERIFIED' && fetchedCandles && fetchedCandles.length >= 10) {
        const scanResult = marketService.scanXauUsdCandles(fetchedIntel, fetchedCandles, { minRiskReward: minRR });
        setSummary(scanResult);
        if (scanResult.candidates.length > 0) {
          // Default select current setup or first candidate
          setSelectedSetup(scanResult.currentSetup || scanResult.candidates[0]);
        } else {
          setSelectedSetup(scanResult.currentSetup);
        }
      } else {
        // Run against empty intel or whatever is returned
        const scanResult = marketService.scanXauUsdCandles(
          fetchedIntel || {
            symbol: 'XAU/USD',
            timeframe: 'M15',
            status: 'INSUFFICIENT VERIFIED DATA',
            candleCount: 0,
            latestCandle: null,
            marketStructure: null,
            previousPeriodLevels: null,
            volatility: null,
            sessions: [],
            liquidityLevels: [],
            liquiditySweeps: [],
            displacements: [],
            fairValueGaps: [],
            structureEvents: [],
            multiTimeframeFacts: [],
            calculatedAt: new Date().toISOString(),
          },
          fetchedCandles || [],
          { minRiskReward: minRR }
        );
        setSummary(scanResult);
        setSelectedSetup(scanResult.currentSetup);
      }
    } catch (err) {
      console.error('Setup scanner execution error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runScan();
  }, [timeframe, minRR]);

  // Filtered candidate list
  const filteredCandidates = useMemo(() => {
    if (!summary) return [];
    const seen = new Set<string>();
    return summary.candidates.filter(c => {
      const matchStatus = statusFilter === 'ALL' || c.status === statusFilter;
      const matchFamily = familyFilter === 'ALL' || c.setupFamily === familyFilter;
      if (!matchStatus || !matchFamily) return false;
      if (seen.has(c.setupId)) return false;
      seen.add(c.setupId);
      return true;
    });
  }, [summary, statusFilter, familyFilter]);

  const getStatusBadge = (status: SetupState) => {
    switch (status) {
      case 'VALIDATED_CANDIDATE':
        return 'bg-emerald-950/80 border-emerald-700 text-emerald-300 font-bold';
      case 'SETUP_FORMING':
        return 'bg-cyan-950/80 border-cyan-700 text-cyan-300 font-bold';
      case 'WATCH':
        return 'bg-amber-950/80 border-amber-700 text-amber-300';
      case 'INVALIDATED':
        return 'bg-rose-950/60 border-rose-800/80 text-rose-400 line-through';
      case 'EXPIRED':
        return 'bg-slate-900 border-slate-700 text-slate-500';
      case 'NO_SETUP':
      default:
        return 'bg-slate-900 border-slate-700 text-slate-400';
    }
  };

  const getConfluenceBadge = (res: string) => {
    if (res === 'PASS') {
      return <span className="px-1.5 py-0.2 bg-emerald-950 border border-emerald-800 text-emerald-400 text-[9px] font-bold">PASS</span>;
    }
    if (res === 'FAIL') {
      return <span className="px-1.5 py-0.2 bg-rose-950/60 border border-rose-900 text-rose-400 text-[9px]">FAIL</span>;
    }
    return <span className="px-1.5 py-0.2 bg-slate-900 border border-slate-800 text-slate-500 text-[9px]">N/A</span>;
  };

  return (
    <div id="page-setup-scanner" className="flex flex-col h-full bg-[#070b13] text-slate-200 overflow-hidden font-mono">
      {/* 1. TOP HEADER & TELEMETRY */}
      <div className="p-3 bg-[#0c121e] border-b border-[#18263a] flex flex-wrap items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#121c2e] border border-[#1e304b] text-cyan-400">
            <Radar className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wider text-slate-100 uppercase">
                XAU/USD DETERMINISTIC SETUP SCANNER
              </h1>
              <span className="px-2 py-0.5 text-[10px] bg-cyan-950/80 border border-cyan-700 text-cyan-300 font-semibold">
                PHASE 3B
              </span>
              <span className="px-2 py-0.5 text-[10px] bg-amber-950/80 border border-amber-700 text-amber-300 font-semibold flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-amber-400" />
                ZERO FABRICATION • NO FORCED TRADES
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Strict rule-defined sequence validation over verified Twelve Data OHLCV candles. Zero predictive AI or synthetic trades.
            </p>
          </div>
        </div>

        {/* Controls & Configuration */}
        <div className="flex items-center gap-2">
          {/* Timeframe */}
          <div className="flex items-center gap-1 bg-[#0e1626] border border-[#1b2a40] px-2 py-1 text-xs">
            <span className="text-slate-500 text-[10px] uppercase">TF:</span>
            <select
              id="scanner-timeframe-select"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="bg-transparent text-cyan-400 text-xs font-mono focus:outline-none cursor-pointer"
            >
              <option value="5min">M5 (5min)</option>
              <option value="15min">M15 (15min)</option>
              <option value="30min">M30 (30min)</option>
              <option value="1h">H1 (1hour)</option>
              <option value="4h">H4 (4hour)</option>
              <option value="1day">D1 (1day)</option>
            </select>
          </div>

          {/* Min R:R configuration */}
          <div className="flex items-center gap-1.5 bg-[#0e1626] border border-[#1b2a40] px-2 py-1 text-xs">
            <Sliders className="w-3 h-3 text-slate-400" />
            <span className="text-slate-500 text-[10px] uppercase">Min R:R:</span>
            <select
              id="scanner-min-rr-select"
              value={minRR}
              onChange={(e) => setMinRR(parseFloat(e.target.value))}
              className="bg-transparent text-amber-300 text-xs font-mono focus:outline-none cursor-pointer font-bold"
            >
              <option value="1.5">1.5 : 1</option>
              <option value="2.0">2.0 : 1 (Default)</option>
              <option value="2.5">2.5 : 1</option>
              <option value="3.0">3.0 : 1</option>
            </select>
          </div>

          {/* Refresh button */}
          <button
            id="scanner-refresh-btn"
            onClick={runScan}
            disabled={isLoading}
            className="p-1.5 bg-[#121c2e] hover:bg-[#182740] border border-[#1f3352] text-slate-300 hover:text-cyan-400 transition-colors flex items-center gap-1 text-xs"
            title="Re-run Scanner"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline text-[10px]">SCAN</span>
          </button>
        </div>
      </div>

      {/* 2. SCANNER STATUS BANNER */}
      <div className="px-4 py-2 bg-[#090e18] border-b border-[#141f30] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[11px]">SCANNER OUTCOME:</span>
            <span className={`px-2.5 py-0.5 border font-bold tracking-wider text-[11px] ${
              summary?.status === 'VALIDATED_CANDIDATES_FOUND'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                : 'bg-[#121824] border-[#223048] text-amber-400'
            }`}>
              {summary?.status || 'RUNNING SCAN...'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Validated: <strong className="text-emerald-400">{summary?.validatedCount ?? 0}</strong></span>
            <span>•</span>
            <span>Forming: <strong className="text-cyan-400">{summary?.formingCount ?? 0}</strong></span>
            <span>•</span>
            <span>Watch: <strong className="text-amber-400">{summary?.watchCount ?? 0}</strong></span>
            <span>•</span>
            <span>Invalidated: <strong className="text-rose-400">{summary?.invalidatedCount ?? 0}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
          <span className="px-2 py-0.5 bg-[#0e1420] border border-[#1b2638] text-emerald-400">
            PAPER TRADES CREATED: 0 (DISABLED)
          </span>
          <span className="text-slate-400">
            {candles.length} BARS VERIFIED
          </span>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE: CANDIDATES TABLE + EVIDENCE PANEL */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* LEFT COLUMN: TABLE OF CANDIDATES (7 cols) */}
        <div className="lg:col-span-7 flex flex-col border-r border-[#152030] overflow-hidden">
          {/* Filters row */}
          <div className="p-2 bg-[#0a101c] border-b border-[#152030] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Filter className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] text-slate-400 uppercase">Filter:</span>
              <div className="flex items-center gap-1">
                {(['ALL', 'VALIDATED_CANDIDATE', 'SETUP_FORMING', 'WATCH', 'INVALIDATED'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-1.5 py-0.5 text-[9px] border transition-colors ${
                      statusFilter === st 
                        ? 'bg-cyan-950/80 border-cyan-600 text-cyan-300 font-bold' 
                        : 'bg-[#0e1524] border-[#182438] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'VALIDATED_CANDIDATE' ? 'VALIDATED' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <span className="text-[10px] text-slate-500">
              {filteredCandidates.length} candidate(s)
            </span>
          </div>

          {/* Candidates Table */}
          <div className="flex-1 overflow-y-auto">
            {filteredCandidates.length === 0 ? (
              <div id="no-validated-setup-banner" className="p-8 text-center flex flex-col items-center justify-center gap-3 my-auto h-full">
                <div className="w-12 h-12 bg-[#0e1626] border border-[#1b2b42] flex items-center justify-center text-amber-400">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="text-sm font-bold tracking-wider text-slate-200 uppercase">
                  NO VALIDATED SETUP
                </div>
                <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                  Market conditions do not currently satisfy all 9 quantitative criteria 
                  (liquidity sweep, structural BOS/CHOCH, displacement, FVG retest, R:R &ge; {minRR}:1). 
                  The system will never invent or force trade ideas.
                </p>
                <div className="p-3 bg-[#0d1422] border border-[#18263a] text-left text-[11px] text-slate-400 max-w-md space-y-1 mt-2">
                  <div className="font-semibold text-slate-300 mb-1 text-[10px] uppercase tracking-wider">
                    Current Evaluation State:
                  </div>
                  <div className="text-amber-400">
                    • {summary?.currentSetup?.statusReason || 'Missing confirmed liquidity sweep or structure breakout.'}
                  </div>
                  <div className="text-slate-500">
                    • Market Regime: <span className="text-slate-400">{intelligence?.marketStructure?.rangeState || 'Awaiting bars'}</span>
                  </div>
                  <div className="text-slate-500">
                    • Volatility: <span className="text-slate-400">{intelligence?.volatility?.classification || 'NORMAL'} (ATR ${intelligence?.volatility?.atr?.toFixed(2) || '0.00'})</span>
                  </div>
                </div>
              </div>
            ) : (
              <table id="scanner-candidates-table" className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#0b121e] border-b border-[#182538] text-[10px] text-slate-400 uppercase tracking-wider select-none sticky top-0 z-10">
                    <th className="p-2 pl-3">Time</th>
                    <th className="p-2">Symbol</th>
                    <th className="p-2">Setup / Dir</th>
                    <th className="p-2">Entry</th>
                    <th className="p-2">SL</th>
                    <th className="p-2">Target</th>
                    <th className="p-2">R:R</th>
                    <th className="p-2">Confluence</th>
                    <th className="p-2 pr-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#131d2c]">
                  {filteredCandidates.map((cand, idx) => {
                    const isSelected = selectedSetup?.setupId === cand.setupId;
                    const isBull = cand.direction === 'BULLISH';
                    return (
                      <tr
                        key={`${cand.setupId}-${idx}`}
                        id={`setup-row-${cand.setupId}`}
                        onClick={() => setSelectedSetup(cand)}
                        className={`cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-[#142138] border-l-2 border-cyan-400' 
                            : 'hover:bg-[#0c1322]'
                        }`}
                      >
                        <td className="p-2 pl-3 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                          {cand.createdAt ? cand.createdAt.substring(11, 16) : 'LIVE'}
                        </td>
                        <td className="p-2 font-mono font-bold text-slate-200">
                          {cand.symbol}
                          <span className="ml-1 text-[9px] text-slate-500">({cand.timeframe})</span>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            {isBull ? (
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )}
                            <div>
                              <div className={`font-semibold text-[11px] ${isBull ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {cand.direction}
                              </div>
                              <div className="text-[9px] text-slate-500">
                                {cand.setupFamily === 'LIQUIDITY_SWEEP_REVERSAL' ? 'SWEEP REV' : 'BRK RETEST'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 font-mono text-slate-200 text-[11px]">
                          ${cand.risk.entryReference ? cand.risk.entryReference.toFixed(2) : '---'}
                        </td>
                        <td className="p-2 font-mono text-rose-400 text-[11px]">
                          ${cand.risk.stopLossReference ? cand.risk.stopLossReference.toFixed(2) : '---'}
                        </td>
                        <td className="p-2 font-mono text-emerald-400 text-[11px]">
                          ${cand.risk.targetReference ? cand.risk.targetReference.toFixed(2) : '---'}
                        </td>
                        <td className="p-2 font-mono font-bold text-[11px]">
                          {cand.risk.riskRewardRatio ? (
                            <span className={cand.risk.riskRewardRatio >= minRR ? 'text-emerald-400' : 'text-amber-400'}>
                              {cand.risk.riskRewardRatio.toFixed(1)}:1
                            </span>
                          ) : (
                            <span className="text-slate-600">---</span>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <span title="Liquidity" className={`w-2 h-2 ${cand.validation.confluence.liquidity === 'PASS' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                            <span title="Structure" className={`w-2 h-2 ${cand.validation.confluence.structure === 'PASS' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                            <span title="Displacement" className={`w-2 h-2 ${cand.validation.confluence.displacement === 'PASS' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                            <span title="FVG" className={`w-2 h-2 ${cand.validation.confluence.fvg === 'PASS' ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                            <span title="Retest" className={`w-2 h-2 ${cand.validation.confluence.retest === 'PASS' ? 'bg-emerald-400' : 'bg-amber-500'}`} />
                            <span title="R:R" className={`w-2 h-2 ${cand.validation.confluence.riskReward === 'PASS' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                          </div>
                        </td>
                        <td className="p-2 pr-3 text-right">
                          <span className={`px-2 py-0.5 border text-[9px] tracking-wider uppercase inline-block ${getStatusBadge(cand.status)}`}>
                            {cand.status === 'VALIDATED_CANDIDATE' ? 'VALIDATED' : cand.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: EVIDENCE PANEL (5 cols) */}
        <div id="scanner-evidence-panel" className="lg:col-span-5 flex flex-col bg-[#080d16] overflow-y-auto">
          <div className="p-3 bg-[#0d1422] border-b border-[#182638] flex items-center justify-between select-none">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase">
                SETUP EVIDENCE &amp; AUDIT TRAIL
              </h2>
            </div>
            {selectedSetup && (
              <span className={`px-2 py-0.5 border text-[9px] font-bold ${getStatusBadge(selectedSetup.status)}`}>
                {selectedSetup.status.replace('_', ' ')}
              </span>
            )}
          </div>

          {!selectedSetup ? (
            <div className="p-8 text-center text-slate-500 text-xs my-auto">
              Select a candidate from the table to view the verified quantitative evidence chain.
            </div>
          ) : (
            <div className="p-4 space-y-4 text-xs font-mono">
              {/* Setup Overview */}
              <div className="p-3 bg-[#0c121e] border border-[#1b293d] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Setup ID:</span>
                  <span className="text-cyan-400 font-bold text-[11px]">{selectedSetup.setupId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Family:</span>
                  <span className="text-slate-200 font-semibold">{selectedSetup.setupFamily}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Direction:</span>
                  <span className={`font-bold ${selectedSetup.direction === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedSetup.direction}
                  </span>
                </div>
                <div className="p-2 bg-[#080c14] border border-[#172233] text-[11px] text-amber-400/90 leading-relaxed">
                  <strong>State Reason:</strong> {selectedSetup.statusReason}
                </div>
              </div>

              {/* 9 Evidence Items Chain */}
              <div className="space-y-2">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Rule-Defined Quantitative Evidence (All linked to verified bars):
                </div>

                {/* 1. Liquidity Evidence */}
                <div id="evidence-liquidity" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">1. Liquidity Evidence</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.liquidity)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Level: <strong className="text-slate-200">${selectedSetup.evidence.liquidityLevel ? selectedSetup.evidence.liquidityLevel.toFixed(2) : '---'}</strong>
                    {' '}(Source: {selectedSetup.evidence.liquiditySource || 'None'})
                  </div>
                </div>

                {/* 2. Sweep Evidence */}
                <div id="evidence-sweep" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">2. Sweep Evidence</span>
                    {getConfluenceBadge(selectedSetup.evidence.sweepDetected ? 'PASS' : 'FAIL')}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Sweep Detected: <span className={selectedSetup.evidence.sweepDetected ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                      {selectedSetup.evidence.sweepDetected ? 'YES' : 'NO'}
                    </span>
                    {selectedSetup.evidence.sweepHighOrLow && (
                      <span className="ml-2">
                        Peak/Trough: <strong>${selectedSetup.evidence.sweepHighOrLow.toFixed(2)}</strong>
                      </span>
                    )}
                  </div>
                  {selectedSetup.evidence.sweepDatetime && (
                    <div className="text-[10px] text-slate-500">
                      Timestamp: {selectedSetup.evidence.sweepDatetime}
                    </div>
                  )}
                </div>

                {/* 3. Structure Evidence */}
                <div id="evidence-structure" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">3. Structure Evidence (BOS / CHOCH)</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.structure)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Event: <strong className="text-cyan-300">{selectedSetup.evidence.structureEvent || 'NONE CONFIRMED'}</strong>
                    {selectedSetup.evidence.brokenLevel && (
                      <span className="ml-2">Broken Level: ${selectedSetup.evidence.brokenLevel.toFixed(2)}</span>
                    )}
                  </div>
                  {selectedSetup.evidence.structureDatetime && (
                    <div className="text-[10px] text-slate-500">
                      Break Timestamp: {selectedSetup.evidence.structureDatetime}
                    </div>
                  )}
                </div>

                {/* 4. Displacement Evidence */}
                <div id="evidence-displacement" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">4. Displacement Evidence</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.displacement)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Displacement Bar: <span className={selectedSetup.evidence.displacementDetected ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                      {selectedSetup.evidence.displacementDetected ? 'CONFIRMED' : 'MISSING'}
                    </span>
                    {selectedSetup.evidence.displacementBodyRatio && (
                      <span className="ml-2">
                        Body/Range: <strong>{(selectedSetup.evidence.displacementBodyRatio * 100).toFixed(0)}% (&ge;65% req)</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* 5. FVG Evidence */}
                <div id="evidence-fvg" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">5. FVG Evidence</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.fvg)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {selectedSetup.evidence.fvgDetected ? (
                      <span>
                        Boundaries: <strong className="text-cyan-300">${selectedSetup.evidence.fvgLower?.toFixed(2)} - ${selectedSetup.evidence.fvgUpper?.toFixed(2)}</strong>
                      </span>
                    ) : (
                      <span className="text-slate-500">No Fair Value Gap identified post-trigger</span>
                    )}
                  </div>
                </div>

                {/* 6. Retest Evidence */}
                <div id="evidence-retest" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">6. Retest Evidence</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.retest)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Retest Touch: <span className={selectedSetup.evidence.retestDetected ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
                      {selectedSetup.evidence.retestDetected ? 'DETECTED' : 'PENDING'}
                    </span>
                    {selectedSetup.evidence.retestPrice && (
                      <span className="ml-2">At: ${selectedSetup.evidence.retestPrice.toFixed(2)}</span>
                    )}
                    {selectedSetup.evidence.retestHolds && (
                      <span className="ml-2 text-emerald-400 font-bold">(HELD)</span>
                    )}
                  </div>
                </div>

                {/* 7. Multi-TF Context */}
                <div id="evidence-multitf" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">7. Multi-TF Context</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.multiTimeframe)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Status: <strong className="text-slate-200 uppercase">{selectedSetup.validation.multiTimeframeContext}</strong>
                  </div>
                </div>

                {/* 8. Risk Calculation */}
                <div id="evidence-risk" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">8. Risk &amp; Reward Calculation</span>
                    {getConfluenceBadge(selectedSetup.validation.confluence.riskReward)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px] bg-[#080c14] p-2 border border-[#141e2e]">
                    <div>
                      <span className="text-slate-500 block">ENTRY ({selectedSetup.risk.entryType})</span>
                      <strong className="text-slate-200 text-[11px]">${selectedSetup.risk.entryReference?.toFixed(2) || '---'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">STOP LOSS</span>
                      <strong className="text-rose-400 text-[11px]">${selectedSetup.risk.stopLossReference?.toFixed(2) || '---'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">TARGET</span>
                      <strong className="text-emerald-400 text-[11px]">${selectedSetup.risk.targetReference?.toFixed(2) || '---'}</strong>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Risk Distance: ${selectedSetup.risk.riskDistance?.toFixed(2) || '---'}</span>
                    <span className="text-slate-400">Reward Distance: ${selectedSetup.risk.rewardDistance?.toFixed(2) || '---'}</span>
                    <span className="font-bold text-cyan-300">
                      R:R = {selectedSetup.risk.riskRewardRatio ? `${selectedSetup.risk.riskRewardRatio}:1` : '---'}
                    </span>
                  </div>
                </div>

                {/* 9. Invalidation Condition */}
                <div id="evidence-invalidation" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-semibold text-[11px]">9. Invalidation Condition</span>
                    <span className="text-[10px] text-rose-400 font-bold uppercase">MANDATORY RULE</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {selectedSetup.validation.invalidationCondition}
                  </p>
                  {selectedSetup.validation.isInvalidated && (
                    <div className="p-2 bg-rose-950/40 border border-rose-800 text-rose-300 text-[10px] mt-1 font-bold">
                      VIOLATION RECORDED: {selectedSetup.validation.invalidationReason}
                    </div>
                  )}
                </div>

                {/* 10. Lifecycle State History */}
                {selectedSetup.lifecycleSequence && selectedSetup.lifecycleSequence.length > 0 && (
                  <div id="evidence-lifecycle-history" className="p-2.5 bg-[#0b101c] border border-[#172336] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-semibold text-[11px]">10. Lifecycle History</span>
                      <span className="text-[9px] text-cyan-400 font-mono">
                        {selectedSetup.lifecycleSequence.length} STAGES
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {selectedSetup.lifecycleSequence.map((st, idx) => (
                        <React.Fragment key={idx}>
                          <span className={`px-2 py-0.5 border text-[9px] uppercase font-bold ${getStatusBadge(st)}`}>
                            {st === 'VALIDATED_CANDIDATE' ? 'VALIDATED' : st.replace('_', ' ')}
                          </span>
                          {idx < selectedSetup.lifecycleSequence.length - 1 && (
                            <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-500 pt-1">
                      Created: {selectedSetup.createdAt || 'N/A'} • Last Updated: {selectedSetup.lastUpdated || 'N/A'}
                    </div>
                  </div>
                )}

                {/* 11. Three-Tier Provenance Audit Trail */}
                {selectedSetup.provenance && (
                  <div id="evidence-provenance-trail" className="p-2.5 bg-[#0a0f1a] border border-[#18283e] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-cyan-300 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                        Verifiable Evidence Provenance
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono">
                        OHLCV AUDITED
                      </span>
                    </div>

                    {/* Tier 1: Facts */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                        T1: Market Observation Facts ({selectedSetup.provenance.fact.length})
                      </span>
                      <div className="bg-[#060a12] p-2 border border-[#131d2c] space-y-1 max-h-28 overflow-y-auto">
                        {selectedSetup.provenance.fact.map((f, i) => (
                          <div key={i} className="text-[10px] text-slate-300 flex items-start gap-1">
                            <span className="text-cyan-500">•</span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Tier 2: Mathematical Calculations */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                        T2: Mathematical Calculations ({selectedSetup.provenance.calculation.length})
                      </span>
                      <div className="bg-[#060a12] p-2 border border-[#131d2c] space-y-1 max-h-28 overflow-y-auto">
                        {selectedSetup.provenance.calculation.map((c, i) => (
                          <div key={i} className="text-[10px] text-amber-300/90 flex items-start gap-1">
                            <span className="text-amber-500">•</span>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Tier 3: Model Classification Output */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">
                        T3: Deterministic Model Output
                      </span>
                      <div className="bg-[#060a12] p-2 border border-[#131d2c] text-[10px] text-emerald-300">
                        {selectedSetup.provenance.modelOutput}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. FOOTER: STRICT SAFETY & COMPLIANCE BAR */}
      <div className="px-4 py-2 bg-[#060a12] border-t border-[#141f30] text-[10px] text-slate-500 flex flex-wrap items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            ZERO SYNTHETIC DATA
          </span>
          <span>•</span>
          <span className="text-slate-400">AUDITED FEED: TWELVE DATA API</span>
          <span>•</span>
          <span className="text-amber-400">ALL SETUPS DETERMINISTIC</span>
        </div>
        <div className="text-slate-400">
          PROBABILITY CLAIMS PROHIBITED • NO AUTOMATED TRADES
        </div>
      </div>
    </div>
  );
};
