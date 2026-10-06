import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { twelveDataService } from './server/twelve-data-service';
import { telegramServerService } from './server/telegram-service';
import { TelegramMessageFormatter } from './src/services/notifications/telegram-message-formatter';
import { xauUsdIntelligenceCoordinator } from './src/intelligence/xau-usd-coordinator';
import { setupScannerEngine } from './src/intelligence/setup-scanner-engine';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'ForexGoldRobo Backend', timestamp: new Date().toISOString() });
  });

  // 2. Market Data Status endpoint (sanitized - never leaks API keys)
  app.get('/api/market-data/status', (req, res) => {
    try {
      const status = twelveDataService.getStatus();
      res.json(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error retrieving status';
      res.status(500).json({ status: 'error', error: message });
    }
  });

  // 3. Quotes endpoint (fetches real verified quotes from Twelve Data)
  app.get('/api/market-data/quotes', async (req, res) => {
    try {
      const force = req.query.force === 'true';
      const quotes = await twelveDataService.getQuotes(force);
      const rateLimit = twelveDataService.getRateLimitTelemetry();
      res.json({
        provider: 'Twelve Data',
        quotes,
        rateLimit,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error retrieving quotes';
      res.status(500).json({ status: 'error', error: message });
    }
  });

  // 4. Force manual refresh endpoint
  app.post('/api/market-data/refresh', async (req, res) => {
    try {
      const quotes = await twelveDataService.getQuotes(true);
      const status = twelveDataService.getStatus();
      const rateLimit = twelveDataService.getRateLimitTelemetry();
      res.json({
        success: true,
        quotes,
        status,
        rateLimit,
        refreshedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error during refresh';
      res.status(500).json({ success: false, error: message });
    }
  });

  // Telegram Notifications Endpoints (Phase 8A — Outbound Notification Only)
  app.get('/api/notifications/telegram/status', (req, res) => {
    res.json(telegramServerService.getStatus());
  });

  app.post('/api/notifications/telegram/send', async (req, res) => {
    try {
      const { text, eventId } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ success: false, error: 'text is required' });
      }
      const result = await telegramServerService.sendMessage(text, eventId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Error sending Telegram message' });
    }
  });

  app.post('/api/notifications/telegram/test', async (req, res) => {
    try {
      const nowUtc = new Date().toISOString();
      const testText = TelegramMessageFormatter.formatTestNotification(nowUtc);
      const result = await telegramServerService.sendMessage(testText, `TEST-${Date.now()}`);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Error sending test message' });
    }
  });

  // 5. Historical candle data endpoint
  app.get('/api/market-data/candles', async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || 'XAU/USD';
      const interval = (req.query.interval as string) || '15min';
      const result = await twelveDataService.getCandles(symbol, interval);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error retrieving candles';
      res.status(500).json({ candles: [], error: message, isVerified: false });
    }
  });

  // 6. Objective Market Intelligence endpoint (Phase 3A: XAU/USD only, strictly verified data)
  app.get('/api/market-data/intelligence', async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || 'XAU/USD';
      const interval = (req.query.interval as string) || '15min';

      // Always retrieve verified candles from Twelve Data via request manager
      const candleData = await twelveDataService.getCandles(symbol, interval);
      
      if (!candleData.isVerified || !candleData.candles || candleData.candles.length === 0) {
        const emptyIntel = xauUsdIntelligenceCoordinator.analyze([], interval);
        res.json({
          ...emptyIntel,
          error: candleData.error || 'INSUFFICIENT VERIFIED DATA',
          status: 'INSUFFICIENT VERIFIED DATA',
        });
        return;
      }

      const intelligence = xauUsdIntelligenceCoordinator.analyze(candleData.candles, interval);
      res.json(intelligence);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error computing market intelligence';
      res.status(500).json({
        symbol: 'XAU/USD',
        status: 'INSUFFICIENT VERIFIED DATA',
        error: message,
      });
    }
  });

  // 7. Deterministic Setup Scanner endpoint (Phase 3B: Zero synthetic setups, rule-defined)
  app.get('/api/scanner/xau-usd', async (req, res) => {
    try {
      const interval = (req.query.interval as string) || '15min';
      const minRR = req.query.minRR ? parseFloat(req.query.minRR as string) : 2.0;

      // Always retrieve verified candles from Twelve Data
      const candleData = await twelveDataService.getCandles('XAU/USD', interval);

      if (!candleData.isVerified || !candleData.candles || candleData.candles.length === 0) {
        const emptyIntel = xauUsdIntelligenceCoordinator.analyze([], interval);
        const summary = setupScannerEngine.scan(emptyIntel, [], { minRiskReward: minRR });
        res.json(summary);
        return;
      }

      const intelligence = xauUsdIntelligenceCoordinator.analyze(candleData.candles, interval);
      const summary = setupScannerEngine.scan(intelligence, candleData.candles, { minRiskReward: minRR });
      res.json(summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal error running setup scanner';
      res.status(500).json({
        symbol: 'XAU/USD',
        timeframe: (req.query.interval as string) || '15min',
        status: 'INSUFFICIENT_DATA',
        candidates: [],
        error: message,
        paperTradeCreated: false,
      });
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ForexGoldRobo] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ForexGoldRobo] Fatal server startup error:', err);
  process.exit(1);
});
