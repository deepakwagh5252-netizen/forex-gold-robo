import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Maximize2, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Clock, 
  SlidersHorizontal, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  Layers, 
  Activity, 
  Eye, 
  EyeOff, 
  TrendingUp, 
  TrendingDown, 
  Info,
  Calendar,
  BarChart2,
  Crosshair as CrosshairIcon,
  Tag
} from 'lucide-react';
import { Candle, CandleSeriesMeta } from '../../market-data/provider.interface';
import { PaperPosition, PaperTradeJournalEntry } from '../../types/paper-trading';
import { ForwardTrade, ForwardPosition } from '../../types/forward-validation';
import { ForwardPersistence } from '../../services/paper-trading/forward-persistence';
import { forwardPaperEngine } from '../../services/paper-trading/forward-paper-engine';
import { 
  SUPPORTED_CHART_TIMEFRAMES, 
  SupportedChartTimeframe, 
  SUPPORTED_TIMEZONES, 
  SupportedTimezone,
  formatCandleTimestamp,
  formatFullTimestampWithTz,
  TIMEFRAME_MAP
} from '../../utils/candle-integrity';
import { formatPrice, formatPercent } from '../../utils/formatters';

interface MarketSuperChartProps {
  symbol: string;
  onSymbolChange?: (symbol: string) => void;
  candles: Candle[];
  isLoading?: boolean;
  error?: string | null;
  meta?: CandleSeriesMeta | null;
  latestPrice?: number | null;
  selectedTimeframe: SupportedChartTimeframe;
  onTimeframeChange: (tf: SupportedChartTimeframe) => void;
  openPositions?: PaperPosition[];
  tradeHistory?: PaperTradeJournalEntry[];
  forwardTrades?: ForwardTrade[];
  forwardPositions?: ForwardPosition[];
  showTradeOverlaysDefault?: boolean;
  onRefresh?: () => void;
}

