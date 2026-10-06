import { 
  PaperOrder, 
  PaperOrderStatus, 
  SetupSnapshot, 
  PaperExecutionMode, 
  PaperOrderCloseReason, 
  PaperRejectionReason 
} from '../../types/paper-trading';
import { SetupRecord } from '../../types/scanner';
import { SizingResult } from './position-sizer';

const STORAGE_KEY = 'forex_gold_robo_paper_orders_v1';

export class PaperOrderService {
  private orders: Map<string, PaperOrder> = new Map();
  private listeners: ((orders: PaperOrder[]) => void)[] = [];

  constructor() {
    this.loadPersistedOrders();
  }

  private loadPersistedOrders(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PaperOrder[];
          if (Array.isArray(parsed)) {
            this.orders.clear();
            for (const order of parsed) {
              this.orders.set(order.paperOrderId, order);
            }
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  private persist(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const arr = Array.from(this.orders.values());
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      }
    } catch {
      // Ignore
    }
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const list = this.getAllOrders();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch {
        // Ignore
      }
    }
  }

  subscribe(listener: (orders: PaperOrder[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.getAllOrders());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getAllOrders(): PaperOrder[] {
    return Array.from(this.orders.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getOrderById(paperOrderId: string): PaperOrder | null {
    return this.orders.get(paperOrderId) ?? null;
  }

  getOrderBySetupId(setupId: string): PaperOrder | null {
    for (const order of this.orders.values()) {
      if (order.setupId === setupId) {
        return order;
      }
    }
    return null;
  }

  hasActiveOrderForSetup(setupId: string): boolean {
    for (const order of this.orders.values()) {
      if (order.setupId === setupId) {
        // Any existing order (PENDING, OPEN, or CLOSED) prevents duplicate orders
        // per Section 13 rules: "One setup -> maximum one paper trade"
        if (['PENDING', 'OPEN', 'CLOSED'].includes(order.status)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Creates a snapshot of the setup evidence (Section 6)
   */
  static createSetupSnapshot(setup: SetupRecord): SetupSnapshot {
    const dir: 'LONG' | 'SHORT' = setup.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    const entry = setup.risk.entryReference ?? 0;
    const stopLoss = setup.risk.stopLossReference ?? 0;
    const target = setup.risk.targetReference ?? 0;
    const rr = setup.risk.riskRewardRatio ?? 0;

    return {
      setupId: setup.setupId,
      setupFamily: setup.setupFamily,
      direction: dir,
      timeframe: setup.timeframe,
      symbol: setup.symbol,
      entry,
      stopLoss,
      target,
      riskRewardRatio: rr,
      liquidityEvidence: setup.evidence.liquidityLevel ? [`Level: ${setup.evidence.liquidityLevel}`] : [],
      sweepEvidence: setup.evidence.sweepDetected ? [`Sweep: ${setup.evidence.sweepHighOrLow}`] : [],
      structureEvidence: setup.evidence.structureEvent ? [`Event: ${setup.evidence.structureEvent}`] : [],
      displacementEvidence: setup.evidence.displacementDetected ? [`Displacement ratio: ${setup.evidence.displacementBodyRatio}`] : [],
      fvgEvidence: setup.evidence.fvgDetected ? [`FVG: ${setup.evidence.fvgLower} - ${setup.evidence.fvgUpper}`] : [],
      retestEvidence: setup.evidence.retestDetected ? [`Retest price: ${setup.evidence.retestPrice}`] : [],
      volatilityEvidence: [],
      mtfEvidence: [],
      rrEvidence: [`Target: ${target}`, `SL: ${stopLoss}`, `R:R: ${rr}`],
      validationState: setup.status,
      provenance: {
        fact: setup.provenance ? [...setup.provenance.fact] : [],
        calculation: setup.provenance ? [...setup.provenance.calculation] : [],
        modelOutput: setup.provenance 
          ? (Array.isArray(setup.provenance.modelOutput) ? setup.provenance.modelOutput.join(', ') : String(setup.provenance.modelOutput)) 
          : 'VALIDATED_CANDIDATE',
      },
      createdAt: setup.createdAt,
      validatedAt: setup.lastUpdated || new Date().toISOString(),
    };
  }

  createOrder(
    setup: SetupRecord,
    sizing: SizingResult,
    executionMode: PaperExecutionMode = 'MARKET'
  ): PaperOrder {
    const timestamp = Date.now();
    const paperOrderId = `PO-${timestamp}-${setup.symbol.replace('/', '')}-${Math.floor(Math.random() * 1000)}`;
    const dir: 'LONG' | 'SHORT' = setup.direction === 'BULLISH' ? 'LONG' : 'SHORT';
    const entry = setup.risk.entryReference ?? 0;
    const stopLoss = setup.risk.stopLossReference ?? 0;
    const target = setup.risk.targetReference ?? 0;
    const plannedReward = Math.abs(target - entry);

    const setupSnapshot = PaperOrderService.createSetupSnapshot(setup);
    const lotSize = sizing.contractSpecification && sizing.contractSpecification > 0
      ? sizing.positionSize
      : (setup.symbol === 'XAU/USD' && sizing.positionSize ? Number((sizing.positionSize / 100).toFixed(4)) : sizing.positionSize);

    const newOrder: PaperOrder = {
      paperOrderId,
      setupId: setup.setupId,
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      direction: dir,
      setupFamily: setup.setupFamily,
      executionMode,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      filledAt: null,
      closedAt: null,
      plannedEntryPrice: entry,
      executedEntryPrice: null,
      stopLoss: stopLoss,
      takeProfit: target,
      positionSize: sizing.positionSize,
      lotSize,
      positionSizeDisplay: sizing.positionSizeDisplay,
      riskAmount: sizing.riskAmount,
      riskPercent: 1.0,
      initialRisk: sizing.riskAmount,
      plannedReward,
      plannedRR: setup.risk.riskRewardRatio ?? 0,
      currentPrice: null,
      unrealizedPnL: 0,
      realizedPnL: null,
      rMultiple: null,
      closeReason: null,
      rejectionReason: null,
      rejectionDetails: null,
      marketDataTimestamp: null,
      marketDataSource: 'Twelve Data API',
      setupSnapshot,
      evidenceSnapshot: {
        evidence: setup.evidence,
        validation: setup.validation,
        risk: setup.risk,
      },
    };

    this.orders.set(paperOrderId, newOrder);
    this.persist();
    return newOrder;
  }

  updateOrderStatus(
    paperOrderId: string,
    status: PaperOrderStatus,
    updates: Partial<PaperOrder> = {}
  ): PaperOrder | null {
    const order = this.orders.get(paperOrderId);
    if (!order) return null;

    const updated: PaperOrder = {
      ...order,
      ...updates,
      status,
    };

    this.orders.set(paperOrderId, updated);
    this.persist();
    return updated;
  }

  /**
   * Checks pending orders against latest setup state.
   * If a setup becomes INVALIDATED before execution:
   * CANCEL / REJECT PAPER ORDER (Section 14)
   */
  cancelIfSetupInvalidated(setup: SetupRecord): PaperOrder | null {
    if (!setup.validation.isInvalidated && setup.status !== 'INVALIDATED') {
      return null;
    }

    for (const order of this.orders.values()) {
      if (order.setupId === setup.setupId && order.status === 'PENDING') {
        return this.updateOrderStatus(order.paperOrderId, 'CANCELLED', {
          closeReason: 'SETUP_INVALIDATED_BEFORE_FILL',
          closedAt: new Date().toISOString(),
          rejectionReason: 'NO_VALIDATED_SETUP',
          rejectionDetails: `Setup invalidated before fill: ${setup.validation.invalidationReason || 'Conditions breached'}`,
        });
      }
    }
    return null;
  }

  clearOrders(): void {
    this.orders.clear();
    this.persist();
  }
}

export const paperOrderService = new PaperOrderService();
