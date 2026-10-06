import { 
  PaperOrder, 
  PaperPosition,
  PaperRiskConfig,
  PaperRejectionReason
} from '../../types/paper-trading';
import { InstrumentQuote } from '../../types/terminal';
import { Candle } from '../../market-data/provider.interface';

export type FrictionStatus = 
  | 'VALID'
  | 'COMMISSION_NOT_CONFIGURED'
  | 'SPREAD_NOT_CONFIGURED'
  | 'SLIPPAGE_NOT_CONFIGURED';

export interface FrictionConfigEvaluation {
  isValid: boolean;
  status: FrictionStatus;
  errorMessage: string | null;
  commissionPerLot: number;
  commissionMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
  spreadPips: number;
  spreadMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
  slippagePips: number;
  slippageMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
}

export interface ExecutionResult {
  filled: boolean;
  executedPrice: number | null;
  error: string | null;
  rejectionReason: PaperRejectionReason | null;
  timestamp: string | null;
  source: string;
  newPosition: PaperPosition | null;
  slippagePips?: number;
  spreadPips?: number;
  commissionFee?: number;
  commissionMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  spreadMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
  slippageMode?: 'SIMULATION_CONFIGURED' | 'DISABLED';
}

export class PaperExecutionService {
  /**
   * Helper to determine pip value in price terms for a given symbol
   */
  static getPipSize(symbol: string): number {
    if (symbol.includes('JPY')) return 0.01;
    if (symbol.startsWith('XAU') || symbol.includes('GOLD')) return 0.1;
    return 0.0001;
  }

  /**
   * Evaluates simulation friction parameters explicitly.
   * STRICT INTEGRITY RULE: NO HIDDEN ASSUMPTIONS OR FALLBACK DEFAULTS.
   * If parameter is not configured, returns explicit blocked state.
   */
  static evaluateFrictionConfig(riskConfig?: Partial<PaperRiskConfig> | null): FrictionConfigEvaluation {
    // 1. Commission Evaluation
    let commissionPerLot = 0;
    let commissionMode: 'SIMULATION_CONFIGURED' | 'DISABLED' = 'DISABLED';

    if (riskConfig?.commissionDisabled === true || riskConfig?.commissionPerLot === 0) {
      commissionPerLot = 0;
      commissionMode = 'DISABLED';
    } else if (
      typeof riskConfig?.commissionPerLot === 'number' && 
      !isNaN(riskConfig.commissionPerLot) && 
      riskConfig.commissionPerLot > 0
    ) {
      commissionPerLot = riskConfig.commissionPerLot;
      commissionMode = 'SIMULATION_CONFIGURED';
    } else {
      return {
        isValid: false,
        status: 'COMMISSION_NOT_CONFIGURED',
        errorMessage: 'SIMULATION PARAMETER NOT CONFIGURED: Commission is unconfigured. Configure a value ($/lot) or select Commission OFF.',
        commissionPerLot: 0,
        commissionMode: 'DISABLED',
        spreadPips: 0,
        spreadMode: 'DISABLED',
        slippagePips: 0,
        slippageMode: 'DISABLED',
      };
    }

    // 2. Spread Evaluation
    let spreadPips = 0;
    let spreadMode: 'SIMULATION_CONFIGURED' | 'DISABLED' = 'DISABLED';

    if (riskConfig?.spreadDisabled === true || riskConfig?.spreadMarkupPips === 0) {
      spreadPips = 0;
      spreadMode = 'DISABLED';
    } else if (
      typeof riskConfig?.spreadMarkupPips === 'number' && 
      !isNaN(riskConfig.spreadMarkupPips) && 
      riskConfig.spreadMarkupPips > 0
    ) {
      spreadPips = riskConfig.spreadMarkupPips;
      spreadMode = 'SIMULATION_CONFIGURED';
    } else {
      return {
        isValid: false,
        status: 'SPREAD_NOT_CONFIGURED',
        errorMessage: 'SIMULATION PARAMETER NOT CONFIGURED: Spread is unconfigured. Configure pips or select Spread Simulation OFF.',
        commissionPerLot,
        commissionMode,
        spreadPips: 0,
        spreadMode: 'DISABLED',
        slippagePips: 0,
        slippageMode: 'DISABLED',
      };
    }

    // 3. Slippage Evaluation
    let slippagePips = 0;
    let slippageMode: 'SIMULATION_CONFIGURED' | 'DISABLED' = 'DISABLED';

    if (riskConfig?.slippageDisabled === true || riskConfig?.slippagePips === 0) {
      slippagePips = 0;
      slippageMode = 'DISABLED';
    } else if (
      typeof riskConfig?.slippagePips === 'number' && 
      !isNaN(riskConfig.slippagePips) && 
      riskConfig.slippagePips > 0
    ) {
      slippagePips = riskConfig.slippagePips;
      slippageMode = 'SIMULATION_CONFIGURED';
    } else {
      return {
        isValid: false,
        status: 'SLIPPAGE_NOT_CONFIGURED',
        errorMessage: 'SIMULATION PARAMETER NOT CONFIGURED: Slippage is unconfigured. Configure pips or select Slippage Simulation OFF.',
        commissionPerLot,
        commissionMode,
        spreadPips,
        spreadMode,
        slippagePips: 0,
        slippageMode: 'DISABLED',
      };
    }

    return {
      isValid: true,
      status: 'VALID',
      errorMessage: null,
      commissionPerLot,
      commissionMode,
      spreadPips,
      spreadMode,
      slippagePips,
      slippageMode,
    };
  }

