import { 
  PaperPosition, 
  PaperOrderCloseReason,
  PaperRiskConfig 
} from '../../types/paper-trading';
import { InstrumentQuote } from '../../types/terminal';
import { Candle } from '../../market-data/provider.interface';
import { PaperExecutionService } from './paper-execution-service';

export interface PositionEvaluation {
  shouldClose: boolean;
  closeReason: PaperOrderCloseReason | null;
  exitPrice: number;
  realizedPnL: number;
  rMultiple: number;
  rMultipleDisplay: string;
  isAmbiguousExit: boolean;
  ambiguityNote?: string;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedRMultiple: number;
  commissionFee?: number;
  marketDataTimestamp: string | null;
  marketDataSource: string;
}

export class PositionMonitor {
  /**
   * Deterministically formats R-multiple display (e.g. +2.00R, +1.00R, 0.00R, -1.00R)
   */
  static formatRMultiple(r: number): string {
    if (r > 0) {
      return `+${r.toFixed(2)}R`;
    }
    return `${r.toFixed(2)}R`;
  }

  /**
   * Evaluates an open position against a verified live/stale quote.
   */
  static evaluateWithQuote(
    position: PaperPosition, 
    quote: InstrumentQuote,
    riskConfig?: Partial<PaperRiskConfig> | null
  ): PositionEvaluation {
    const currentPrice = quote.ltp ?? position.currentPrice;
    const isLong = position.direction === 'LONG';
    const initialRiskDist = Math.abs(position.entryPrice - position.stopLoss);

    // Calculate current mark-to-market unrealized
    let unrealizedPnL = 0;
    let unrealizedR = 0;

    if (initialRiskDist > 0) {
      if (isLong) {
        unrealizedR = (currentPrice - position.entryPrice) / initialRiskDist;
        if (position.positionSize) {
          unrealizedPnL = (currentPrice - position.entryPrice) * position.positionSize;
        }
      } else {
        unrealizedR = (position.entryPrice - currentPrice) / initialRiskDist;
        if (position.positionSize) {
          unrealizedPnL = (position.entryPrice - currentPrice) * position.positionSize;
        }
      }
    }

    // Check SL / TP
    let shouldClose = false;
    let closeReason: PaperOrderCloseReason | null = null;
    let exitPrice = currentPrice;

    if (isLong) {
      if (currentPrice <= position.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
        exitPrice = position.stopLoss;
      } else if (currentPrice >= position.takeProfit) {
        shouldClose = true;
        closeReason = 'TAKE_PROFIT';
        exitPrice = position.takeProfit;
      }
    } else {
      if (currentPrice >= position.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
        exitPrice = position.stopLoss;
      } else if (currentPrice <= position.takeProfit) {
        shouldClose = true;
        closeReason = 'TAKE_PROFIT';
        exitPrice = position.takeProfit;
      }
    }

    let realizedPnL = 0;
    let finalR = Number(unrealizedR.toFixed(2));
    let exitCommissionFee = 0;

    if (shouldClose) {
      const effectiveRiskConfig = {
        ...riskConfig,
        commissionDisabled: position.commissionMode === 'DISABLED' ? true : (riskConfig?.commissionDisabled ?? false),
        commissionPerLot: position.commissionMode === 'DISABLED' ? 0 : (riskConfig?.commissionPerLot ?? null),
        spreadDisabled: position.spreadMode === 'DISABLED' ? true : (riskConfig?.spreadDisabled ?? false),
        spreadMarkupPips: position.spreadMode === 'DISABLED' ? 0 : (position.spreadPips ?? riskConfig?.spreadMarkupPips ?? null),
        slippageDisabled: position.slippageMode === 'DISABLED' ? true : (riskConfig?.slippageDisabled ?? false),
        slippagePips: position.slippageMode === 'DISABLED' ? 0 : (position.slippagePips ?? riskConfig?.slippagePips ?? null),
      };

      const friction = PaperExecutionService.calculateFillsWithFriction(
        exitPrice,
        isLong ? 'SHORT' : 'LONG', // closing a LONG means selling, closing a SHORT means buying
        position.symbol,
        position.positionSize,
        effectiveRiskConfig,
        false,
        position.lotSize
      );
      exitPrice = friction.executedPrice;
      exitCommissionFee = friction.commissionFee;

      if (position.positionSize) {
        realizedPnL = isLong
          ? (exitPrice - position.entryPrice) * position.positionSize
          : (position.entryPrice - exitPrice) * position.positionSize;
      }
      if (position.initialRisk > 0 && position.positionSize) {
        finalR = Number((realizedPnL / position.initialRisk).toFixed(2));
      } else if (initialRiskDist > 0) {
        const exitDist = isLong ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
        finalR = Number((exitDist / initialRiskDist).toFixed(2));
      }
    }

    return {
      shouldClose,
      closeReason,
      exitPrice: Number(exitPrice.toFixed(4)),
      realizedPnL: Number(realizedPnL.toFixed(2)),
      rMultiple: finalR,
      rMultipleDisplay: this.formatRMultiple(finalR),
      isAmbiguousExit: false,
      currentPrice: Number(currentPrice.toFixed(4)),
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      unrealizedRMultiple: Number(unrealizedR.toFixed(2)),
      commissionFee: exitCommissionFee,
      marketDataTimestamp: quote.timestamp,
      marketDataSource: quote.provider || 'Twelve Data API',
    };
  }

