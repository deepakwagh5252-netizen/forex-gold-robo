import React, { useState, useEffect, useMemo } from 'react';
import { MarketOverviewPanel } from '../components/MarketOverviewPanel';
import { XauUsdFocusPanel } from '../components/XauUsdFocusPanel';
import { MarketSessionsPanel } from '../components/MarketSessionsPanel';
import { MarketIntelligencePanel } from '../components/MarketIntelligencePanel';
import { SetupStatusPanel } from '../components/SetupStatusPanel';
import { BottomPanel } from '../components/BottomPanel';
import { 
  InstrumentQuote, 
  MarketSessionInfo, 
  MarketIntelligenceMetrics, 
  SetupStatusInfo,
  ConnectionStatus,
  MarketDataStatus,
  NavigationPage,
} from '../types/terminal';
import { Candle, CandleSeriesMeta } from '../market-data/provider.interface';
import { ProviderTelemetry } from '../market-data/twelve-data-provider';
import { marketService } from '../services/market-service';
import { XauUsdMarketIntelligence } from '../types/intelligence';
import { xauUsdIntelligenceCoordinator } from '../intelligence/xau-usd-coordinator';
import { setupScannerEngine } from '../intelligence/setup-scanner-engine';
import { ScannerSummary } from '../types/scanner';
import { paperTradingEngine } from '../services/paper-trading/paper-trading-engine';
import { forwardPaperEngine } from '../services/paper-trading/forward-paper-engine';
import { PaperPosition, PaperTradeJournalEntry } from '../types/paper-trading';
import { ForwardPosition, ForwardTrade } from '../types/forward-validation';
import { SupportedChartTimeframe } from '../utils/candle-integrity';

