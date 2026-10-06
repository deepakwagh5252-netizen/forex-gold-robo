import { PaperRiskConfig } from '../../types/paper-trading';

export interface SizingInput {
  currentEquity: number;
  riskPercent: number; // e.g. 1.0 = 1%
  entryPrice: number;
  stopLossPrice: number;
  symbol: string;
  riskConfig: PaperRiskConfig;
}

export interface SizingResult {
  isValid: boolean;
  error: string | null;
  rejectionReason: 'INVALID_ENTRY' | 'INVALID_STOP' | 'INVALID_RISK' | 'INVALID_RISK_DISTANCE' | 'MISSING_CONTRACT_SPECIFICATION' | null;
  riskAmount: number;
  riskPerUnit: number;
  positionSize: number | null;
  positionSizeDisplay: string;
  contractSpecification: number | null;
}

export class PositionSizer {
  /**
   * Deterministic calculation of risk amount:
   * riskAmount = currentEquity * (riskPercent / 100)
   */
  static calculateRiskAmount(currentEquity: number, riskPercent: number): number {
    if (!currentEquity || currentEquity <= 0 || !riskPercent || riskPercent <= 0) {
      return 0;
    }
    return Number(((currentEquity * riskPercent) / 100).toFixed(2));
  }

  /**
   * Deterministic calculation of risk per unit:
   * riskPerUnit = ABS(entryPrice - stopLoss)
   * If entryPrice <= 0, stopLoss <= 0, or riskPerUnit <= 0: reject as INVALID_RISK_DISTANCE
   */
  static calculateRiskPerUnit(entryPrice: number, stopLossPrice: number): { riskPerUnit: number; isValid: boolean; error: string | null } {
    if (!entryPrice || entryPrice <= 0) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_ENTRY: Entry price must be strictly positive' };
    }
    if (!stopLossPrice || stopLossPrice <= 0) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_STOP: Stop loss must be strictly positive' };
    }
    const distance = Math.abs(entryPrice - stopLossPrice);
    if (distance <= 1e-7 || entryPrice === stopLossPrice) {
      return { riskPerUnit: 0, isValid: false, error: 'INVALID_RISK_DISTANCE' };
    }
    return { riskPerUnit: Number(distance.toFixed(4)), isValid: true, error: null };
  }

  /**
   * Deterministic calculation of paper risk and position sizing.
   * Strictly respects:
   * 1. Risk Amount = Current Equity * Risk %
   * 2. Risk Per Unit = ABS(Entry Price - Stop Loss)
   * 3. Base Position Size = Risk Amount / Risk Per Unit
   * 4. If contract specifications are unavailable:
   *    "POSITION SIZE UNAVAILABLE — VERIFIED CONTRACT SPECIFICATION REQUIRED"
   * 5. Never invents lot size, contract size, pip value, tick value, leverage, or margin.
   */
  static calculate(input: SizingInput): SizingResult {
    const { currentEquity, riskPercent, entryPrice, stopLossPrice, symbol, riskConfig } = input;

    // Sanity checks on equity and risk %
    if (!currentEquity || currentEquity <= 0) {
      return {
        isValid: false,
        error: 'Invalid account equity for risk calculation',
        rejectionReason: 'INVALID_RISK',
        riskAmount: 0,
        riskPerUnit: 0,
        positionSize: null,
        positionSizeDisplay: 'POSITION SIZE UNAVAILABLE — VERIFIED CONTRACT SPECIFICATION REQUIRED',
        contractSpecification: null,
      };
    }

    if (!riskPercent || riskPercent <= 0 || riskPercent > 100) {
      return {
        isValid: false,
        error: 'Invalid risk percentage (must be between 0 and 100)',
        rejectionReason: 'INVALID_RISK',
        riskAmount: 0,
        riskPerUnit: 0,
        positionSize: null,
        positionSizeDisplay: 'POSITION SIZE UNAVAILABLE — VERIFIED CONTRACT SPECIFICATION REQUIRED',
        contractSpecification: null,
      };
    }

    // Price validity checks & Risk Per Unit calculation
    const unitRisk = this.calculateRiskPerUnit(entryPrice, stopLossPrice);
    if (!unitRisk.isValid) {
      const reason = unitRisk.error?.startsWith('INVALID_ENTRY')
        ? 'INVALID_ENTRY'
        : unitRisk.error?.startsWith('INVALID_STOP')
        ? 'INVALID_STOP'
        : 'INVALID_RISK_DISTANCE';

      return {
        isValid: false,
        error: unitRisk.error,
        rejectionReason: reason,
        riskAmount: 0,
        riskPerUnit: 0,
        positionSize: null,
        positionSizeDisplay: 'POSITION SIZE UNAVAILABLE — VERIFIED CONTRACT SPECIFICATION REQUIRED',
        contractSpecification: null,
      };
    }

    const riskAmount = this.calculateRiskAmount(currentEquity, riskPercent);
    const riskPerUnit = unitRisk.riskPerUnit;

    // Check verified contract specification
    const contractSpec = riskConfig?.contractSpecifications?.[symbol] ?? null;

    if (riskConfig?.requireContractSpec !== false && (contractSpec === null || contractSpec === undefined || contractSpec <= 0)) {
      return {
        isValid: false,
        error: `Verified contract specification unavailable for ${symbol}. Do NOT invent contract specifications.`,
        rejectionReason: 'MISSING_CONTRACT_SPECIFICATION',
        riskAmount,
        riskPerUnit,
        positionSize: null,
        positionSizeDisplay: 'POSITION SIZE UNAVAILABLE — VERIFIED CONTRACT SPECIFICATION REQUIRED',
        contractSpecification: null,
      };
    }

    // Deterministic position size calculation when contractSpec is verified
    const baseUnits = riskAmount / riskPerUnit;
    let finalSize: number;

    if (contractSpec && contractSpec > 0) {
      finalSize = Number((baseUnits / contractSpec).toFixed(4));
    } else {
      finalSize = Number(baseUnits.toFixed(4));
    }

    return {
      isValid: true,
      error: null,
      rejectionReason: null,
      riskAmount,
      riskPerUnit,
      positionSize: finalSize,
      positionSizeDisplay: `${finalSize.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${contractSpec ? 'Contracts' : 'Units'}`,
      contractSpecification: contractSpec,
    };
  }
}