  /**
   * Calculates realistic execution adjustment for spread and slippage.
   * Long buys at Ask (price + spread/2 + slippage), Short sells at Bid (price - spread/2 - slippage).
   */
  static calculateFillsWithFriction(
    rawPrice: number,
    direction: 'LONG' | 'SHORT',
    symbol: string,
    positionSize: number | null,
    riskConfig?: Partial<PaperRiskConfig> | null,
    isLimitFill: boolean = false,
    lotSize?: number | null
  ): {
    executedPrice: number;
    slippagePips: number;
    spreadPips: number;
    commissionFee: number;
    commissionMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
    spreadMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
    slippageMode: 'SIMULATION_CONFIGURED' | 'DISABLED';
    status: FrictionStatus;
    errorMessage: string | null;
  } {
    const pipSize = this.getPipSize(symbol);
    const frictionEval = this.evaluateFrictionConfig(riskConfig);

    const slippagePips = isLimitFill ? 0 : frictionEval.slippagePips;
    const spreadPips = frictionEval.spreadPips;
    const commissionPerLot = frictionEval.commissionPerLot;

    const halfSpreadPrice = (spreadPips / 2) * pipSize;
    const slippagePrice = slippagePips * pipSize;
    const totalFriction = halfSpreadPrice + slippagePrice;

    // BUY pays higher, SELL receives lower
    const executedPrice = direction === 'LONG'
      ? rawPrice + totalFriction
      : rawPrice - totalFriction;

    // Determine lot size for commission calculation:
    // Standard contract for Gold (XAU/USD) is 100 ounces per standard lot.
    // 1. If explicit lotSize is passed, use it directly.
    // 2. If contractSpecifications specifies contract size (e.g. 100 oz), lotSize = positionSize / contractSpec.
    // 3. For XAU/USD, if not specified, default to 100 oz per standard lot.
    // 4. For other symbols (e.g. FX pairs where positionSize is already in lots), lotSize = positionSize.
    let effectiveLotSize: number | null = null;
    if (typeof lotSize === 'number' && !isNaN(lotSize) && lotSize > 0) {
      effectiveLotSize = lotSize;
    } else if (positionSize && positionSize > 0) {
      const contractSpec = riskConfig?.contractSpecifications?.[symbol];
      if (typeof contractSpec === 'number' && contractSpec > 0) {
        effectiveLotSize = positionSize / contractSpec;
      } else if (symbol === 'XAU/USD') {
        effectiveLotSize = positionSize / 100;
      } else {
        effectiveLotSize = positionSize;
      }
    }

    const commissionFee = effectiveLotSize && effectiveLotSize > 0 && commissionPerLot > 0
      ? Number((effectiveLotSize * commissionPerLot).toFixed(2))
      : 0;

    return {
      executedPrice: Number(executedPrice.toFixed(4)),
      slippagePips,
      spreadPips,
      commissionFee,
      commissionMode: frictionEval.commissionMode,
      spreadMode: frictionEval.spreadMode,
      slippageMode: isLimitFill ? (frictionEval.slippageMode === 'SIMULATION_CONFIGURED' ? 'SIMULATION_CONFIGURED' : frictionEval.slippageMode) : frictionEval.slippageMode,
      status: frictionEval.status,
      errorMessage: frictionEval.errorMessage,
    };
  }

