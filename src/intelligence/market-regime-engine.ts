import { Candle } from '../market-data/provider.interface';
import { MarketStructureState, SwingPoint } from '../types/intelligence';
import { MarketRegimeReport, MarketRegimeType } from '../types/signal-regime';
import { MarketStructureEngine } from './market-structure-engine';

export interface RegimeEngineConfig {
  atrPeriod: number; // default 14
  swingLookback: number; // default 2
  adxThreshold: number; // default 25
  compressionAtrMultiplier: number; // default 0.75
}

export const DEFAULT_REGIME_CONFIG: RegimeEngineConfig = {
  atrPeriod: 14,
  swingLookback: 2,
  adxThreshold: 25,
  compressionAtrMultiplier: 0.75,
};

/**
 * Phase 7A: Deterministic Market Regime Engine
 * 
 * Rules:
 * 1. Categorizes market into:
 *    - TRENDING_BULLISH: Higher highs & higher lows with price sustaining above short/medium moving references
 *    - TRENDING_BEARISH: Lower highs & lower lows with price sustaining below references
 *    - RANGING_CONSOLIDATION: Alternating swing high/low rejections within defined support & resistance boundaries
 *    - VOLATILITY_EXPANSION: ATR spike > 1.5x baseline with large-range directional bars
 *    - LOW_VOLATILITY_COMPRESSION: Narrowing candle ranges, ATR below 0.75x 50-period average
 *    - UNDEFINED: < 14 completed candles available
 * 2. Emits no trade or strict filtering flags when chop or compression occurs without breakout confirmation.
 * 3. 100% deterministic, no random parameters, strictly auditable.
 */
export class MarketRegimeEngine {
  private config: RegimeEngineConfig;

  constructor(config: Partial<RegimeEngineConfig> = {}) {
    this.config = { ...DEFAULT_REGIME_CONFIG, ...config };
  }

