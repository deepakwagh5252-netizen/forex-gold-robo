import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { CommandCenter } from './pages/CommandCenter';
import { WatchlistView } from './pages/WatchlistView';
import { PaperTradingView } from './pages/PaperTradingView';
import { TradeJournalView } from './pages/TradeJournalView';
import { SettingsView } from './pages/SettingsView';
import { SetupScannerView } from './pages/SetupScannerView';
import { StrategyLabView } from './pages/StrategyLabView';
import { PhasePlaceholderView } from './pages/PhasePlaceholderView';
import { marketService } from './services/market-service';
import { NavigationPage, InstrumentQuote, ConnectionStatus, MarketDataStatus } from './types/terminal';
import { ProviderTelemetry } from './market-data/twelve-data-provider';

export default function App() {
  const [activePage, setActivePage] = useState<NavigationPage>('command_center');

  // Terminal state reactively bound to MarketService & TwelveDataMarketDataProvider
  const [quotes, setQuotes] = useState<Record<string, InstrumentQuote>>(() => marketService.getAllQuotes());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() => marketService.getConnectionStatus());
  const [marketDataStatus, setMarketDataStatus] = useState<MarketDataStatus>(() => marketService.getMarketDataStatus());
  const [telemetry, setTelemetry] = useState<ProviderTelemetry | null>(() => marketService.getTelemetry());
  
  const currentSession = 'UNKNOWN'; // Strict compliance with "Market Session: UNKNOWN initially"
  const sessions = marketService.getMarketSessions();
  const intelligence = marketService.getMarketIntelligence();
  const setupStatus = marketService.getSetupStatus();

  useEffect(() => {
    // Initiate controlled polling and connection on mount
    marketService.connect();

    // Subscribe to incoming quotes
    const unsubQuotes = marketService.onQuoteUpdate((updatedQuote) => {
      setQuotes((prev) => ({
        ...prev,
        [updatedQuote.symbol]: updatedQuote,
      }));
    });

    // Subscribe to status changes
    const unsubStatus = marketService.onStatusChange((status) => {
      setConnectionStatus(status);
      setMarketDataStatus(marketService.getMarketDataStatus());
    });

    // Subscribe to telemetry updates (countdown, polling status, errors)
    const unsubTelemetry = marketService.onTelemetryUpdate((updatedTelemetry) => {
      setTelemetry(updatedTelemetry);
      setMarketDataStatus(marketService.getMarketDataStatus());
      setQuotes(marketService.getAllQuotes());
    });

    return () => {
      unsubQuotes();
      unsubStatus();
      unsubTelemetry();
    };
  }, []);

  const handleRefresh = useCallback(() => {
    marketService.refreshNow();
  }, []);

  return (
    <div 
      id="forex-gold-robo-app"
      className="flex flex-col h-screen w-screen bg-[#070b13] text-slate-100 overflow-hidden font-mono antialiased"
    >
      {/* 1. TOP BAR (MANDATORY PROVIDER & LIVE / STALE / NOT CONNECTED BADGES) */}
      <TopBar
        providerName={marketService.getProviderName()}
        connectionStatus={connectionStatus}
        marketDataStatus={marketDataStatus}
        currentSession={currentSession}
        lastUpdated={telemetry?.lastUpdated}
        nextUpdateSeconds={telemetry?.nextUpdateSeconds}
        isPolling={telemetry?.isPolling}
        onRefresh={handleRefresh}
        rateLimitTelemetry={telemetry?.rateLimit}
      />

      {/* 2. MAIN LAYOUT: SIDEBAR + WORKSPACE */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT SIDEBAR (9 items) */}
        <Sidebar
          activePage={activePage}
          onSelectPage={setActivePage}
        />

        {/* WORKSPACE AREA */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#070b13] relative">
          {activePage === 'command_center' && (
            <CommandCenter
              quotes={quotes}
              sessions={sessions}
              intelligence={intelligence}
              setupStatus={setupStatus}
              connectionStatus={connectionStatus}
              marketDataStatus={marketDataStatus}
              telemetry={telemetry}
              onRefresh={handleRefresh}
              onNavigate={setActivePage}
            />
          )}

          {activePage === 'forex_watchlist' && (
            <WatchlistView
              quotes={quotes}
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'xau_usd' && (
            <PhasePlaceholderView
              pageId="xau_usd"
              pageTitle="XAU/USD SPOT GOLD FOCUS MODULE"
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'market_sessions' && (
            <PhasePlaceholderView
              pageId="market_sessions"
              pageTitle="MARKET SESSIONS &amp; LIQUIDITY RADAR"
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'setup_scanner' && (
            <SetupScannerView
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'strategy_lab' && (
            <StrategyLabView
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'paper_trading' && (
            <PaperTradingView
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'trade_journal' && (
            <TradeJournalView
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}

          {activePage === 'settings' && (
            <SettingsView
              connectionStatus={connectionStatus}
              marketDataStatus={marketDataStatus}
              onBackToCommandCenter={() => setActivePage('command_center')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