  /**
   * Attempts to execute a pending paper order against verified quote data.
   * Strictly enforces Section 7, 8, 18:
   * - No fabricated market prices
   * - Mode A (MARKET): Entry = latest verified executable market price + realistic friction
   * - Mode B (SETUP ENTRY): Entry = limit fill when verified market data confirms price condition.
   */
  static executeWithQuote(
    order: PaperOrder, 
    quote: InstrumentQuote | null | undefined,
    riskConfig?: Partial<PaperRiskConfig> | null
  ): ExecutionResult {
    // 1. Strict verified market observation check
    if (!quote || quote.ltp === null || quote.ltp === undefined || isNaN(quote.ltp) || quote.ltp <= 0) {
      return {
        filled: false,
        executedPrice: null,
        error: 'ORDER NOT FILLED: NO VERIFIED MARKET PRICE',
        rejectionReason: 'NO_VERIFIED_MARKET_DATA',
        timestamp: null,
        source: 'Twelve Data API',
        newPosition: null,
      };
    }

    // Only accept valid quote statuses
    if (quote.status === 'NOT CONNECTED' || quote.status === 'ERROR' || quote.status === 'INVALID' || quote.status === 'NO VERIFIED DATA') {
      return {
        filled: false,
        executedPrice: null,
        error: `ORDER NOT FILLED: Market data status is ${quote.status}`,
        rejectionReason: 'NO_VERIFIED_MARKET_DATA',
        timestamp: quote.timestamp,
        source: quote.provider || 'Twelve Data API',
        newPosition: null,
      };
    }

    const verifiedPrice = quote.ltp;
    const isLong = order.direction === 'LONG';

    // 2. Validate simulation parameters (No hidden assumptions)
    const frictionEval = this.evaluateFrictionConfig(riskConfig);
    if (!frictionEval.isValid) {
      return {
        filled: false,
        executedPrice: null,
        error: frictionEval.errorMessage,
        rejectionReason: frictionEval.status as PaperRejectionReason,
        timestamp: quote.timestamp,
        source: quote.provider || 'Twelve Data API',
        newPosition: null,
      };
    }

    // 3. Execution mode handling
    if (order.executionMode === 'MARKET') {
      // Mode A: Immediate fill at verified market quote with realistic spread & slippage
      const friction = this.calculateFillsWithFriction(
        verifiedPrice,
        order.direction,
        order.symbol,
        order.positionSize,
        riskConfig,
        false,
        order.lotSize
      );

      const positionId = `POS-${Date.now()}-${order.symbol.replace('/', '')}-${Math.floor(Math.random() * 1000)}`;
      
      const newPosition: PaperPosition = {
        positionId,
        paperOrderId: order.paperOrderId,
        setupId: order.setupId,
        symbol: order.symbol,
        direction: order.direction,
        setupFamily: order.setupFamily,
        openedAt: new Date().toISOString(),
        entryPrice: friction.executedPrice,
        currentPrice: verifiedPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        positionSize: order.positionSize,
        lotSize: order.lotSize ?? (order.symbol === 'XAU/USD' && order.positionSize ? Number((order.positionSize / 100).toFixed(4)) : order.positionSize),
        initialPositionSize: order.positionSize,
        positionSizeDisplay: order.positionSizeDisplay,
        initialRisk: order.initialRisk,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        accumulatedFees: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
        realizedPnL: 0,
        partialExits: [],
        unrealizedPnL: 0,
        unrealizedRMultiple: 0,
        marketDataTimestamp: quote.timestamp,
        marketDataSource: quote.provider || 'Twelve Data API',
        status: 'OPEN',
      };

      return {
        filled: true,
        executedPrice: friction.executedPrice,
        error: null,
        rejectionReason: null,
        timestamp: quote.timestamp || new Date().toISOString(),
        source: quote.provider || 'Twelve Data API',
        newPosition,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        commissionFee: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
      };
    } else {
      // Mode B: SETUP ENTRY (Limit Order)
      // Must verify that market price touched or crossed the target setup entry
      let conditionMet = false;
      if (isLong) {
        // For LONG: Price touched or below setup entry
        conditionMet = verifiedPrice <= order.plannedEntryPrice;
      } else {
        // For SHORT: Price touched or above setup entry
        conditionMet = verifiedPrice >= order.plannedEntryPrice;
      }

      if (!conditionMet) {
        return {
          filled: false,
          executedPrice: null,
          error: `ORDER PENDING: Market price ${verifiedPrice} has not touched setup entry ${order.plannedEntryPrice}`,
          rejectionReason: null,
          timestamp: quote.timestamp,
          source: quote.provider || 'Twelve Data API',
          newPosition: null,
        };
      }

      // In Limit Orders, fills occur at the planned limit price or better (spread markup applied to bid/ask)
      const friction = this.calculateFillsWithFriction(
        order.plannedEntryPrice,
        order.direction,
        order.symbol,
        order.positionSize,
        riskConfig,
        true // Limit fill experiences 0 adverse touch slippage
      );

      const positionId = `POS-${Date.now()}-${order.symbol.replace('/', '')}-${Math.floor(Math.random() * 1000)}`;
      const newPosition: PaperPosition = {
        positionId,
        paperOrderId: order.paperOrderId,
        setupId: order.setupId,
        symbol: order.symbol,
        direction: order.direction,
        setupFamily: order.setupFamily,
        openedAt: new Date().toISOString(),
        entryPrice: friction.executedPrice,
        currentPrice: verifiedPrice,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        positionSize: order.positionSize,
        initialPositionSize: order.positionSize,
        positionSizeDisplay: order.positionSizeDisplay,
        initialRisk: order.initialRisk,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        accumulatedFees: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
        realizedPnL: 0,
        partialExits: [],
        unrealizedPnL: 0,
        unrealizedRMultiple: 0,
        marketDataTimestamp: quote.timestamp,
        marketDataSource: quote.provider || 'Twelve Data API',
        status: 'OPEN',
      };

      return {
        filled: true,
        executedPrice: friction.executedPrice,
        error: null,
        rejectionReason: null,
        timestamp: quote.timestamp || new Date().toISOString(),
        source: quote.provider || 'Twelve Data API',
        newPosition,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        commissionFee: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
      };
    }
  }