  /**
   * Evaluates an open position against a verified completed candle.
   * Strictly enforces Section 9: If both SL and TP appear to occur inside the same candle,
   * EXIT ORDER = AMBIGUOUS. Do NOT arbitrarily choose the profitable outcome.
   */
  static evaluateWithCandle(
    position: PaperPosition, 
    candle: Candle,
    riskConfig?: Partial<PaperRiskConfig> | null
  ): PositionEvaluation {
    const isLong = position.direction === 'LONG';
    const initialRiskDist = Math.abs(position.entryPrice - position.stopLoss);
    const candleHigh = candle.high;
    const candleLow = candle.low;
    const candleClose = candle.close;

    let slHit = false;
    let tpHit = false;

    if (isLong) {
      slHit = candleLow <= position.stopLoss;
      tpHit = candleHigh >= position.takeProfit;
    } else {
      slHit = candleHigh >= position.stopLoss;
      tpHit = candleLow <= position.takeProfit;
    }

    let shouldClose = false;
    let closeReason: PaperOrderCloseReason | null = null;
    let isAmbiguousExit = false;
    let ambiguityNote: string | undefined = undefined;
    let exitPrice = candleClose;

    // Strict same-candle ambiguity resolution (Section 9)
    if (slHit && tpHit) {
      shouldClose = true;
      closeReason = 'AMBIGUOUS_INTRABAR_EXIT';
      isAmbiguousExit = true;
      ambiguityNote = 'CANNOT DETERMINE EXIT ORDER: Both SL and TP touched in same candle without intrabar tick sequencing';
      // Conservative rule: Never assume profitable outcome
      exitPrice = position.stopLoss;
    } else if (slHit) {
      shouldClose = true;
      closeReason = 'STOP_LOSS';
      exitPrice = position.stopLoss;
    } else if (tpHit) {
      shouldClose = true;
      closeReason = 'TAKE_PROFIT';
      exitPrice = position.takeProfit;
    }

    let unrealizedPnL = 0;
    let unrealizedR = 0;

    if (initialRiskDist > 0) {
      if (isLong) {
        unrealizedR = (candleClose - position.entryPrice) / initialRiskDist;
        if (position.positionSize) {
          unrealizedPnL = (candleClose - position.entryPrice) * position.positionSize;
        }
      } else {
        unrealizedR = (position.entryPrice - candleClose) / initialRiskDist;
        if (position.positionSize) {
          unrealizedPnL = (position.entryPrice - candleClose) * position.positionSize;
        }
      }
    }

    let realizedPnL = 0;
    let finalR = Number(unrealizedR.toFixed(2));
    let exitCommissionFee = 0;

    if (shouldClose) {
      const effectiveRiskConfig = {
        ...riskConfig,
        commissionDisabled: position.commissionMode === 'DISABLED' ? true : (riskConfig?.commissionDisabled ?? false),
        commissionPerLot: position.commissionMode === 'DISABLED' ? 0 : (riskConfig?.commissionPerLot ?? null),
        spreadDisabled: position.spreadMode === 'DISABLED' ? true : (riskConfig?.spreadDisabled ?? false),
        spreadMarkupPips: position.spreadMode === 'DISABLED' ? 0 : (position.spreadPips ?? riskConfig?.spreadMarkupPips ?? null),
        slippageDisabled: position.slippageMode === 'DISABLED' ? true : (riskConfig?.slippageDisabled ?? false),
        slippagePips: position.slippageMode === 'DISABLED' ? 0 : (position.slippagePips ?? riskConfig?.slippagePips ?? null),
      };

      const friction = PaperExecutionService.calculateFillsWithFriction(
        exitPrice,
        isLong ? 'SHORT' : 'LONG',
        position.symbol,
        position.positionSize,
        effectiveRiskConfig,
        false,
        position.lotSize
      );
      exitPrice = friction.executedPrice;
      exitCommissionFee = friction.commissionFee;

      if (position.positionSize) {
        realizedPnL = isLong
          ? (exitPrice - position.entryPrice) * position.positionSize
          : (position.entryPrice - exitPrice) * position.positionSize;
      }
      if (position.initialRisk > 0 && position.positionSize) {
        finalR = Number((realizedPnL / position.initialRisk).toFixed(2));
      } else if (initialRiskDist > 0) {
        const exitDist = isLong ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
        finalR = Number((exitDist / initialRiskDist).toFixed(2));
      }
    }

    return {
      shouldClose,
      closeReason,
      exitPrice: Number(exitPrice.toFixed(4)),
      realizedPnL: Number(realizedPnL.toFixed(2)),
      rMultiple: finalR,
      rMultipleDisplay: this.formatRMultiple(finalR),
      isAmbiguousExit,
      ambiguityNote,
      currentPrice: Number(candleClose.toFixed(4)),
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      unrealizedRMultiple: Number(unrealizedR.toFixed(2)),
      commissionFee: exitCommissionFee,
      marketDataTimestamp: new Date(candle.timestamp).toISOString(),
      marketDataSource: 'Twelve Data Historical OHLCV',
    };
  }
}