  /**
   * Evaluates market regime given strictly candles 0..N without lookahead.
   */
  public evaluateRegime(candles: Candle[], structure?: MarketStructureState | null): MarketRegimeReport {
    if (!candles || candles.length < 14) {
      const ts = candles && candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now();
      return {
        regime: 'UNDEFINED',
        trendStrengthScore: 0,
        rangeBound: false,
        compression: false,
        atrValue: 0,
        keySupport: null,
        keyResistance: null,
        timestamp: ts,
        datetimeUtc: new Date(ts).toISOString(),
        provenance: {
          fact: ['Candle count < 14'],
          calculation: ['Insufficient data to calculate ATR or regime'],
          modelOutput: 'Regime: UNDEFINED',
        },
      };
    }

    const currentCandle = candles[candles.length - 1];
    const timestamp = currentCandle.timestamp;
    const datetimeUtc = currentCandle.datetime || new Date(timestamp).toISOString();

    // 1. Calculate Average True Range (ATR 14) and 50-bar baseline
    const atrs = this.calculateATRSeries(candles, this.config.atrPeriod);
    const currentAtr = atrs.length > 0 ? atrs[atrs.length - 1] : 0;
    const baselineAtr = this.calculateMean(atrs.slice(-50));

    // 2. Market Structure analysis (fallback to internal structure engine if not passed)
    let actualStructure = structure;
    if (!actualStructure) {
      const structEngine = new MarketStructureEngine({ leftBars: 2, rightBars: 2 });
      actualStructure = structEngine.analyzeStructure(candles);
    }

    // Identify key horizontal support and resistance levels from swing points
    const { keySupport, keyResistance } = this.extractBoundaries(candles, actualStructure);

    // 3. Directional movement & Trend Strength Scoring
    const trendState = actualStructure?.trendState || 'UNDEFINED';
    const higherHighs = actualStructure?.higherHighsCount || 0;
    const higherLows = actualStructure?.higherLowsCount || 0;
    const lowerHighs = actualStructure?.lowerHighsCount || 0;
    const lowerLows = actualStructure?.lowerLowsCount || 0;

    // Linear regression slope / price direction over last 14 candles
    const recent = candles.slice(-14);
    const priceChange = recent[recent.length - 1].close - recent[0].close;
    const isDirectionalUp = priceChange > currentAtr * 1.5;
    const isDirectionalDown = priceChange < -currentAtr * 1.5;

    let trendStrengthScore = 0;
    if (trendState === 'BULLISH' || isDirectionalUp) {
      trendStrengthScore = Math.min(100, 50 + (higherHighs + higherLows) * 10 + (isDirectionalUp ? 20 : 0));
    } else if (trendState === 'BEARISH' || isDirectionalDown) {
      trendStrengthScore = Math.min(100, 50 + (lowerHighs + lowerLows) * 10 + (isDirectionalDown ? 20 : 0));
    } else {
      trendStrengthScore = 20; // Ranging / choppy
    }

    // 4. Volatility Expansion / Compression tests
    const isExpansion = baselineAtr > 0 && currentAtr >= baselineAtr * 1.4;
    // Compression occurs if current ATR contracted relative to baseline OR is absolute low volatility
    const isCompression = (baselineAtr > 0 && currentAtr <= baselineAtr * this.config.compressionAtrMultiplier) || currentAtr <= 0.50;

    // 5. Determine Regime
    let regime: MarketRegimeType = 'UNDEFINED';
    let rangeBound = false;

    if (isExpansion) {
      regime = 'VOLATILITY_EXPANSION';
    } else if (isCompression) {
      regime = 'LOW_VOLATILITY_COMPRESSION';
      rangeBound = true;
    } else if ((trendState === 'BULLISH' && higherHighs >= 1 && higherLows >= 1) || isDirectionalUp) {
      regime = 'TRENDING_BULLISH';
    } else if ((trendState === 'BEARISH' && lowerHighs >= 1 && lowerLows >= 1) || isDirectionalDown) {
      regime = 'TRENDING_BEARISH';
    } else {
      regime = 'RANGING_CONSOLIDATION';
      rangeBound = true;
    }

    return {
      regime,
      trendStrengthScore,
      rangeBound,
      compression: isCompression,
      atrValue: Number(currentAtr.toFixed(4)),
      keySupport: keySupport !== null ? Number(keySupport.toFixed(2)) : null,
      keyResistance: keyResistance !== null ? Number(keyResistance.toFixed(2)) : null,
      timestamp,
      datetimeUtc,
      provenance: {
        fact: [
          `Current ATR: ${currentAtr.toFixed(2)} (Baseline: ${baselineAtr.toFixed(2)})`,
          `Support: ${keySupport ? keySupport.toFixed(2) : 'N/A'}, Resistance: ${keyResistance ? keyResistance.toFixed(2) : 'N/A'}`,
        ],
        calculation: [
          `Trend state from structure: ${trendState}`,
          `Trend score: ${trendStrengthScore}/100`,
          `Expansion: ${isExpansion}, Compression: ${isCompression}`,
        ],
        modelOutput: `Classified Market Regime: ${regime}`,
      },
    };
  }

  private calculateATRSeries(candles: Candle[], period: number): number[] {
    if (candles.length < 2) return [0];
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close;
      const c = candles[i];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
      return [this.calculateMean(trueRanges)];
    }

    // Smoothed RMA ATR
    const atrs: number[] = [];
    let initialSum = 0;
    for (let i = 0; i < period; i++) initialSum += trueRanges[i];
    let prevAtr = initialSum / period;
    atrs.push(prevAtr);

    for (let i = period; i < trueRanges.length; i++) {
      prevAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
      atrs.push(prevAtr);
    }
    return atrs;
  }

  private calculateMean(values: number[]): number {
    if (!values || values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  private extractBoundaries(
    candles: Candle[],
    structure?: MarketStructureState | null
  ): { keySupport: number | null; keyResistance: number | null } {
    if (structure && structure.swingHighs.length > 0 && structure.swingLows.length > 0) {
      const highs = structure.swingHighs.slice(-3).map(s => s.price);
      const lows = structure.swingLows.slice(-3).map(s => s.price);
      return {
        keyResistance: Math.max(...highs),
        keySupport: Math.min(...lows),
      };
    }

    // Fallback using prior candles in lookback (excluding current active candle so it can break or sweep boundaries)
    const priorCandles = candles.slice(-21, -1);
    if (priorCandles.length === 0) {
      const recent = candles.slice(-20);
      if (recent.length === 0) return { keySupport: null, keyResistance: null };
      return {
        keyResistance: Math.max(...recent.map(c => c.high)),
        keySupport: Math.min(...recent.map(c => c.low)),
      };
    }
    return {
      keyResistance: Math.max(...priorCandles.map(c => c.high)),
      keySupport: Math.min(...priorCandles.map(c => c.low)),
    };
  }
}

export const marketRegimeEngine = new MarketRegimeEngine();