interface CommandCenterProps {
  quotes: Record<string, InstrumentQuote>;
  sessions: MarketSessionInfo[];
  intelligence: MarketIntelligenceMetrics;
  setupStatus: SetupStatusInfo;
  connectionStatus: ConnectionStatus;
  marketDataStatus: MarketDataStatus;
  telemetry?: ProviderTelemetry | null;
  onRefresh?: () => void;
  onNavigate?: (page: NavigationPage) => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  quotes,
  sessions,
  intelligence,
  setupStatus,
  connectionStatus,
  marketDataStatus,
  telemetry = null,
  onRefresh,
  onNavigate,
}) => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('XAU/USD');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleMeta, setCandleMeta] = useState<CandleSeriesMeta | null>(null);
  const [candlesError, setCandlesError] = useState<string | null>(null);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(false);
  const [chartTimeframe, setChartTimeframe] = useState<SupportedChartTimeframe>('15m');
  const [xauIntelligence, setXauIntelligence] = useState<XauUsdMarketIntelligence | null>(null);
  const [openPositions, setOpenPositions] = useState<PaperPosition[]>(() => paperTradingEngine.getOpenPositions());
  const [tradeHistory, setTradeHistory] = useState<PaperTradeJournalEntry[]>(() => paperTradingEngine.getJournalService().getEntries());
  const [forwardTrades, setForwardTrades] = useState<ForwardTrade[]>(() => forwardPaperEngine.getTrades());
  const [forwardPositions, setForwardPositions] = useState<ForwardPosition[]>(() => forwardPaperEngine.getOpenPositions());

  // Subscribe to live paper trading positions & trades for chart trade overlay (STEP 7)
  useEffect(() => {
    const unsub = paperTradingEngine.subscribePositions((pos) => {
      setOpenPositions(pos);
      setTradeHistory(paperTradingEngine.getJournalService().getEntries());
    });
    return () => { unsub(); };
  }, []);

  // Subscribe to Phase 8 Forward Paper Engine trades and positions
  useEffect(() => {
    const unsubTrade = forwardPaperEngine.onTrade(() => {
      setForwardTrades(forwardPaperEngine.getTrades());
    });
    const unsubPos = forwardPaperEngine.onPositionOpened(() => {
      setForwardPositions(forwardPaperEngine.getOpenPositions());
    });
    const unsubStatus = forwardPaperEngine.onStatusChange(() => {
      setForwardTrades(forwardPaperEngine.getTrades());
      setForwardPositions(forwardPaperEngine.getOpenPositions());
    });
    return () => {
      unsubTrade();
      unsubPos();
      unsubStatus();
    };
  }, []);

  // Deterministic scanner state computed over verified Twelve Data feed
  const scannerSummary = useMemo<ScannerSummary | null>(() => {
    if (!xauIntelligence || !candles || candles.length === 0) return null;
    return setupScannerEngine.scan(xauIntelligence, candles);
  }, [xauIntelligence, candles]);

  // Active quote for selectedSymbol
  const activeQuote = quotes[selectedSymbol] || quotes['XAU/USD'] || {
    symbol: selectedSymbol,
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

  // Attempt to load verified candles when symbol or timeframe changes
  useEffect(() => {
    let isMounted = true;
    const loadCandles = async () => {
      setIsLoadingCandles(true);
      try {
        const series = await marketService.getCandleSeries(selectedSymbol, chartTimeframe);
        if (isMounted) {
          const verifiedBars = series.candles || [];
          setCandles(verifiedBars);
          setCandleMeta(series.meta || null);
          setCandlesError(series.error || (verifiedBars.length > 0 ? null : 'No verified candles returned'));
          
          // Execute objective market intelligence analysis on verified bars if XAU/USD
          if (selectedSymbol === 'XAU/USD' && verifiedBars.length > 0) {
            const intel = xauUsdIntelligenceCoordinator.analyze(verifiedBars, chartTimeframe);
            setXauIntelligence(intel);
          } else if (selectedSymbol !== 'XAU/USD') {
            setXauIntelligence(null);
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setCandles([]);
          setCandleMeta(null);
          setXauIntelligence(null);
          setCandlesError(err instanceof Error ? err.message : 'Error fetching candles');
        }
      } finally {
        if (isMounted) {
          setIsLoadingCandles(false);
        }
      }
    };

    loadCandles();
    return () => { isMounted = false; };
  }, [selectedSymbol, chartTimeframe]);

  return (
    <div 
      id="command-center-workspace"
      className="flex-1 flex flex-col overflow-y-auto bg-[#070b13] custom-scrollbar"
    >
      {/* Top and Middle Grid Panels */}
      <div className="p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
        
        {/* Left / Center 8 Columns (Panels 1 & 2) */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          {/* PANEL 1: MARKET OVERVIEW */}
          <div className="min-h-[220px]">
            <MarketOverviewPanel
              quotes={quotes}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
            />
          </div>

          {/* PANEL 2: XAU/USD & MARKET SUPERCHART FOCUS */}
          <div className="flex-1 min-h-[480px]">
            <XauUsdFocusPanel
              quote={activeQuote}
              activeSession="—"
              candles={candles}
              candlesError={candlesError}
              isLoadingCandles={isLoadingCandles}
              intelligence={xauIntelligence}
              meta={candleMeta}
              selectedSymbol={selectedSymbol}
              onSymbolChange={setSelectedSymbol}
              openPositions={openPositions}
              tradeHistory={tradeHistory}
              forwardTrades={forwardTrades}
              forwardPositions={forwardPositions}
              onTimeframeChange={(tf) => setChartTimeframe(tf as SupportedChartTimeframe)}
              onRefresh={onRefresh}
            />
          </div>
        </div>

        {/* Right 4 Columns (Panels 3, 4, 5) */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          {/* PANEL 3: MARKET SESSIONS */}
          <div className="min-h-[200px]">
            <MarketSessionsPanel
              sessions={sessions}
            />
          </div>

          {/* PANEL 4: MARKET INTELLIGENCE */}
          <div className="min-h-[200px]">
            <MarketIntelligencePanel
              metrics={intelligence}
              xauIntelligence={xauIntelligence}
            />
          </div>

          {/* PANEL 5: SETUP STATUS */}
          <div className="min-h-[220px]">
            <SetupStatusPanel
              setupStatus={setupStatus}
              scannerSummary={scannerSummary}
              onOpenScanner={() => onNavigate?.('setup_scanner')}
            />
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: FULL WIDTH TABS */}
      <div className="p-3 pt-0 mt-auto">
        <BottomPanel
          connectionStatus={connectionStatus}
          marketDataStatus={marketDataStatus}
          providerName="TWELVE DATA"
          telemetry={telemetry}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
};