export const MarketSuperChart: React.FC<MarketSuperChartProps> = ({
  symbol,
  onSymbolChange,
  candles = [],
  isLoading = false,
  error = null,
  meta = null,
  latestPrice = null,
  selectedTimeframe,
  onTimeframeChange,
  openPositions = [],
  tradeHistory = [],
  forwardTrades = [],
  forwardPositions = [],
  showTradeOverlaysDefault = true,
  onRefresh,
}) => {
  // Chart Display Settings
  const [selectedTimezone, setSelectedTimezone] = useState<SupportedTimezone>('UTC');
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [showTrades, setShowTrades] = useState<boolean>(showTradeOverlaysDefault);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showComparisonTable, setShowComparisonTable] = useState<boolean>(false);
  const [showFwdJournalTable, setShowFwdJournalTable] = useState<boolean>(false);
  const [selectedTradeModal, setSelectedTradeModal] = useState<PaperPosition | PaperTradeJournalEntry | ForwardTrade | ForwardPosition | null>(null);

  // Canvas Viewport & Interaction State
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [visibleCount, setVisibleCount] = useState<number>(50);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartOffset, setDragStartOffset] = useState<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const availableSymbols = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY'];

  // Load persistent Phase 8 Forward Trade Journal
  const [fwdTrades, setFwdTrades] = useState<ForwardTrade[]>(() => {
    const persisted = ForwardPersistence.loadTrades();
    if (forwardTrades && forwardTrades.length > 0) {
      const map = new Map<string, ForwardTrade>();
      for (const t of persisted) map.set(t.tradeId, t);
      for (const t of forwardTrades) map.set(t.tradeId, t);
      return Array.from(map.values());
    }
    return persisted;
  });

  const [fwdPositions, setFwdPositions] = useState<ForwardPosition[]>(() => {
    if (forwardPositions && forwardPositions.length > 0) return forwardPositions;
    return Array.from(ForwardPersistence.loadPositions().values());
  });

  // Keep synchronized on prop changes
  useEffect(() => {
    if (forwardTrades && forwardTrades.length > 0) {
      setFwdTrades(prev => {
        const map = new Map<string, ForwardTrade>();
        for (const t of prev) map.set(t.tradeId, t);
        for (const t of forwardTrades) map.set(t.tradeId, t);
        return Array.from(map.values());
      });
    }
  }, [forwardTrades]);

  useEffect(() => {
    if (forwardPositions && forwardPositions.length > 0) {
      setFwdPositions(forwardPositions);
    }
  }, [forwardPositions]);

  // Subscribe to live forwardPaperEngine updates, storage, and navigation
  useEffect(() => {
    const refreshData = () => {
      setFwdTrades(ForwardPersistence.loadTrades());
      setFwdPositions(Array.from(ForwardPersistence.loadPositions().values()));
    };

    const unsubTrade = forwardPaperEngine.onTrade(refreshData);
    const unsubPos = forwardPaperEngine.onPositionOpened(refreshData);
    const unsubStatus = forwardPaperEngine.onStatusChange(refreshData);

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', refreshData);
      window.addEventListener('forward_paper_update', refreshData);
      window.addEventListener('popstate', refreshData);
    }

    return () => {
      unsubTrade();
      unsubPos();
      unsubStatus();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', refreshData);
        window.removeEventListener('forward_paper_update', refreshData);
        window.removeEventListener('popstate', refreshData);
      }
    };
  }, []);

  // Filter positions and trades for the active symbol
  const activeSymbolPositions = useMemo(() => {
    return openPositions.filter(p => p.symbol === symbol && p.status === 'OPEN');
  }, [openPositions, symbol]);

  const activeSymbolClosedTrades = useMemo(() => {
    return tradeHistory.filter(t => t.symbol === symbol).slice(-5); // last 5 closed trades
  }, [tradeHistory, symbol]);

  const activeSymbolForwardTrades = useMemo(() => {
    const norm = (s?: string) => (s || '').replace('/', '').toUpperCase();
    const target = norm(symbol);
    return fwdTrades.filter(t => {
      const tNorm = norm(t.symbol);
      if (!tNorm && target === 'XAUUSD') return true;
      return tNorm === target || (target === 'XAUUSD' && tNorm === 'XAUUSD');
    });
  }, [fwdTrades, symbol]);

  const activeSymbolForwardPositions = useMemo(() => {
    const norm = (s?: string) => (s || '').replace('/', '').toUpperCase();
    const target = norm(symbol);
    return fwdPositions.filter(p => {
      const pNorm = norm(p.symbol);
      if (!pNorm && target === 'XAUUSD') return true;
      return pNorm === target || (target === 'XAUUSD' && pNorm === 'XAUUSD');
    });
  }, [fwdPositions, symbol]);

  // Clickable trade zones on canvas for modal inspection
  const tradeClickZonesRef = useRef<Array<{
    x: number;
    y: number;
    radius: number;
    trade: ForwardTrade | ForwardPosition | PaperTradeJournalEntry | PaperPosition;
  }>>([]);

  // Determine decimal places for current symbol
  const decimals = useMemo(() => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('XAU')) return 2;
    return 5;
  }, [symbol]);

  // Ensure visibleCount stays in sensible bounds
  const clampedVisibleCount = useMemo(() => {
    if (candles.length === 0) return 50;
    return Math.max(10, Math.min(candles.length, visibleCount));
  }, [candles.length, visibleCount]);

  // Clamped pan offset
  const clampedPanOffset = useMemo(() => {
    if (candles.length <= clampedVisibleCount) return 0;
    const maxOffset = candles.length - clampedVisibleCount;
    return Math.max(0, Math.min(maxOffset, panOffset));
  }, [candles.length, clampedVisibleCount, panOffset]);

  // Slice visible candles
  const visibleCandles = useMemo(() => {
    if (candles.length === 0) return [];
    const endIndex = candles.length - clampedPanOffset;
    const startIndex = Math.max(0, endIndex - clampedVisibleCount);
    return candles.slice(startIndex, endIndex);
  }, [candles, clampedPanOffset, clampedVisibleCount]);

  // Min and Max prices in visible range
  const priceRange = useMemo(() => {
    if (visibleCandles.length === 0) return { min: 0, max: 1, range: 1 };
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    visibleCandles.forEach(c => {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    });

    // Also include trade levels if showTrades is active
    if (showTrades) {
      activeSymbolPositions.forEach(p => {
        if (p.entryPrice < min) min = p.entryPrice;
        if (p.entryPrice > max) max = p.entryPrice;
        if (p.stopLoss < min) min = p.stopLoss;
        if (p.stopLoss > max) max = p.stopLoss;
        if (p.takeProfit < min) min = p.takeProfit;
        if (p.takeProfit > max) max = p.takeProfit;
      });
    }

    // Include latest price
    if (latestPrice && latestPrice > 0) {
      if (latestPrice < min) min = latestPrice;
      if (latestPrice > max) max = latestPrice;
    }

    if (min === Infinity || max === -Infinity || min === max) {
      min = (latestPrice || 100) * 0.99;
      max = (latestPrice || 100) * 1.01;
    }

    // Add 5% top and bottom padding for breathing room
    const span = max - min;
    const padding = span * 0.08;
    return {
      min: min - padding,
      max: max + padding,
      range: span + padding * 2,
      maxVol: maxVol || 100,
    };
  }, [visibleCandles, showTrades, activeSymbolPositions, latestPrice]);

  // Active hover candle (or latest candle when not hovering)
  const activeHoverCandle = useMemo(() => {
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < visibleCandles.length) {
      return visibleCandles[hoverIndex];
    }
    return visibleCandles[visibleCandles.length - 1] || null;
  }, [hoverIndex, visibleCandles]);

  // Price conversion helpers
  const priceToY = useCallback((price: number, plotHeight: number, topPadding: number): number => {
    if (priceRange.range === 0) return plotHeight / 2;
    const ratio = (priceRange.max - price) / priceRange.range;
    return topPadding + ratio * plotHeight;
  }, [priceRange]);

  const yToPrice = useCallback((y: number, plotHeight: number, topPadding: number): number => {
    const ratio = (y - topPadding) / plotHeight;
    return priceRange.max - ratio * priceRange.range;
  }, [priceRange]);

  // Canvas Rendering Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle High-DPI screens
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Layout constants
    const rightScaleWidth = 72; // Width of Y-axis price scale
    const bottomScaleHeight = 24; // Height of X-axis time scale
    const topHeaderHeight = 4;
    const chartPlotWidth = width - rightScaleWidth;
    const totalPlotHeight = height - bottomScaleHeight - topHeaderHeight;
    const volHeight = showVolume ? Math.min(60, totalPlotHeight * 0.16) : 0;
    const pricePlotHeight = totalPlotHeight - volHeight;

    // 1. Clear background
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, width, height);

    if (visibleCandles.length === 0) {
      // Nothing to draw
      return;
    }

    // 2. Draw Price Gridlines & Y-Axis Labels
    const targetGridCount = 6;
    const rawStep = priceRange.range / targetGridCount;
    // Calculate nice step size
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalizedStep = rawStep / magnitude;
    let stepMultiple = 1;
    if (normalizedStep > 5) stepMultiple = 5;
    else if (normalizedStep > 2) stepMultiple = 2;
    const niceStep = stepMultiple * magnitude;

    const firstGridPrice = Math.ceil(priceRange.min / niceStep) * niceStep;

    ctx.lineWidth = 1;
    ctx.font = '10px monospace';

    for (let p = firstGridPrice; p <= priceRange.max; p += niceStep) {
      const y = priceToY(p, pricePlotHeight, topHeaderHeight);
      if (y >= topHeaderHeight && y <= topHeaderHeight + pricePlotHeight) {
        // Horizontal grid line
        ctx.strokeStyle = '#141d2e';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartPlotWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Y-axis label
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText(p.toFixed(decimals), chartPlotWidth + 6, y + 3.5);
      }
    }

    // Y-Axis scale divider
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(chartPlotWidth, 0);
    ctx.lineTo(chartPlotWidth, height - bottomScaleHeight);
    ctx.stroke();

    // 3. Draw Candlesticks & Volume Bars
    const candleCount = visibleCandles.length;
    const candleSlotWidth = chartPlotWidth / candleCount;
    const candleBodyWidth = Math.max(1.5, Math.min(candleSlotWidth * 0.72, 14));

    visibleCandles.forEach((c, i) => {
      const centerX = i * candleSlotWidth + candleSlotWidth / 2;
      const isBullish = c.close >= c.open;
      const primaryColor = isBullish ? '#089981' : '#f23645'; // TradingView green / red
      const wickColor = isBullish ? '#089981' : '#f23645';

      const highY = priceToY(c.high, pricePlotHeight, topHeaderHeight);
      const lowY = priceToY(c.low, pricePlotHeight, topHeaderHeight);
      const openY = priceToY(c.open, pricePlotHeight, topHeaderHeight);
      const closeY = priceToY(c.close, pricePlotHeight, topHeaderHeight);

      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);

      // Wick
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(centerX, highY);
      ctx.lineTo(centerX, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = primaryColor;
      ctx.fillRect(centerX - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);

      // Optional Volume Histogram
      if (showVolume && c.volume > 0 && priceRange.maxVol && priceRange.maxVol > 0) {
        const volRatio = Math.min(1, c.volume / priceRange.maxVol);
        const barHeight = volRatio * (volHeight - 6);
        const volY = topHeaderHeight + pricePlotHeight + volHeight - barHeight;

        ctx.fillStyle = isBullish ? 'rgba(8, 153, 129, 0.28)' : 'rgba(242, 54, 69, 0.28)';
        ctx.fillRect(centerX - candleBodyWidth / 2, volY, candleBodyWidth, barHeight);
      }

      // X-Axis Time Ticks (every N candles based on density)
      const tickStep = Math.max(4, Math.floor(candleCount / 7));
      if (i % tickStep === 0 || i === candleCount - 1) {
        // Vertical dashed grid line
        ctx.strokeStyle = '#111827';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, height - bottomScaleHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Time label on X-axis
        const timeLabel = formatCandleTimestamp(c.timestamp, selectedTimezone, selectedTimeframe);
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText(timeLabel, centerX, height - 7);
      }
    });

    // X-Axis scale divider
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, height - bottomScaleHeight);
    ctx.lineTo(width, height - bottomScaleHeight);
    ctx.stroke();

    // 4. Draw Latest Market Price Line
    const currentPriceToDraw = latestPrice || (visibleCandles[visibleCandles.length - 1]?.close ?? null);
    if (currentPriceToDraw) {
      const currentY = priceToY(currentPriceToDraw, pricePlotHeight, topHeaderHeight);
      if (currentY >= topHeaderHeight && currentY <= topHeaderHeight + pricePlotHeight) {
        const lastCandle = visibleCandles[visibleCandles.length - 1];
        const isUp = lastCandle ? currentPriceToDraw >= lastCandle.open : true;
        const color = isUp ? '#10b981' : '#f43f5e';

        // Horizontal ray
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, currentY);
        ctx.lineTo(chartPlotWidth, currentY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price badge on Y-axis
        ctx.fillStyle = color;
        ctx.fillRect(chartPlotWidth, currentY - 9, rightScaleWidth, 18);
        ctx.fillStyle = '#020617';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(currentPriceToDraw.toFixed(decimals), chartPlotWidth + 5, currentY + 3.5);
      }
    }

    // Reset clickable trade zones for interaction
    tradeClickZonesRef.current = [];

    // 5. Draw Paper Trade Overlays (STEP 7 + Phase 8 Forward Trades)
    if (showTrades) {
      // Helper: locate candle in visibleCandles for a given timestamp
      const findCandleIndex = (timestampMs: number): number => {
        if (!visibleCandles || visibleCandles.length === 0 || isNaN(timestampMs)) return -1;
        let interval = 15 * 60 * 1000;
        if (visibleCandles.length >= 2) {
          const diff = Math.abs(visibleCandles[1].timestamp - visibleCandles[0].timestamp);
          if (diff > 0) interval = diff;
        }
        // 1. Within candle duration [c.timestamp, c.timestamp + interval)
        for (let i = 0; i < visibleCandles.length; i++) {
          const cTs = visibleCandles[i].timestamp;
          if (timestampMs >= cTs && timestampMs < cTs + interval) {
            return i;
          }
        }
        // 2. Tolerance match (within interval * 0.6)
        for (let i = 0; i < visibleCandles.length; i++) {
          if (Math.abs(visibleCandles[i].timestamp - timestampMs) <= interval * 0.6) {
            return i;
          }
        }
        // 3. Fallback: closest within 3 bars
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < visibleCandles.length; i++) {
          const dist = Math.abs(visibleCandles[i].timestamp - timestampMs);
          if (dist < bestDist && dist <= interval * 3) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      // -------------------------------------------------------------
      // 5.1 PHASE 8 OPEN FORWARD POSITIONS
      // -------------------------------------------------------------
      activeSymbolForwardPositions.forEach(p => {
        const entryY = priceToY(p.entryPrice, pricePlotHeight, topHeaderHeight);
        if (entryY >= topHeaderHeight && entryY <= topHeaderHeight + pricePlotHeight) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, entryY);
          ctx.lineTo(chartPlotWidth, entryY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(chartPlotWidth - 125, entryY - 9, 120, 18);
          ctx.fillStyle = '#04101d';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`FWD ENTRY: ${p.entryPrice.toFixed(decimals)}`, chartPlotWidth - 121, entryY + 3.5);
        }

        if (p.stopLoss > 0) {
          const slY = priceToY(p.stopLoss, pricePlotHeight, topHeaderHeight);
          if (slY >= topHeaderHeight && slY <= topHeaderHeight + pricePlotHeight) {
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, slY);
            ctx.lineTo(chartPlotWidth, slY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#f43f5e';
            ctx.fillRect(chartPlotWidth - 115, slY - 9, 110, 18);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`FWD SL: ${p.stopLoss.toFixed(decimals)}`, chartPlotWidth - 111, slY + 3.5);
          }
        }

        if (p.takeProfit > 0) {
          const tpY = priceToY(p.takeProfit, pricePlotHeight, topHeaderHeight);
          if (tpY >= topHeaderHeight && tpY <= topHeaderHeight + pricePlotHeight) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, tpY);
            ctx.lineTo(chartPlotWidth, tpY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#10b981';
            ctx.fillRect(chartPlotWidth - 115, tpY - 9, 110, 18);
            ctx.fillStyle = '#04101d';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`FWD TP: ${p.takeProfit.toFixed(decimals)}`, chartPlotWidth - 111, tpY + 3.5);
          }
        }

        // On-candle entry marker for open position
        const entryTs = new Date(p.signalCandleTimeUtc || p.openedAt).getTime();
        const entryIdx = findCandleIndex(entryTs);
        if (entryIdx >= 0) {
          const entryX = entryIdx * candleSlotWidth + candleSlotWidth / 2;
          ctx.fillStyle = p.direction === 'LONG' ? '#10b981' : '#f43f5e';
          ctx.beginPath();
          if (p.direction === 'LONG') {
            ctx.moveTo(entryX, entryY + 3);
            ctx.lineTo(entryX - 6, entryY + 14);
            ctx.lineTo(entryX + 6, entryY + 14);
          } else {
            ctx.moveTo(entryX, entryY - 3);
            ctx.lineTo(entryX - 6, entryY - 14);
            ctx.lineTo(entryX + 6, entryY - 14);
          }
          ctx.closePath();
          ctx.fill();

          const badgeW = 138;
          const badgeH = 40;
          const badgeX = Math.max(badgeW / 2 + 2, Math.min(chartPlotWidth - badgeW / 2 - 2, entryX));
          const badgeY = p.direction === 'LONG'
            ? Math.min(topHeaderHeight + pricePlotHeight - badgeH - 2, entryY + 16)
            : Math.max(topHeaderHeight + 2, entryY - badgeH - 16);

          ctx.fillStyle = 'rgba(9, 13, 22, 0.94)';
          ctx.fillRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);

          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`FWD OPEN: ${p.direction} $${p.entryPrice.toFixed(decimals)}`, badgeX, badgeY + 11);

          ctx.fillStyle = '#cbd5e1';
          ctx.font = '7.5px monospace';
          ctx.fillText(`SL: $${p.stopLoss.toFixed(decimals)} | TP: $${p.takeProfit.toFixed(decimals)}`, badgeX, badgeY + 22);

          const execUtc = p.entryExecutedAtUtc ? p.entryExecutedAtUtc.replace('T', ' ').substring(0, 19) + ' UTC' : 'EXEC UTC';
          ctx.fillStyle = '#94a3b8';
          ctx.font = '6.8px monospace';
          ctx.fillText(`ID: ${p.positionId.slice(-14)} | ${execUtc}`, badgeX, badgeY + 33);

          tradeClickZonesRef.current.push({ x: entryX, y: entryY, radius: 24, trade: p });
        }
      });

      // -------------------------------------------------------------
      // 5.2 PHASE 8 PERMANENT FORWARD TRADES (ON-CANDLE MARKERS & P&L)
      // -------------------------------------------------------------
      activeSymbolForwardTrades.forEach(t => {
        const entryTs = new Date(t.signalCandleTimeUtc || t.entryExecutedAtUtc || t.openedAt).getTime();
        const exitTs = new Date(t.exitExecutedAtUtc || t.closedAt).getTime();
        const entryIdx = findCandleIndex(entryTs);
        const exitIdx = findCandleIndex(exitTs);
        const entryY = priceToY(t.entryPrice, pricePlotHeight, topHeaderHeight);
        const exitY = priceToY(t.exitPrice, pricePlotHeight, topHeaderHeight);
        const isWin = t.netPnL > 0;
        const tradeColor = isWin ? '#10b981' : '#f43f5e';

        // Connect entry to exit if both are visible
        if (entryIdx >= 0 && exitIdx >= 0) {
          const entryX = entryIdx * candleSlotWidth + candleSlotWidth / 2;
          const exitX = exitIdx * candleSlotWidth + candleSlotWidth / 2;
          ctx.strokeStyle = tradeColor;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(entryX, entryY);
          ctx.lineTo(exitX, exitY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // On-candle Entry Marker
        if (entryIdx >= 0) {
          const entryX = entryIdx * candleSlotWidth + candleSlotWidth / 2;
          ctx.fillStyle = t.direction === 'LONG' ? '#10b981' : '#f43f5e';
          ctx.beginPath();
          if (t.direction === 'LONG') {
            ctx.moveTo(entryX, entryY + 3);
            ctx.lineTo(entryX - 6, entryY + 14);
            ctx.lineTo(entryX + 6, entryY + 14);
          } else {
            ctx.moveTo(entryX, entryY - 3);
            ctx.lineTo(entryX - 6, entryY - 14);
            ctx.lineTo(entryX + 6, entryY - 14);
          }
          ctx.closePath();
          ctx.fill();

          // Full on-chart Entry Badge
          const badgeW = 138;
          const badgeH = 44;
          const badgeX = Math.max(badgeW / 2 + 2, Math.min(chartPlotWidth - badgeW / 2 - 2, entryX));
          const badgeY = t.direction === 'LONG'
            ? Math.min(topHeaderHeight + pricePlotHeight - badgeH - 2, entryY + 16)
            : Math.max(topHeaderHeight + 2, entryY - badgeH - 16);

          ctx.fillStyle = 'rgba(9, 13, 22, 0.94)';
          ctx.fillRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
          ctx.strokeStyle = t.direction === 'LONG' ? '#10b981' : '#f43f5e';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);

          // Line 1: Direction & Entry Price
          ctx.fillStyle = t.direction === 'LONG' ? '#34d399' : '#f87171';
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${t.direction === 'LONG' ? '▲' : '▼'} ${t.direction} ENTRY: $${t.entryPrice.toFixed(decimals)}`, badgeX, badgeY + 11);

          // Line 2: Initial SL / TP
          const slVal = (t.initialStopLoss || t.stopLoss || 0).toFixed(decimals);
          const tpVal = (t.initialTakeProfit || t.takeProfit || 0).toFixed(decimals);
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '7.5px monospace';
          ctx.fillText(`SL: $${slVal} | TP: $${tpVal}`, badgeX, badgeY + 22);

          // Line 3: Trade ID
          const shortId = t.tradeId.length > 20 ? t.tradeId.slice(-16) : t.tradeId;
          ctx.fillStyle = '#94a3b8';
          ctx.font = '7px monospace';
          ctx.fillText(`ID: ${shortId}`, badgeX, badgeY + 32);

          // Line 4: UTC Execution Timestamp
          const execUtc = t.entryExecutedAtUtc ? t.entryExecutedAtUtc.replace('T', ' ').substring(0, 19) + ' UTC' : 'EXEC UTC';
          ctx.fillStyle = '#38bdf8';
          ctx.font = '6.8px monospace';
          ctx.fillText(execUtc, badgeX, badgeY + 41);

          tradeClickZonesRef.current.push({ x: entryX, y: entryY, radius: 24, trade: t });
        }

        // On-candle Exit Marker
        if (exitIdx >= 0) {
          const exitX = exitIdx * candleSlotWidth + candleSlotWidth / 2;
          // Exit diamond pin
          ctx.fillStyle = tradeColor;
          ctx.beginPath();
          ctx.moveTo(exitX, exitY - 6);
          ctx.lineTo(exitX + 6, exitY);
          ctx.lineTo(exitX, exitY + 6);
          ctx.lineTo(exitX - 6, exitY);
          ctx.closePath();
          ctx.fill();

          // Full on-chart Exit Badge
          const badgeW = 142;
          const badgeH = 44;
          const badgeX = Math.max(badgeW / 2 + 2, Math.min(chartPlotWidth - badgeW / 2 - 2, exitX));
          const badgeY = exitY - badgeH - 14 < topHeaderHeight
            ? Math.min(topHeaderHeight + pricePlotHeight - badgeH - 2, exitY + 14)
            : exitY - badgeH - 14;

          ctx.fillStyle = isWin ? 'rgba(6, 78, 59, 0.95)' : 'rgba(136, 19, 55, 0.95)';
          ctx.fillRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);
          ctx.strokeStyle = tradeColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX - badgeW / 2, badgeY, badgeW, badgeH);

          // Line 1: Exit Price & Net PnL
          ctx.fillStyle = isWin ? '#a7f3d0' : '#fecdd3';
          ctx.font = 'bold 8.5px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`EXIT: $${t.exitPrice.toFixed(decimals)} (${t.netPnL >= 0 ? '+' : ''}$${t.netPnL.toFixed(2)})`, badgeX, badgeY + 11);

          // Line 2: Exit Reason
          ctx.fillStyle = '#f8fafc';
          ctx.font = '7.5px monospace';
          ctx.fillText(`REASON: ${t.exitReason || t.closeReason || 'CLOSED'}`, badgeX, badgeY + 22);

          // Line 3: Trade ID
          const shortId = t.tradeId.length > 20 ? t.tradeId.slice(-16) : t.tradeId;
          ctx.fillStyle = isWin ? '#6ee7b7' : '#fda4af';
          ctx.font = '7px monospace';
          ctx.fillText(`ID: ${shortId}`, badgeX, badgeY + 32);

          // Line 4: UTC Execution Timestamp
          const exitExecUtc = t.exitExecutedAtUtc ? t.exitExecutedAtUtc.replace('T', ' ').substring(0, 19) + ' UTC' : 'EXEC UTC';
          ctx.fillStyle = '#fef08a';
          ctx.font = '6.8px monospace';
          ctx.fillText(exitExecUtc, badgeX, badgeY + 41);

          tradeClickZonesRef.current.push({ x: exitX, y: exitY, radius: 24, trade: t });
        }
      });

      // -------------------------------------------------------------
      // 5.3 PHASE 4B PAPER TRADING POSITIONS & EXITS (PRESERVED)
      // -------------------------------------------------------------
      // A. Open Positions
      activeSymbolPositions.forEach(p => {
        const entryY = priceToY(p.entryPrice, pricePlotHeight, topHeaderHeight);
        if (entryY >= 0 && entryY <= height) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(0, entryY);
          ctx.lineTo(chartPlotWidth, entryY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#06b6d4';
          ctx.fillRect(chartPlotWidth - 120, entryY - 9, 115, 18);
          ctx.fillStyle = '#04101d';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`ENTRY: ${p.entryPrice.toFixed(decimals)}`, chartPlotWidth - 116, entryY + 3.5);
        }

        if (p.stopLoss > 0) {
          const slY = priceToY(p.stopLoss, pricePlotHeight, topHeaderHeight);
          if (slY >= 0 && slY <= height) {
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, slY);
            ctx.lineTo(chartPlotWidth, slY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#f43f5e';
            ctx.fillRect(chartPlotWidth - 110, slY - 9, 105, 18);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`SL: ${p.stopLoss.toFixed(decimals)}`, chartPlotWidth - 106, slY + 3.5);
          }
        }

        if (p.takeProfit > 0) {
          const tpY = priceToY(p.takeProfit, pricePlotHeight, topHeaderHeight);
          if (tpY >= 0 && tpY <= height) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, tpY);
            ctx.lineTo(chartPlotWidth, tpY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#10b981';
            ctx.fillRect(chartPlotWidth - 110, tpY - 9, 105, 18);
            ctx.fillStyle = '#04101d';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`TP: ${p.takeProfit.toFixed(decimals)}`, chartPlotWidth - 106, tpY + 3.5);
          }
        }
      });

      // B. Closed Trades (Recent Exits - Amber)
      activeSymbolClosedTrades.forEach(t => {
        const exitY = priceToY(t.exitPrice, pricePlotHeight, topHeaderHeight);
        if (exitY >= 0 && exitY <= height) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, exitY);
          ctx.lineTo(chartPlotWidth, exitY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#78350f';
          ctx.fillRect(chartPlotWidth - 110, exitY - 8, 105, 16);
          ctx.fillStyle = '#fde68a';
          ctx.font = '8px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`EXIT: ${t.exitPrice.toFixed(decimals)}`, chartPlotWidth - 106, exitY + 3);
        }
      });
    }

    // 6. Draw Crosshair Cursor (if hovering)
    if (isHovering && hoverIndex !== null && hoverIndex >= 0 && hoverIndex < candleCount && hoverY !== null) {
      const centerX = hoverIndex * candleSlotWidth + candleSlotWidth / 2;
      const hoveredCandle = visibleCandles[hoverIndex];

      // Vertical line
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height - bottomScaleHeight);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, hoverY);
      ctx.lineTo(chartPlotWidth, hoverY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price badge on Y-axis
      const hoveredPrice = yToPrice(hoverY, pricePlotHeight, topHeaderHeight);
      ctx.fillStyle = '#334155';
      ctx.fillRect(chartPlotWidth, hoverY - 9, rightScaleWidth, 18);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(hoveredPrice.toFixed(decimals), chartPlotWidth + 5, hoverY + 3.5);

      // Time badge on X-axis
      const timeStr = formatCandleTimestamp(hoveredCandle.timestamp, selectedTimezone, selectedTimeframe);
      ctx.fillStyle = '#334155';
      const badgeWidth = 70;
      ctx.fillRect(centerX - badgeWidth / 2, height - bottomScaleHeight, badgeWidth, bottomScaleHeight);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(timeStr, centerX, height - 7);
    }
  }, [
    visibleCandles, 
    priceRange, 
    showVolume, 
    showTrades, 
    latestPrice, 
    activeSymbolPositions, 
    activeSymbolClosedTrades, 
    isHovering, 
    hoverIndex, 
    hoverY, 
    selectedTimezone, 
    selectedTimeframe, 
    decimals, 
    priceToY, 
    yToPrice
  ]);

  // Window Resize Listener
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mouse & Touch Interaction Handlers
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rightScaleWidth = 72;
    const chartPlotWidth = rect.width - rightScaleWidth;

    if (x >= 0 && x <= chartPlotWidth && y >= 0 && y <= rect.height - 24) {
      setIsHovering(true);
      setHoverY(y);

      if (visibleCandles.length > 0) {
        const slotWidth = chartPlotWidth / visibleCandles.length;
        const index = Math.floor(x / slotWidth);
        const clampedIndex = Math.max(0, Math.min(visibleCandles.length - 1, index));
        setHoverIndex(clampedIndex);
      }
    } else {
      setIsHovering(false);
      setHoverIndex(null);
      setHoverY(null);
    }

    // Pan dragging
    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const candleSlotWidth = chartPlotWidth / clampedVisibleCount;
      const candleDelta = Math.round(dx / candleSlotWidth);
      setPanOffset(Math.max(0, dragStartOffset + candleDelta));
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if user clicked on any trade marker (zone)
      const hit = tradeClickZonesRef.current.find(zone => {
        const d = Math.hypot(clickX - zone.x, clickY - zone.y);
        return d <= zone.radius;
      });

      if (hit) {
        setSelectedTradeModal(hit.trade);
        return;
      }
    }

    if (e.button === 0) { // Left click
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartOffset(panOffset);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    setIsDragging(false);
    setHoverIndex(null);
    setHoverY(null);
  };

  // Zoom with Mouse Wheel
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? -5 : 5;
    setVisibleCount(prev => Math.max(10, Math.min(candles.length, prev + zoomFactor)));
  };

  // Manual Zoom In/Out
  const handleZoomIn = () => {
    setVisibleCount(prev => Math.max(10, Math.round(prev * 0.8)));
  };

  const handleZoomOut = () => {
    setVisibleCount(prev => Math.min(candles.length || 100, Math.round(prev * 1.25)));
  };

  const handleResetView = () => {
    setVisibleCount(50);
    setPanOffset(0);
  };

  // Hovered candle stats for top OHLC bar
  const ohlcData = useMemo(() => {
    if (!activeHoverCandle) return null;
    const isUp = activeHoverCandle.close >= activeHoverCandle.open;
    const changePts = activeHoverCandle.close - activeHoverCandle.open;
    const changePct = activeHoverCandle.open > 0 ? (changePts / activeHoverCandle.open) * 100 : 0;
    return {
      isUp,
      open: activeHoverCandle.open.toFixed(decimals),
      high: activeHoverCandle.high.toFixed(decimals),
      low: activeHoverCandle.low.toFixed(decimals),
      close: activeHoverCandle.close.toFixed(decimals),
      changePts: changePts > 0 ? `+${changePts.toFixed(decimals)}` : changePts.toFixed(decimals),
      changePct: changePct > 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`,
      volume: activeHoverCandle.volume.toLocaleString(),
      timeFormatted: formatFullTimestampWithTz(activeHoverCandle.timestamp, selectedTimezone),
      utcIso: new Date(activeHoverCandle.timestamp).toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
    };
  }, [activeHoverCandle, decimals, selectedTimezone]);

  // Data status styling (STEP 8)
  const freshnessInfo = useMemo(() => {
    const status = meta?.dataStatus || (candles.length > 0 ? 'HISTORICAL' : 'NONE');
    switch (status) {
      case 'LIVE':
        return { label: 'LIVE', bg: 'bg-emerald-950/80 border-emerald-800 text-emerald-300' };
      case 'CACHE':
        return { label: 'CACHE (FRESH)', bg: 'bg-cyan-950/80 border-cyan-800 text-cyan-300' };
      case 'RATE LIMITED':
        return { label: 'RATE LIMITED (PRESERVED)', bg: 'bg-amber-950/80 border-amber-800 text-amber-300' };
      case 'HISTORICAL':
      default:
        return { label: 'HISTORICAL', bg: 'bg-purple-950/80 border-purple-800 text-purple-300' };
    }
  }, [meta?.dataStatus, candles.length]);

  return (
    <div 
      id="market-super-chart-root"
      className="flex flex-col h-full bg-[#070b13] border border-[#1b263b] rounded select-none overflow-hidden"
    >
      {/* 1. TOP TOOLBAR: Symbol, Timeframes, Timezone, Tools */}
      <div 
        id="chart-top-toolbar"
        className="px-3 py-1.5 bg-[#0b101c] border-b border-[#1b263b] flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
      >
        {/* Left: Symbol & Timeframe Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Symbol Selector */}
          <div className="flex items-center bg-[#111929] border border-[#23354f] rounded px-1.5 py-0.5">
            <span className="text-[10px] text-slate-500 mr-1">SYM</span>
            <select
              id="chart-symbol-select"
              value={symbol}
              onChange={(e) => onSymbolChange?.(e.target.value)}
              className="bg-transparent text-amber-300 font-bold focus:outline-none cursor-pointer"
            >
              {availableSymbols.map(s => (
                <option key={s} value={s} className="bg-[#0b101c] text-slate-200">
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-[#1e293b]" />

          {/* Timeframe Buttons: 1m, 5m, 15m, 1h, 4h, 1D */}
          <div className="flex items-center gap-0.5 bg-[#0e1422] p-0.5 border border-[#1e293b] rounded">
            {SUPPORTED_CHART_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                id={`chart-tf-${tf}`}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 text-[11px] font-bold rounded transition-colors cursor-pointer ${
                  selectedTimeframe === tf
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#182338]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[#1e293b]" />

          {/* Timezone Selector (STEP 2) */}
          <div className="flex items-center gap-1 bg-[#111929] border border-[#23354f] rounded px-1.5 py-0.5">
            <Clock className="w-3 h-3 text-cyan-400" />
            <select
              id="chart-timezone-select"
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value as SupportedTimezone)}
              className="bg-transparent text-[11px] text-slate-300 focus:outline-none cursor-pointer"
            >
              {SUPPORTED_TIMEZONES.map(tz => (
                <option key={tz.id} value={tz.id} className="bg-[#0b101c] text-slate-200">
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: Data Status, Toggles & Zoom Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Freshness Status Badge (STEP 8) */}
          <span 
            id="chart-freshness-badge"
            className={`px-1.5 py-0.5 text-[10px] font-bold border rounded ${freshnessInfo.bg}`}
          >
            {freshnessInfo.label}
          </span>

          {/* Trade Overlays Toggle (STEP 7 + Phase 8 Forward Trades) */}
          <button
            id="chart-toggle-trades"
            onClick={() => setShowTrades(!showTrades)}
            className={`px-2 py-0.5 border text-[11px] rounded flex items-center gap-1 cursor-pointer ${
              showTrades
                ? 'bg-cyan-950/70 border-cyan-700 text-cyan-300'
                : 'bg-[#111929] border-[#22354e] text-slate-400'
            }`}
            title="Toggle Paper Trading Markers & Levels"
          >
            <Tag className="w-3 h-3" />
            TRADES ({activeSymbolPositions.length + activeSymbolForwardPositions.length + activeSymbolForwardTrades.length})
          </button>

          {/* Volume Toggle */}
          <button
            id="chart-toggle-volume"
            onClick={() => setShowVolume(!showVolume)}
            className={`px-2 py-0.5 border text-[11px] rounded flex items-center gap-1 cursor-pointer ${
              showVolume
                ? 'bg-purple-950/70 border-purple-700 text-purple-300'
                : 'bg-[#111929] border-[#22354e] text-slate-400'
            }`}
            title="Toggle Volume Sub-Pane"
          >
            <BarChart2 className="w-3 h-3" />
            VOL
          </button>

          {/* Zoom Buttons */}
          <div className="flex items-center bg-[#111929] border border-[#23354f] rounded">
            <button
              id="chart-zoom-in"
              onClick={handleZoomIn}
              className="px-1.5 py-0.5 text-slate-300 hover:text-white hover:bg-[#1a2942] cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              id="chart-zoom-out"
              onClick={handleZoomOut}
              className="px-1.5 py-0.5 text-slate-300 hover:text-white hover:bg-[#1a2942] cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              id="chart-reset-view"
              onClick={handleResetView}
              className="px-1.5 py-0.5 text-slate-300 hover:text-white hover:bg-[#1a2942] cursor-pointer"
              title="Reset View"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. OHLC INSPECTOR STRIP (Shows active candle facts) */}
      <div 
        id="chart-ohlc-strip"
        className="px-3 py-1 bg-[#090d17] border-b border-[#152033] flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 select-none"
      >
        {ohlcData ? (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-slate-300 font-semibold">
              <span className="text-cyan-400 mr-1">{symbol}</span>
              <span className="text-slate-500">[{selectedTimeframe}]</span>
            </div>
            <div>
              <span className="text-slate-500">TIME:</span>{' '}
              <span className="text-slate-300">{ohlcData.timeFormatted}</span>
            </div>
            <div>
              <span className="text-slate-500">O:</span>{' '}
              <span className={ohlcData.isUp ? 'text-emerald-400' : 'text-rose-400'}>{ohlcData.open}</span>
            </div>
            <div>
              <span className="text-slate-500">H:</span>{' '}
              <span className={ohlcData.isUp ? 'text-emerald-400' : 'text-rose-400'}>{ohlcData.high}</span>
            </div>
            <div>
              <span className="text-slate-500">L:</span>{' '}
              <span className={ohlcData.isUp ? 'text-emerald-400' : 'text-rose-400'}>{ohlcData.low}</span>
            </div>
            <div>
              <span className="text-slate-500">C:</span>{' '}
              <span className={`font-bold ${ohlcData.isUp ? 'text-emerald-400' : 'text-rose-400'}`}>{ohlcData.close}</span>
            </div>
            <div>
              <span className="text-slate-500">CHG:</span>{' '}
              <span className={`font-bold ${ohlcData.isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ohlcData.changePts} ({ohlcData.changePct})
              </span>
            </div>
            {showVolume && (
              <div>
                <span className="text-slate-500">VOL:</span>{' '}
                <span className="text-purple-300">{ohlcData.volume}</span>
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-500">Awaiting candle data...</span>
        )}

        {/* Candle Count indicator */}
        <div className="text-[10px] text-slate-500 flex items-center gap-2">
          <span>{visibleCandles.length}/{candles.length} BARS</span>
          {meta?.timezone && (
            <span className="text-cyan-500">TZ: {meta.timezone}</span>
          )}
        </div>
      </div>

      {/* 3. MAIN CANVAS VIEWPORT */}
      <div 
        ref={containerRef}
        id="chart-canvas-container"
        className="relative flex-1 w-full min-h-[340px] bg-[#070b13] overflow-hidden cursor-crosshair"
      >
        {/* If Error or Empty Candles: Safety state (STEP 11) */}
        {candles.length === 0 && !isLoading && (
          <div 
            id="chart-no-data-card"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-[#070b13]/90"
          >
            <div className="p-3 bg-amber-950/40 border border-amber-800 rounded-full mb-3 text-amber-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-bold tracking-wider text-slate-200 uppercase mb-1">
              MARKET DATA UNAVAILABLE
            </h3>
            <p className="text-xs text-slate-400 max-w-md mb-4 leading-relaxed font-mono">
              {error || 'Twelve Data candle feed is currently unavailable or awaiting rate limit budget reset. Synthetic candles and fabricated prices are strictly prohibited.'}
            </p>
            {onRefresh && (
              <button
                id="btn-retry-chart-feed"
                onClick={onRefresh}
                className="px-3 py-1.5 bg-[#1b263b] hover:bg-[#253654] border border-[#2d4264] text-cyan-300 text-xs font-mono font-bold rounded cursor-pointer"
              >
                REQUEST VERIFIED FEED
              </button>
            )}
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute top-2 right-20 z-10 px-2 py-1 bg-black/60 border border-cyan-800/80 rounded text-[10px] font-mono text-cyan-300 flex items-center gap-1.5 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            FETCHING NATIVE {selectedTimeframe} BARS...
          </div>
        )}

        {/* Interactive HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          id="market-super-chart-canvas"
          className="w-full h-full block"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
        />
      </div>

      {/* 4. BOTTOM ACCORDION STRIP: Diagnostics (STEP 9) & Platform Comparison (STEP 10) */}
      <div 
        id="chart-diagnostics-drawer"
        className="bg-[#090d16] border-t border-[#182338] text-xs font-mono select-none"
      >
        <div className="px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-400 border-b border-[#121c2d]">
          <div className="flex items-center gap-2">
            <button
              id="chart-btn-toggle-diagnostics"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
            >
              {showDiagnostics ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              <span className="font-bold">DATA INTEGRITY AUDIT</span>
            </button>

            <span className="text-slate-600">|</span>

            <button
              id="chart-btn-toggle-comparison"
              onClick={() => setShowComparisonTable(!showComparisonTable)}
              className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              <span>TRADINGVIEW COMPARISON BARS</span>
            </button>

            <span className="text-slate-600">|</span>

            <button
              id="chart-btn-toggle-fwd-journal"
              onClick={() => setShowFwdJournalTable(!showFwdJournalTable)}
              className={`flex items-center gap-1 cursor-pointer transition-colors ${
                showFwdJournalTable ? 'text-emerald-300 font-bold' : 'text-emerald-400 hover:text-emerald-300'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>PHASE 8 FWD JOURNAL ({activeSymbolForwardTrades.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span>Timezone: <strong className="text-slate-300">{selectedTimezone}</strong></span>
            <span>Feed: <strong className="text-emerald-400">VERIFIED TWELVE DATA</strong></span>
          </div>
        </div>

        {/* Phase 8 Forward Trade Journal Drawer Table */}
        {showFwdJournalTable && (
          <div 
            id="chart-fwd-journal-table-container"
            className="p-3 bg-[#080c14] border-t border-[#121c2d]"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                PERSISTENT PHASE 8 FORWARD TRADE JOURNAL ({activeSymbolForwardTrades.length} CLOSED TRADES)
              </div>
              <span className="text-[10px] text-slate-500">
                Restored from persistent storage • Click any row or chart pin for forensic audit
              </span>
            </div>

            {activeSymbolForwardTrades.length === 0 ? (
              <div className="text-slate-500 text-center py-4 text-xs font-mono">
                No closed Phase 8 forward trades recorded yet for {symbol}.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-56">
                <table className="w-full text-left border-collapse text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-[#1b273b] text-slate-400 bg-[#0c121e] sticky top-0">
                      <th className="py-1 px-2">TRADE ID</th>
                      <th className="py-1 px-2">DIR</th>
                      <th className="py-1 px-2 text-right">ENTRY</th>
                      <th className="py-1 px-2 text-right">EXIT</th>
                      <th className="py-1 px-2 text-right">SL</th>
                      <th className="py-1 px-2 text-right">TP</th>
                      <th className="py-1 px-2 text-right">NET P&amp;L</th>
                      <th className="py-1 px-2">REASON</th>
                      <th className="py-1 px-2">SIGNAL TIME (UTC)</th>
                      <th className="py-1 px-2">ENTRY EXEC (UTC)</th>
                      <th className="py-1 px-2">EXIT EXEC (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSymbolForwardTrades.slice().reverse().map((t, idx) => {
                      const isWin = t.netPnL >= 0;
                      return (
                        <tr 
                          key={`${t.tradeId || 'trade'}-${idx}`} 
                          onClick={() => setSelectedTradeModal(t)}
                          className="border-b border-[#141d2d] hover:bg-[#111929] cursor-pointer"
                          title="Click to view full trade verification details"
                        >
                          <td className="py-1 px-2 text-cyan-300 font-bold">{t.tradeId.length > 22 ? t.tradeId.slice(-18) : t.tradeId}</td>
                          <td className={`py-1 px-2 font-bold ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.direction}</td>
                          <td className="py-1 px-2 text-right text-slate-300">${t.entryPrice.toFixed(decimals)}</td>
                          <td className="py-1 px-2 text-right text-amber-300">${t.exitPrice.toFixed(decimals)}</td>
                          <td className="py-1 px-2 text-right text-rose-400">${(t.initialStopLoss || t.stopLoss).toFixed(decimals)}</td>
                          <td className="py-1 px-2 text-right text-emerald-400">${(t.initialTakeProfit || t.takeProfit).toFixed(decimals)}</td>
                          <td className={`py-1 px-2 text-right font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isWin ? '+' : ''}${t.netPnL.toFixed(2)}
                          </td>
                          <td className="py-1 px-2 text-slate-300">{t.exitReason || t.closeReason}</td>
                          <td className="py-1 px-2 text-slate-400">{t.signalCandleTimeUtc || '—'}</td>
                          <td className="py-1 px-2 text-slate-400">{t.entryExecutedAtUtc || '—'}</td>
                          <td className="py-1 px-2 text-slate-400">{t.exitExecutedAtUtc || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Diagnostic Panel Content (STEP 9) */}
        {showDiagnostics && (
          <div 
            id="chart-diagnostics-panel"
            className="p-3 bg-[#080c14] grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]"
          >
            <div className="p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Symbol &amp; Interval</span>
              <span className="font-bold text-slate-200 mt-0.5 block">{symbol} @ {selectedTimeframe} (Native: {TIMEFRAME_MAP[selectedTimeframe] || selectedTimeframe})</span>
            </div>
            <div className="p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Candle Count / Depth</span>
              <span className="font-bold text-slate-200 mt-0.5 block">{candles.length} Verified OHLC Bars</span>
            </div>
            <div className="p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Underlying Source Timezone</span>
              <span className="font-bold text-cyan-300 mt-0.5 block">UTC (Twelve Data Standard)</span>
            </div>
            <div className="p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Data Status &amp; Cache</span>
              <span className="font-bold text-emerald-300 mt-0.5 block">{meta?.dataStatus || 'VERIFIED'} (Cache: {meta?.isCached ? 'HIT' : 'DIRECT'})</span>
            </div>
            <div className="col-span-2 p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Latest Candle UTC Timestamp</span>
              <span className="font-bold text-slate-200 mt-0.5 block">
                {candles.length > 0 && candles[candles.length - 1]?.timestamp 
                  ? new Date(candles[candles.length - 1].timestamp).toISOString() 
                  : '—'}
              </span>
            </div>
            <div className="col-span-2 p-2 bg-[#0e1422] border border-[#1b273b] rounded">
              <span className="text-[10px] text-slate-500 uppercase block">Last Successful API Response</span>
              <span className="font-bold text-slate-200 mt-0.5 block">{meta?.lastFetchedAt || new Date().toISOString()}</span>
            </div>
          </div>
        )}

        {/* Platform Comparison Table (STEP 10) */}
        {showComparisonTable && (
          <div 
            id="chart-comparison-table-container"
            className="p-3 bg-[#080c14] border-t border-[#121c2d]"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                LATEST 5 BARS FOR MANUAL TRADINGVIEW COMPARISON
              </div>
              <span className="text-[10px] text-slate-500">
                Compare these values against TradingView ({symbol} on Twelve Data / OANDA spot)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-[#1b273b] text-slate-400 bg-[#0c121e]">
                    <th className="py-1 px-2">BAR #</th>
                    <th className="py-1 px-2">TIMESTAMP ({selectedTimezone})</th>
                    <th className="py-1 px-2">TIMESTAMP (UTC)</th>
                    <th className="py-1 px-2 text-right">OPEN</th>
                    <th className="py-1 px-2 text-right">HIGH</th>
                    <th className="py-1 px-2 text-right">LOW</th>
                    <th className="py-1 px-2 text-right">CLOSE</th>
                    <th className="py-1 px-2 text-right">VOLUME</th>
                  </tr>
                </thead>
                <tbody>
                  {candles.slice(-5).reverse().map((c, idx) => {
                    const isUp = c.close >= c.open;
                    return (
                      <tr key={idx} className="border-b border-[#141d2d] hover:bg-[#111929]">
                        <td className="py-1 px-2 text-slate-500 font-bold">#{candles.length - idx}</td>
                        <td className="py-1 px-2 text-slate-200">{formatCandleTimestamp(c.timestamp, selectedTimezone, selectedTimeframe)}</td>
                        <td className="py-1 px-2 text-slate-400">{new Date(c.timestamp).toISOString().replace('T', ' ').substring(0, 19)}</td>
                        <td className="py-1 px-2 text-right text-slate-300">{c.open.toFixed(decimals)}</td>
                        <td className="py-1 px-2 text-right text-emerald-400 font-medium">{c.high.toFixed(decimals)}</td>
                        <td className="py-1 px-2 text-right text-rose-400 font-medium">{c.low.toFixed(decimals)}</td>
                        <td className={`py-1 px-2 text-right font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {c.close.toFixed(decimals)}
                        </td>
                        <td className="py-1 px-2 text-right text-purple-300">{c.volume.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 5. TRADE DETAILS MODAL (STEP 7 + Phase 8 Audit) */}
      {selectedTradeModal && (() => {
        const m = selectedTradeModal as any;
        const isFwdTrade = Boolean(m.tradeId && m.signalCandleTimeUtc);
        const isFwdPos = Boolean(m.positionId && !m.exitPrice);
        const modalTitle = isFwdTrade ? 'PHASE 8 FORWARD TRADE DETAILS' : isFwdPos ? 'PHASE 8 FORWARD POSITION DETAILS' : 'PAPER TRADING DETAILS';

        return (
          <div 
            id="trade-details-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          >
            <div className="bg-[#0d1424] border border-[#22354f] max-w-lg w-full p-4 rounded-lg shadow-2xl font-mono text-xs max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-[#1c2a40] mb-3">
                <span className="font-bold text-cyan-400 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" />
                  {modalTitle}
                </span>
                <button 
                  onClick={() => setSelectedTradeModal(null)}
                  className="text-slate-400 hover:text-white cursor-pointer font-bold px-1.5"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between py-1 border-b border-[#141e30]">
                  <span className="text-slate-400">Trade / Position ID:</span>
                  <span className="font-bold text-slate-200 select-all text-[11px]">
                    {m.tradeId || m.positionId || '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#141e30]">
                  <span className="text-slate-400">Direction:</span>
                  <span className={`font-bold ${m.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {m.direction}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#141e30]">
                  <span className="text-slate-400">Entry Price:</span>
                  <span className="font-bold text-cyan-300">${Number(m.entryPrice || 0).toFixed(decimals)}</span>
                </div>
                {m.exitPrice !== undefined && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Exit Price:</span>
                    <span className="font-bold text-amber-300">${Number(m.exitPrice).toFixed(decimals)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-[#141e30]">
                  <span className="text-slate-400">Initial Stop Loss:</span>
                  <span className="font-bold text-rose-400">
                    ${Number(m.initialStopLoss || m.stopLoss || 0).toFixed(decimals)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#141e30]">
                  <span className="text-slate-400">Initial Take Profit:</span>
                  <span className="font-bold text-emerald-400">
                    ${Number(m.initialTakeProfit || m.takeProfit || 0).toFixed(decimals)}
                  </span>
                </div>
                {m.netPnL !== undefined ? (
                  <>
                    <div className="flex justify-between py-1 border-b border-[#141e30]">
                      <span className="text-slate-400">Net P&amp;L:</span>
                      <span className={`font-bold ${m.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.netPnL >= 0 ? '+' : ''}${Number(m.netPnL).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#141e30]">
                      <span className="text-slate-400">Gross P&amp;L:</span>
                      <span className="font-bold text-slate-300">${Number(m.grossPnL || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#141e30]">
                      <span className="text-slate-400">Total Fees / Comm:</span>
                      <span className="font-bold text-slate-300">${Number(m.fees || m.commission || m.totalFees || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-[#141e30]">
                      <span className="text-slate-400">Exit Reason:</span>
                      <span className="font-bold text-amber-400">{m.exitReason || m.closeReason || 'CLOSED'}</span>
                    </div>
                  </>
                ) : m.realizedPnL !== undefined ? (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Realized P&amp;L:</span>
                    <span className={`font-bold ${m.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${Number(m.realizedPnL).toFixed(2)}
                    </span>
                  </div>
                ) : null}

                {/* UTC Execution Timestamps */}
                {m.signalCandleTimeUtc && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Signal Candle Time (UTC):</span>
                    <span className="font-bold text-slate-300">{m.signalCandleTimeUtc}</span>
                  </div>
                )}
                {m.entryRequestedAtUtc && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Entry Requested (UTC):</span>
                    <span className="font-bold text-slate-300">{m.entryRequestedAtUtc}</span>
                  </div>
                )}
                {m.entryExecutedAtUtc && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Entry Executed (UTC):</span>
                    <span className="font-bold text-cyan-300">{m.entryExecutedAtUtc}</span>
                  </div>
                )}
                {m.exitRequestedAtUtc && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Exit Requested (UTC):</span>
                    <span className="font-bold text-slate-300">{m.exitRequestedAtUtc}</span>
                  </div>
                )}
                {m.exitExecutedAtUtc && (
                  <div className="flex justify-between py-1 border-b border-[#141e30]">
                    <span className="text-slate-400">Exit Executed (UTC):</span>
                    <span className="font-bold text-amber-300">{m.exitExecutedAtUtc}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-2 border-t border-[#1c2a40] flex justify-end">
                <button
                  onClick={() => setSelectedTradeModal(null)}
                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded cursor-pointer"
                >
                  CLOSE
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
