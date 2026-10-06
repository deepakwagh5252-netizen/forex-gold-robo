import { PaperExecutionService } from '../src/services/paper-trading/paper-execution-service';
import { PaperTradingEngine } from '../src/services/paper-trading/paper-trading-engine';
import { PaperAccountService } from '../src/services/paper-trading/paper-account-service';
import { PaperOrderService } from '../src/services/paper-trading/paper-order-service';
import { TradeJournalService } from '../src/services/paper-trading/trade-journal-service';
import { RiskManager } from '../src/services/paper-trading/risk-manager';
import type { PaperOrder, PaperRejectionReason } from '../src/types/paper-trading';
import type { Candle } from '../src/market-data/provider.interface';

async function runFrictionIntegrityTests() {
  console.log('====================================================');
  console.log('PHASE 4B: EXECUTION FRICTION & SIMULATION INTEGRITY');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${testName} - ${detail || 'Assertion failed'}`);
      throw new Error(`Test ${total} failed: ${testName}`);
    }
  }

  const executionService = new PaperExecutionService();

  const mockOrder: PaperOrder = {
    paperOrderId: 'ord-test-1',
    setupId: 'setup-123',
    symbol: 'EUR/USD',
    timeframe: '1h',
    direction: 'LONG',
    executionMode: 'MARKET',
    status: 'PENDING',
    plannedEntryPrice: 1.0850,
    executedEntryPrice: null,
    stopLoss: 1.0800,
    takeProfit: 1.0950,
    plannedRR: 2.0,
    positionSize: 1.0,
    initialRisk: 500,
    riskAmount: 500,
    riskPercent: 1.0,
    plannedReward: 1000,
    positionSizeDisplay: '1.00 Lots (100,000 units)',
    createdAt: new Date().toISOString(),
    filledAt: null,
    closedAt: null,
    currentPrice: null,
    unrealizedPnL: 0,
    realizedPnL: null,
    rMultiple: null,
    closeReason: null,
    rejectionReason: null,
    rejectionDetails: null,
    marketDataTimestamp: null,
    marketDataSource: 'Twelve Data API',
    setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
    setupSnapshot: {} as any,
    evidenceSnapshot: {} as any,
  };

  const candle: Candle = {
    timestamp: Date.now(),
    open: 1.0850,
    high: 1.0860,
    low: 1.0845,
    close: 1.0855,
    volume: 100,
    isVerified: true,
  };

  // -------------------------------------------------------------
  // Test 1: evaluateFrictionConfig rejects unconfigured commission
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: false,
      commissionPerLot: null,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === false && evalResult.status === 'COMMISSION_NOT_CONFIGURED',
      'evaluateFrictionConfig rejects null commission with COMMISSION_NOT_CONFIGURED'
    );
  }

  // -------------------------------------------------------------
  // Test 2: executeWithCandle blocks order execution if commission not configured
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: false,
      commissionPerLot: null as any,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: false,
      slippagePips: 0.5,
    };
    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === false && fill.rejectionReason === 'COMMISSION_NOT_CONFIGURED',
      'executeWithCandle rejects order if commission is null/unconfigured'
    );
  }

  // -------------------------------------------------------------
  // Test 3: Commission OFF explicitly disables commission without fallback
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: true,
      commissionPerLot: null,
      spreadDisabled: true,
      spreadMarkupPips: null,
      slippageDisabled: true,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === true && evalResult.commissionMode === 'DISABLED' && evalResult.commissionPerLot === 0,
      'Commission OFF allows zero commission execution with commissionMode: DISABLED'
    );

    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === true && fill.commissionFee === 0,
      'executeWithCandle with Commission OFF charges exactly $0.00 commission'
    );
  }

  // -------------------------------------------------------------
  // Test 4: Explicit commission parameter executes without hidden assumptions
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: false,
      commissionPerLot: 3.50,
      spreadDisabled: true,
      spreadMarkupPips: null,
      slippageDisabled: true,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === true &&
      evalResult.commissionMode === 'SIMULATION_CONFIGURED' &&
      evalResult.commissionPerLot === 3.50,
      'Configured commission parameter sets commissionMode: SIMULATION_CONFIGURED with exact rate'
    );

    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === true && fill.commissionFee === 3.50,
      'executeWithCandle charges exact user configured simulation commission ($3.50 for 1 lot)'
    );
  }

  // -------------------------------------------------------------
  // Test 5: Spread validation blocks execution if unconfigured
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: true,
      commissionPerLot: null,
      spreadDisabled: false,
      spreadMarkupPips: null,
      slippageDisabled: true,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === false && evalResult.status === 'SPREAD_NOT_CONFIGURED',
      'evaluateFrictionConfig rejects null spread with SPREAD_NOT_CONFIGURED'
    );

    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === false && fill.rejectionReason === 'SPREAD_NOT_CONFIGURED',
      'executeWithCandle rejects order if spread is null/unconfigured'
    );
  }

  // -------------------------------------------------------------
  // Test 6: Spread OFF allows execution with zero spread markup
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: true,
      commissionPerLot: null,
      spreadDisabled: true,
      spreadMarkupPips: null,
      slippageDisabled: true,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === true && evalResult.spreadMode === 'DISABLED' && evalResult.spreadPips === 0,
      'Spread OFF allows zero spread execution with spreadMode: DISABLED'
    );
  }

  // -------------------------------------------------------------
  // Test 7: Slippage validation blocks execution if unconfigured
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: true,
      commissionPerLot: null,
      spreadDisabled: true,
      spreadMarkupPips: null,
      slippageDisabled: false,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === false && evalResult.status === 'SLIPPAGE_NOT_CONFIGURED',
      'evaluateFrictionConfig rejects null slippage with SLIPPAGE_NOT_CONFIGURED'
    );

    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === false && fill.rejectionReason === 'SLIPPAGE_NOT_CONFIGURED',
      'executeWithCandle rejects order if slippage is null/unconfigured'
    );
  }

  // -------------------------------------------------------------
  // Test 8: Slippage OFF allows execution with zero adverse slippage
  // -------------------------------------------------------------
  {
    const config = {
      commissionDisabled: true,
      commissionPerLot: null,
      spreadDisabled: true,
      spreadMarkupPips: null,
      slippageDisabled: true,
      slippagePips: null,
    };
    const evalResult = PaperExecutionService.evaluateFrictionConfig(config);
    assert(
      evalResult.isValid === true && evalResult.slippageMode === 'DISABLED' && evalResult.slippagePips === 0,
      'Slippage OFF allows zero slippage execution with slippageMode: DISABLED'
    );

    const fill = PaperExecutionService.executeWithCandle(mockOrder, candle, config);
    assert(
      fill.filled === true && fill.slippagePips === 0 && fill.executedPrice === candle.close,
      'executeWithCandle applies 0.0 slippage when Slippage OFF'
    );
  }

  // -------------------------------------------------------------
  // Test 9: PaperTradingEngine candidate evaluation gatekeeping
  // -------------------------------------------------------------
  {
    const accountSvc = new PaperAccountService();
    const orderSvc = new PaperOrderService();
    const journalSvc = new TradeJournalService();

    // Enable paper trading on account so that paper disabled is not the rejection
    accountSvc.setTradingEnabled(true);

    // Explicit risk config with verified contract specification but unconfigured commission
    const riskConfig = {
      commissionDisabled: false,
      commissionPerLot: null,
      spreadDisabled: true,
      spreadMarkupPips: 0,
      slippageDisabled: true,
      slippagePips: 0,
      contractSpecifications: {
        'EUR/USD': 100000,
      },
    };

    const engine = new PaperTradingEngine(riskConfig, accountSvc, orderSvc, journalSvc);

    const candidateSetup: any = {
      setupId: 'setup-candidate-99',
      symbol: 'EUR/USD',
      timeframe: '1h',
      direction: 'BULLISH',
      setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
      status: 'VALIDATED_CANDIDATE',
      risk: {
        entryReference: 1.0850,
        entryType: 'CALCULATED',
        entryMethod: 'FVG_TOUCH',
        stopLossReference: 1.0800,
        stopLossType: 'CALCULATED',
        stopLossMethod: 'SWING_LOW',
        targetReference: 1.0950,
        targetType: 'CALCULATED',
        targetSource: 'LIQUIDITY_POOL',
        riskDistance: 0.0050,
        rewardDistance: 0.0100,
        riskRewardRatio: 2.0,
        minimumRequiredRR: 2.0,
      },
      validation: {
        dataVerified: true,
        marketRegime: 'TRENDING',
        volatilityState: 'NORMAL',
        multiTimeframeContext: 'aligned',
        conditionsPassed: ['all'],
        conditionsFailed: [],
        confluence: {
          liquidity: 'PASS',
          structure: 'PASS',
          displacement: 'PASS',
          fvg: 'PASS',
          retest: 'PASS',
          volatility: 'PASS',
          multiTimeframe: 'PASS',
          riskReward: 'PASS',
        },
        invalidationCondition: 'Price breaks 1.0800',
        isInvalidated: false,
      },
      provenance: {
        fact: ['Twelve Data verified M15/H1 bar data'],
        calculation: ['RR = 2.0'],
        modelOutput: [],
      },
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lifecycleSequence: ['SETUP_FORMING', 'VALIDATED_CANDIDATE'],
    };

    const result = engine.evaluateAndProcessSetup(candidateSetup as any);
    assert(
      result.success === false && result.rejectionReason === 'COMMISSION_NOT_CONFIGURED',
      'PaperTradingEngine blocks candidate setup when commission is not configured'
    );
  }

  // -------------------------------------------------------------
  // Test 10: Position lifecycle preserves friction mode provenance
  // -------------------------------------------------------------
  {
    const accountSvc = new PaperAccountService();
    const orderSvc = new PaperOrderService();
    const journalSvc = new TradeJournalService();

    accountSvc.setTradingEnabled(true);

    // Set explicit simulation friction
    const riskConfig = {
      commissionDisabled: false,
      commissionPerLot: 4.00,
      spreadDisabled: false,
      spreadMarkupPips: 1.0,
      slippageDisabled: true,
      slippagePips: 0,
      contractSpecifications: {
        'EUR/USD': 100000,
      },
    };

    const engine = new PaperTradingEngine(riskConfig, accountSvc, orderSvc, journalSvc);

    const candidateSetup: any = {
      setupId: 'setup-candidate-100',
      symbol: 'EUR/USD',
      timeframe: '1h',
      direction: 'BULLISH',
      setupFamily: 'LIQUIDITY_SWEEP_REVERSAL',
      status: 'VALIDATED_CANDIDATE',
      evidence: {
        liquidityLevel: 1.0820,
        liquiditySource: 'PREVIOUS_DAY_LOW',
        sweepDetected: true,
        sweepTimestamp: Date.now(),
        sweepDatetime: new Date().toISOString(),
        sweepHighOrLow: 1.0820,
        structureEvent: 'CHOCH',
        structureTimestamp: Date.now(),
        structureDatetime: new Date().toISOString(),
        brokenLevel: 1.0840,
        displacementDetected: true,
        displacementTimestamp: Date.now(),
        displacementDatetime: new Date().toISOString(),
        displacementBodyRatio: 0.75,
        fvgDetected: true,
        fvgUpper: 1.0855,
        fvgLower: 1.0845,
        fvgTimestamp: Date.now(),
        fvgDatetime: new Date().toISOString(),
        retestDetected: true,
        retestTimestamp: Date.now(),
        retestDatetime: new Date().toISOString(),
        retestPrice: 1.0850,
        retestHolds: true,
      },
      risk: {
        entryReference: 1.0850,
        entryType: 'CALCULATED',
        entryMethod: 'FVG_TOUCH',
        stopLossReference: 1.0800,
        stopLossType: 'CALCULATED',
        stopLossMethod: 'SWING_LOW',
        targetReference: 1.0950,
        targetType: 'CALCULATED',
        targetSource: 'LIQUIDITY_POOL',
        riskDistance: 0.0050,
        rewardDistance: 0.0100,
        riskRewardRatio: 2.0,
        minimumRequiredRR: 2.0,
      },
      validation: {
        dataVerified: true,
        marketRegime: 'TRENDING',
        volatilityState: 'NORMAL',
        multiTimeframeContext: 'aligned',
        conditionsPassed: ['all'],
        conditionsFailed: [],
        confluence: {
          liquidity: 'PASS',
          structure: 'PASS',
          displacement: 'PASS',
          fvg: 'PASS',
          retest: 'PASS',
          volatility: 'PASS',
          multiTimeframe: 'PASS',
          riskReward: 'PASS',
        },
        invalidationCondition: 'Price breaks 1.0800',
        isInvalidated: false,
      },
      provenance: {
        fact: ['Twelve Data verified M15/H1 bar data'],
        calculation: ['RR = 2.0'],
        modelOutput: [],
      },
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      lifecycleSequence: ['SETUP_FORMING', 'VALIDATED_CANDIDATE'],
    };

    const initialQuote = {
      symbol: 'EUR/USD',
      price: 1.0850,
      bid: 1.0849,
      ask: 1.0851,
      ltp: 1.0850,
      source: 'TWELVE_DATA',
      provider: 'Twelve Data API',
      timestamp: new Date().toISOString(),
      status: 'FRESH' as const,
    };

    const result = engine.evaluateAndProcessSetup(candidateSetup as any, initialQuote as any, 'MARKET');
    assert(result.success === true, 'Candidate setup accepted with configured simulation friction');

    const openPositions = engine.getOpenPositions();
    assert(openPositions.length === 1, 'Position opened successfully');

    const pos = openPositions[0];
    assert(
      pos.commissionMode === 'SIMULATION_CONFIGURED' &&
      pos.spreadMode === 'SIMULATION_CONFIGURED' &&
      pos.slippageMode === 'DISABLED',
      'Position records exact friction mode provenance'
    );

    // Close position
    const exitQuote = {
      symbol: 'EUR/USD',
      price: 1.0900,
      bid: 1.0899,
      ask: 1.0901,
      ltp: 1.0900,
      source: 'TWELVE_DATA',
      provider: 'Twelve Data API',
      timestamp: new Date().toISOString(),
      status: 'FRESH' as const,
    };

    const closed = engine.closePositionManually(pos.positionId, exitQuote as any);
    assert(closed === true, 'Position successfully closed');

    const entries = journalSvc.getEntries();
    assert(entries.length > 0, 'Trade journal recorded the closed position');

    const journalEntry = entries[entries.length - 1];
    const facts = journalEntry.provenance.fact;
    const hasCommissionFact = facts.some((f) => f.includes('Commission') && f.includes('USER CONFIGURED SIMULATION PARAMETER'));
    assert(hasCommissionFact, 'Journal entry facts record explicit user configured commission provenance');
  }

  console.log(`\n====================================================`);
  console.log(`ALL FRICTION INTEGRITY TESTS PASSED (${passed}/${total})`);
  console.log(`====================================================\n`);
}

runFrictionIntegrityTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

