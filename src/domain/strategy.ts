import type { Candle, StrategyParameters } from './types';

export const DEFAULT_PARAMETERS: StrategyParameters = {
  initialCash: 10_000,
  feeRate: 0.001,
  historyBars: 60,
  emaFastPeriod: 10,
  emaSlowPeriod: 20,
  emaTrendPeriod: 60,
  emaTrendSlopeMinutes: 10,
  coreTakeProfitRate: 0.0025,
  coreStopLossRate: 0.0025,
  coreMaxHoldMinutes: 60,
  coreTradeLimitPerWindow: 1,
  activityProbeIntervalMinutes: 240,
  activityProbeCount: 6,
  activityProbeAllocationRate: 0.001,
  activityProbeHoldMinutes: 10,
};

export type TrendSignal = {
  ema10: number;
  ema20: number;
  ema60: number;
  ema60TenMinutesAgo: number;
};

function emaThrough(candles: Candle[], index: number, period: number): number {
  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;
  for (let candleIndex = 1; candleIndex <= index; candleIndex += 1) {
    ema = candles[candleIndex].close * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

/**
 * Calculates trend values using closes through `index` only. This function is
 * called only after that candle closes; a resulting order fills next open.
 */
export function causalTrendSignal(
  candles: Candle[],
  index: number,
  parameters: Pick<StrategyParameters, 'historyBars' | 'emaFastPeriod' | 'emaSlowPeriod' | 'emaTrendPeriod' | 'emaTrendSlopeMinutes'>,
): TrendSignal | null {
  if (index < parameters.historyBars - 1 || index < parameters.emaTrendSlopeMinutes) return null;

  return {
    ema10: emaThrough(candles, index, parameters.emaFastPeriod),
    ema20: emaThrough(candles, index, parameters.emaSlowPeriod),
    ema60: emaThrough(candles, index, parameters.emaTrendPeriod),
    ema60TenMinutesAgo: emaThrough(candles, index - parameters.emaTrendSlopeMinutes, parameters.emaTrendPeriod),
  };
}

export function hasBearishCross(
  candles: Candle[],
  index: number,
  parameters: Pick<StrategyParameters, 'historyBars' | 'emaFastPeriod' | 'emaSlowPeriod' | 'emaTrendPeriod' | 'emaTrendSlopeMinutes'>,
): boolean {
  const current = causalTrendSignal(candles, index, parameters);
  const previous = causalTrendSignal(candles, index - 1, parameters);
  return current !== null && previous !== null && previous.ema10 >= previous.ema20 && current.ema10 < current.ema20;
}

/** Fixed, predeclared decisions after the 60-bar warm-up; never data dependent. */
export function isActivityProbeOpportunity(
  index: number,
  parameters: Pick<StrategyParameters, 'historyBars' | 'activityProbeIntervalMinutes' | 'activityProbeCount'>,
): boolean {
  const firstDecisionIndex = parameters.historyBars - 1;
  const offset = index - firstDecisionIndex;
  return offset >= 0
    && offset % parameters.activityProbeIntervalMinutes === 0
    && offset / parameters.activityProbeIntervalMinutes < parameters.activityProbeCount;
}