  /**
   * Attempts to execute a pending paper order against a verified candle (e.g. historical simulation or bar close).
   */
  static executeWithCandle(
    order: PaperOrder, 
    candle: Candle,
    riskConfig?: Partial<PaperRiskConfig> | null
  ): ExecutionResult {
    if (!candle || !candle.close || candle.close <= 0) {
      return {
        filled: false,
        executedPrice: null,
        error: 'ORDER NOT FILLED: NO VERIFIED CANDLE DATA',
        rejectionReason: 'NO_VERIFIED_MARKET_DATA',
        timestamp: null,
        source: 'Twelve Data Historical OHLCV',
        newPosition: null,
      };
    }

    const isLong = order.direction === 'LONG';
    const candleDatetime = new Date(candle.timestamp).toISOString();

    // Validate simulation parameters (No hidden assumptions)
    const frictionEval = this.evaluateFrictionConfig(riskConfig);
    if (!frictionEval.isValid) {
      return {
        filled: false,
        executedPrice: null,
        error: frictionEval.errorMessage,
        rejectionReason: frictionEval.status as PaperRejectionReason,
        timestamp: candleDatetime,
        source: 'Twelve Data Historical OHLCV',
        newPosition: null,
      };
    }

    if (order.executionMode === 'MARKET') {
      const friction = this.calculateFillsWithFriction(
        candle.close,
        order.direction,
        order.symbol,
        order.positionSize,
        riskConfig,
        false,
        order.lotSize
      );

      const cleanSymbol = order.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const cleanTf = (order.timeframe || '15M').toUpperCase();
      const positionId = order.paperOrderId.startsWith('ORD-')
        ? order.paperOrderId.replace(/^ORD-/, 'POS-')
        : `POS-P7F-${cleanSymbol}-${cleanTf}-${candle.timestamp}-${order.direction}`;
      const newPosition: PaperPosition = {
        positionId,
        paperOrderId: order.paperOrderId,
        setupId: order.setupId,
        symbol: order.symbol,
        direction: order.direction,
        setupFamily: order.setupFamily,
        openedAt: candleDatetime,
        entryPrice: friction.executedPrice,
        currentPrice: candle.close,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        positionSize: order.positionSize,
        lotSize: order.lotSize ?? (order.symbol === 'XAU/USD' && order.positionSize ? Number((order.positionSize / 100).toFixed(4)) : order.positionSize),
        initialPositionSize: order.positionSize,
        positionSizeDisplay: order.positionSizeDisplay,
        initialRisk: order.initialRisk,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        accumulatedFees: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
        realizedPnL: 0,
        partialExits: [],
        unrealizedPnL: 0,
        unrealizedRMultiple: 0,
        marketDataTimestamp: candleDatetime,
        marketDataSource: 'Twelve Data Historical OHLCV',
        status: 'OPEN',
      };

      return {
        filled: true,
        executedPrice: friction.executedPrice,
        error: null,
        rejectionReason: null,
        timestamp: candleDatetime,
        source: 'Twelve Data Historical OHLCV',
        newPosition,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        commissionFee: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
      };
    } else {
      // SETUP ENTRY with candle High/Low
      let touched = false;
      if (isLong) {
        touched = candle.low <= order.plannedEntryPrice;
      } else {
        touched = candle.high >= order.plannedEntryPrice;
      }

      if (!touched) {
        return {
          filled: false,
          executedPrice: null,
          error: `ORDER PENDING: Candle range [${candle.low} - ${candle.high}] did not touch entry ${order.plannedEntryPrice}`,
          rejectionReason: null,
          timestamp: candleDatetime,
          source: 'Twelve Data Historical OHLCV',
          newPosition: null,
        };
      }

      const friction = this.calculateFillsWithFriction(
        order.plannedEntryPrice,
        order.direction,
        order.symbol,
        order.positionSize,
        riskConfig,
        true, // Limit fill experiences 0 adverse touch slippage
        order.lotSize
      );

      const cleanSymbol = order.symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const cleanTf = (order.timeframe || '15M').toUpperCase();
      const positionId = order.paperOrderId.startsWith('ORD-')
        ? order.paperOrderId.replace(/^ORD-/, 'POS-')
        : `POS-P7F-${cleanSymbol}-${cleanTf}-${candle.timestamp}-${order.direction}`;
      const newPosition: PaperPosition = {
        positionId,
        paperOrderId: order.paperOrderId,
        setupId: order.setupId,
        symbol: order.symbol,
        direction: order.direction,
        setupFamily: order.setupFamily,
        openedAt: candleDatetime,
        entryPrice: friction.executedPrice,
        currentPrice: candle.close,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        positionSize: order.positionSize,
        lotSize: order.lotSize ?? (order.symbol === 'XAU/USD' && order.positionSize ? Number((order.positionSize / 100).toFixed(4)) : order.positionSize),
        initialPositionSize: order.positionSize,
        positionSizeDisplay: order.positionSizeDisplay,
        initialRisk: order.initialRisk,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        accumulatedFees: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
        realizedPnL: 0,
        partialExits: [],
        unrealizedPnL: 0,
        unrealizedRMultiple: 0,
        marketDataTimestamp: candleDatetime,
        marketDataSource: 'Twelve Data Historical OHLCV',
        status: 'OPEN',
      };

      return {
        filled: true,
        executedPrice: friction.executedPrice,
        error: null,
        rejectionReason: null,
        timestamp: candleDatetime,
        source: 'Twelve Data Historical OHLCV',
        newPosition,
        slippagePips: friction.slippagePips,
        spreadPips: friction.spreadPips,
        commissionFee: friction.commissionFee,
        commissionMode: friction.commissionMode,
        spreadMode: friction.spreadMode,
        slippageMode: friction.slippageMode,
      };
    }
  }
}
