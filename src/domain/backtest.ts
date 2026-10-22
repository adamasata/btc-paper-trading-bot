import { DEFAULT_PARAMETERS, causalTrendSignal, hasBearishCross, isActivityProbeOpportunity } from './strategy';
import type { BacktestResult, Candle, CompletedTrade, ExitReason, StrategyParameters, TradeKind } from './types';

type OpenPosition = {
  kind: TradeKind;
  buyTime: number;
  buyPrice: number;
  quantityBtc: number;
  allocatedCashUsd: number;
  reserveCashUsd: number;
  buyFeeUsd: number;
  costUsd: number;
};

const MINUTE = 60_000;

function assertCandles(candles: Candle[]): void {
  if (candles.length < 3) throw new Error('At least three candles are required for a replay.');
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!Number.isFinite(candle.open) || !Number.isFinite(candle.close) || candle.open <= 0 || candle.close <= 0) {
      throw new Error(`Invalid price at candle ${index}.`);
    }
    if (index > 0 && candle.openTime <= candles[index - 1].openTime) {
      throw new Error('Candles must be strictly chronological.');
    }
  }
}

function assertParameters(parameters: StrategyParameters): void {
  const valid = parameters.initialCash > 0
    && parameters.feeRate >= 0
    && parameters.historyBars >= parameters.emaTrendPeriod
    && parameters.emaFastPeriod > 0
    && parameters.emaSlowPeriod > 0
    && parameters.emaTrendPeriod > 0
    && parameters.emaTrendSlopeMinutes > 0
    && parameters.coreTakeProfitRate >= 0
    && parameters.coreStopLossRate >= 0
    && parameters.coreMaxHoldMinutes > 0
    && parameters.coreTradeLimitPerWindow >= 0
    && parameters.activityProbeIntervalMinutes > 0
    && parameters.activityProbeCount >= 0
    && parameters.activityProbeAllocationRate > 0
    && parameters.activityProbeAllocationRate <= 1
    && parameters.activityProbeHoldMinutes > 0;
  if (!valid) throw new Error('Strategy parameters are outside their valid range.');
}

function executeBuy(
  availableCashUsd: number,
  allocationRate: number,
  price: number,
  time: number,
  feeRate: number,
  kind: TradeKind,
): OpenPosition {
  const allocatedCashUsd = availableCashUsd * allocationRate;
  const quantityBtc = allocatedCashUsd / (price * (1 + feeRate));
  const buyFeeUsd = quantityBtc * price * feeRate;
  return {
    kind,
    buyTime: time,
    buyPrice: price,
    quantityBtc,
    allocatedCashUsd,
    reserveCashUsd: availableCashUsd - allocatedCashUsd,
    buyFeeUsd,
    costUsd: allocatedCashUsd,
  };
}

function executeSell(position: OpenPosition, price: number, time: number, feeRate: number, exitReason: ExitReason, id: number): CompletedTrade {
  const grossProceedsUsd = position.quantityBtc * price;
  const sellFeeUsd = grossProceedsUsd * feeRate;
  const proceedsUsd = grossProceedsUsd - sellFeeUsd;
  const profitUsd = proceedsUsd - position.costUsd;
  return {
    id,
    kind: position.kind,
    buyTime: position.buyTime,
    sellTime: time,
    buyPrice: position.buyPrice,
    sellPrice: price,
    quantityBtc: position.quantityBtc,
    allocatedCashUsd: position.allocatedCashUsd,
    reserveCashUsd: position.reserveCashUsd,
    buyFeeUsd: position.buyFeeUsd,
    sellFeeUsd,
    costUsd: position.costUsd,
    proceedsUsd,
    profitUsd,
    profitPercent: (profitUsd / position.costUsd) * 100,
    exitReason,
  };
}

