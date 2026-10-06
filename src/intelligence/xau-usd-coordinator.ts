import { Candle } from '../market-data/provider.interface';
import { 
  XauUsdMarketIntelligence, 
  MultiTimeframeFact,
  IntelligenceClassification 
} from '../types/intelligence';
import { marketStructureEngine } from './market-structure-engine';
import { volatilityEngine } from './volatility-engine';
import { liquidityEngine } from './liquidity-engine';
import { fvgDisplacementEngine } from './fvg-displacement-engine';

/**
 * XauUsdIntelligenceCoordinator
 * 
 * Central coordinator that transforms verified Twelve Data OHLCV bars into
 * objective market intelligence. Strictly adheres to:
 * - RULE: ZERO speculation / NO trade signals generated
 * - RULE: Preserves symbol, timeframe, candle timestamps, and verification status
 * - RULE: Categorizes data into FACT, CALCULATION, and MODEL_OUTPUT
 */
export class XauUsdIntelligenceCoordinator {
  /**
   * Main analysis entrypoint
   */
  public analyze(candles: Candle[], timeframe: string = 'M15'): XauUsdMarketIntelligence {
    if (!candles || candles.length < 5) {
      return {
        symbol: 'XAU/USD',
        timeframe,
        status: 'INSUFFICIENT VERIFIED DATA',
        candleCount: candles ? candles.length : 0,
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
        multiTimeframeFacts: this.getEmptyMultiTimeframeFacts(),
        calculatedAt: new Date().toISOString(),
      };
    }

    const latestCandle = candles[candles.length - 1];

    // 1. Market Structure (CALCULATION + MODEL_OUTPUT)
    const marketStructure = marketStructureEngine.analyzeStructure(candles, timeframe);

    // 2. Previous Period Levels (CALCULATION)
    const previousPeriodLevels = liquidityEngine.calculatePeriodLevels(candles);

    // 3. Volatility & ATR(14) (CALCULATION + MODEL_OUTPUT)
    const volatility = volatilityEngine.calculateATR(candles);

    // 4. Timezone-Aware Sessions (CALCULATION)
    const sessions = liquidityEngine.calculateSessions(candles);

    // 5. Liquidity Map & Sweeps (CALCULATION + MODEL_OUTPUT)
    const liquidityLevels = liquidityEngine.generateLiquidityMap(candles, previousPeriodLevels, sessions);
    const liquiditySweeps = liquidityEngine.detectSweeps(candles, liquidityLevels, timeframe);

    // 6. FVG & Displacement (CALCULATION + MODEL_OUTPUT)
    const fairValueGaps = fvgDisplacementEngine.detectFVGs(candles, timeframe);
    const displacements = fvgDisplacementEngine.detectDisplacement(candles, volatility.atr);

    // 7. Structure Events (BOS / CHOCH)
    const structureEvents = marketStructureEngine.detectStructureEvents(
      candles,
      marketStructure.swingHighs,
      marketStructure.swingLows,
      timeframe
    );

    // 8. Multi-Timeframe Structure facts
    const multiTimeframeFacts = this.buildMultiTimeframeFacts(candles, timeframe, marketStructure, volatility);

    return {
      symbol: 'XAU/USD',
      timeframe,
      status: 'VERIFIED',
      candleCount: candles.length,
      latestCandle,
      marketStructure,
      previousPeriodLevels,
      volatility,
      sessions,
      liquidityLevels,
      liquiditySweeps,
      displacements,
      fairValueGaps,
      structureEvents,
      multiTimeframeFacts,
      calculatedAt: new Date().toISOString(),
    };
  }

  private buildMultiTimeframeFacts(
    candles: Candle[], 
    activeTf: string,
    structure: ReturnType<typeof marketStructureEngine.analyzeStructure>,
    volatility: ReturnType<typeof volatilityEngine.calculateATR>
  ): MultiTimeframeFact[] {
    const timeframes: Array<'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'> = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    const latestTimestamp = candles[candles.length - 1]?.timestamp ?? null;

    return timeframes.map(tf => {
      if (tf === activeTf) {
        return {
          timeframe: tf,
          hasData: true,
          candleCount: candles.length,
          trend: structure.trendState,
          structure: structure.lastStructurePoint ? `${structure.lastStructurePoint} (${structure.rangeState})` : structure.rangeState,
          volatility: volatility.classification,
          atr: volatility.atr,
          liquidityState: structure.lastEvent ? `${structure.lastEvent.type} at $${structure.lastEvent.brokenLevel.toFixed(2)}` : 'Stable Levels',
          latestCandleTimestamp: latestTimestamp,
        };
      }

      // Prepare fact placeholder for remaining non-aggressively polled timeframes
      return {
        timeframe: tf,
        hasData: false,
        candleCount: 0,
        trend: 'UNDEFINED',
        structure: 'Awaiting verified cache slot',
        volatility: 'UNDEFINED',
        atr: null,
        liquidityState: 'Standby',
        latestCandleTimestamp: null,
      };
    });
  }

  private getEmptyMultiTimeframeFacts(): MultiTimeframeFact[] {
    const timeframes: Array<'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'> = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    return timeframes.map(tf => ({
      timeframe: tf,
      hasData: false,
      candleCount: 0,
      trend: 'UNDEFINED',
      structure: 'INSUFFICIENT VERIFIED DATA',
      volatility: 'UNDEFINED',
      atr: null,
      liquidityState: 'Standby',
      latestCandleTimestamp: null,
    }));
  }
}

export const xauUsdIntelligenceCoordinator = new XauUsdIntelligenceCoordinator();
