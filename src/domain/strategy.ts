import type { Candle, StrategyParameters } from './types';

export const DEFAULT_PARAMETERS: StrategyParameters = {
  initialCash: 10_000,
  feeRate: 0.001,
  lookbackMinutes: 30,
  entryZScore: -3,
  exitZScore: 0.25,
  takeProfitRate: 0.0032,
  stopLossRate: 0.0065,
  maxHoldMinutes: 10,
  cooldownMinutes: 20,
  fallbackEntryIntervalMinutes: 240,
};

export type Signal = { zScore: number; mean: number; standardDeviation: number };

/**
 * Measures the close of candle[index] against prior closes only. This is called
 * only after that candle has closed; orders are filled at candle[index + 1].open.
 */
export function causalSignal(candles: Candle[], index: number, lookback: number): Signal | null {
  if (index < lookback) return null;

  const closes = candles.slice(index - lookback, index).map((candle) => candle.close);
  const mean = closes.reduce((sum, close) => sum + close, 0) / closes.length;
  const variance = closes.reduce((sum, close) => sum + (close - mean) ** 2, 0) / closes.length;
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation === 0) return null;

  return {
    mean,
    standardDeviation,
    zScore: (candles[index].close - mean) / standardDeviation,
  };
}