function exitReasonForPosition(
  position: OpenPosition,
  candles: Candle[],
  observedIndex: number,
  parameters: StrategyParameters,
): ExitReason | null {
  const observed = candles[observedIndex];
  const heldMinutes = (observed.openTime - position.buyTime) / MINUTE;

  if (position.kind === 'activity-probe') {
    return heldMinutes >= parameters.activityProbeHoldMinutes - 1 ? 'scheduled-exit' : null;
  }

  const observedReturn = observed.close / position.buyPrice - 1;
  if (observedReturn >= parameters.coreTakeProfitRate) return 'take-profit';
  if (observedReturn <= -parameters.coreStopLossRate) return 'stop-loss';
  if (hasBearishCross(candles, observedIndex, parameters)) return 'bearish-cross';
  return heldMinutes >= parameters.coreMaxHoldMinutes - 1 ? 'time-limit' : null;
}

/**
 * Deterministic long-only replay. All decisions use completed closes through
 * candle i and execute only at candle i + 1's open. The final close is the
 * sole exception, explicitly labelled `forced-close`, to guarantee a flat end.
 */
export function runBacktest(candles: Candle[], overrides: Partial<StrategyParameters> = {}): BacktestResult {
  assertCandles(candles);
  const parameters = { ...DEFAULT_PARAMETERS, ...overrides };
  assertParameters(parameters);

  let cashUsd = parameters.initialCash;
  let position: OpenPosition | null = null;
  let coreTradeCount = 0;
  const trades: CompletedTrade[] = [];

  // The last candle is reserved for a potential forced close, never a signal fill.
  for (let index = parameters.historyBars - 1; index < candles.length - 1; index += 1) {
    const observed = candles[index];
    const fill = candles[index + 1];

    if (position) {
      const reason = exitReasonForPosition(position, candles, index, parameters);
      if (reason) {
        const trade = executeSell(position, fill.open, fill.openTime, parameters.feeRate, reason, trades.length + 1);
        trades.push(trade);
        cashUsd += trade.proceedsUsd;
        position = null;
      }
      continue;
    }

    const trend = causalTrendSignal(candles, index, parameters);
    const coreEntry = coreTradeCount < parameters.coreTradeLimitPerWindow
      && trend !== null
      && trend.ema10 > trend.ema20
      && observed.close > trend.ema60
      && trend.ema60 > trend.ema60TenMinutesAgo;

    // At a simultaneous opportunity, the core entry is evaluated first. Probes
    // are fixed in advance and never use prices to choose their schedule.
    if (coreEntry) {
      position = executeBuy(cashUsd, 1, fill.open, fill.openTime, parameters.feeRate, 'core-trend');
      cashUsd = position.reserveCashUsd;
      coreTradeCount += 1;
    } else if (isActivityProbeOpportunity(index, parameters)) {
      position = executeBuy(
        cashUsd,
        parameters.activityProbeAllocationRate,
        fill.open,
        fill.openTime,
        parameters.feeRate,
        'activity-probe',
      );
      cashUsd = position.reserveCashUsd;
    }
  }

  if (position) {
    const last = candles[candles.length - 1];
    const trade = executeSell(position, last.close, last.openTime + MINUTE, parameters.feeRate, 'forced-close', trades.length + 1);
    trades.push(trade);
    cashUsd += trade.proceedsUsd;
  }

  const firstPrice = candles[0].open;
  const lastPrice = candles[candles.length - 1].close;
  const buyHoldQuantity = parameters.initialCash / (firstPrice * (1 + parameters.feeRate));
  const buyAndHoldFinalUsd = buyHoldQuantity * lastPrice * (1 - parameters.feeRate);
  const activityProbeTradeCount = trades.filter((trade) => trade.kind === 'activity-probe').length;

  return {
    trades,
    finalBalanceUsd: cashUsd,
    endingBtc: 0,
    profitUsd: cashUsd - parameters.initialCash,
    profitPercent: ((cashUsd - parameters.initialCash) / parameters.initialCash) * 100,
    buyAndHoldFinalUsd,
    buyAndHoldProfitUsd: buyAndHoldFinalUsd - parameters.initialCash,
    totalFeesUsd: trades.reduce((sum, trade) => sum + trade.buyFeeUsd + trade.sellFeeUsd, 0),
    coreTradeCount,
    activityProbeTradeCount,
    candleCount: candles.length,
    firstCandleTime: candles[0].openTime,
    lastCandleTime: candles[candles.length - 1].openTime + MINUTE,
    parameters,
  };
}
