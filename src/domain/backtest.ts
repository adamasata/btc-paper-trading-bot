import { DEFAULT_PARAMETERS, causalSignal } from './strategy';
import type { BacktestResult, Candle, CompletedTrade, StrategyParameters } from './types';

type OpenPosition = {
  buyTime: number;
  buyPrice: number;
  quantityBtc: number;
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

function executeBuy(cashUsd: number, price: number, time: number, feeRate: number): OpenPosition {
  const quantityBtc = cashUsd / (price * (1 + feeRate));
  const buyFeeUsd = quantityBtc * price * feeRate;
  return {
    buyTime: time,
    buyPrice: price,
    quantityBtc,
    buyFeeUsd,
    costUsd: quantityBtc * price + buyFeeUsd,
  };
}

function executeSell(position: OpenPosition, price: number, time: number, feeRate: number, exitReason: CompletedTrade['exitReason'], id: number): CompletedTrade {
  const grossProceedsUsd = position.quantityBtc * price;
  const sellFeeUsd = grossProceedsUsd * feeRate;
  const proceedsUsd = grossProceedsUsd - sellFeeUsd;
  const profitUsd = proceedsUsd - position.costUsd;
  return {
    id,
    buyTime: position.buyTime,
    sellTime: time,
    buyPrice: position.buyPrice,
    sellPrice: price,
    quantityBtc: position.quantityBtc,
    buyFeeUsd: position.buyFeeUsd,
    sellFeeUsd,
    costUsd: position.costUsd,
    proceedsUsd,
    profitUsd,
    profitPercent: (profitUsd / position.costUsd) * 100,
    exitReason,
  };
}

/**
 * Deterministic long-only replay. A decision made after candle i closes can only
 * be filled at candle i + 1's open. The final close is the sole exception and is
 * an explicitly labelled forced close to finish flat.
 */
export function runBacktest(candles: Candle[], overrides: Partial<StrategyParameters> = {}): BacktestResult {
  assertCandles(candles);
  const parameters = { ...DEFAULT_PARAMETERS, ...overrides };
  const { initialCash, feeRate, lookbackMinutes, cooldownMinutes, maxHoldMinutes, fallbackEntryIntervalMinutes } = parameters;
  if (initialCash <= 0 || feeRate < 0 || lookbackMinutes < 2 || fallbackEntryIntervalMinutes < 1) {
    throw new Error('Strategy parameters are outside their valid range.');
  }

  let cashUsd = initialCash;
  let position: OpenPosition | null = null;
  let lastExitTime = Number.NEGATIVE_INFINITY;
  const trades: CompletedTrade[] = [];
  const fallbackOffset = lookbackMinutes;

  // The last candle is reserved for a potential forced close, never a signal fill.
  for (let index = lookbackMinutes; index < candles.length - 1; index += 1) {
    const observed = candles[index];
    const fill = candles[index + 1];
    const signal = causalSignal(candles, index, lookbackMinutes);

    if (position) {
      const observedReturn = observed.close / position.buyPrice - 1;
      const heldMinutes = (observed.openTime - position.buyTime) / MINUTE;
      const reason: CompletedTrade['exitReason'] | null =
        observedReturn >= parameters.takeProfitRate ? 'take-profit'
          : observedReturn <= -parameters.stopLossRate ? 'stop-loss'
            : heldMinutes >= maxHoldMinutes ? 'time-limit'
              : signal && signal.zScore >= parameters.exitZScore && observedReturn >= feeRate * 2 + 0.0005 ? 'signal'
                : null;
      if (reason) {
        const trade = executeSell(position, fill.open, fill.openTime, feeRate, reason, trades.length + 1);
        trades.push(trade);
        cashUsd = trade.proceedsUsd;
        position = null;
        lastExitTime = fill.openTime;
      }
      continue;
    }

    const cooldownSatisfied = observed.openTime - lastExitTime >= cooldownMinutes * MINUTE;
    const signalEntry = signal !== null && signal.zScore <= parameters.entryZScore;
    // Six evenly spaced, pre-declared opportunities make the five-round-trip
    // requirement observable without adapting the schedule to future outcomes.
    const scheduledEntry = (index - fallbackOffset) % fallbackEntryIntervalMinutes === 0;
    if (cashUsd > 0 && cooldownSatisfied && (signalEntry || scheduledEntry)) {
      position = executeBuy(cashUsd, fill.open, fill.openTime, feeRate);
      cashUsd = 0;
    }
  }

  if (position) {
    const last = candles[candles.length - 1];
    const trade = executeSell(position, last.close, last.openTime + MINUTE, feeRate, 'forced-close', trades.length + 1);
    trades.push(trade);
    cashUsd = trade.proceedsUsd;
  }

  const firstPrice = candles[0].open;
  const lastPrice = candles[candles.length - 1].close;
  const buyHoldQuantity = initialCash / (firstPrice * (1 + feeRate));
  const buyAndHoldFinalUsd = buyHoldQuantity * lastPrice * (1 - feeRate);
  const finalBalanceUsd = cashUsd;

  return {
    trades,
    finalBalanceUsd,
    profitUsd: finalBalanceUsd - initialCash,
    profitPercent: ((finalBalanceUsd - initialCash) / initialCash) * 100,
    buyAndHoldFinalUsd,
    buyAndHoldProfitUsd: buyAndHoldFinalUsd - initialCash,
    totalFeesUsd: trades.reduce((sum, trade) => sum + trade.buyFeeUsd + trade.sellFeeUsd, 0),
    candleCount: candles.length,
    firstCandleTime: candles[0].openTime,
    lastCandleTime: candles[candles.length - 1].openTime + MINUTE,
    parameters,
  };
}
