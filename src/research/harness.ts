import type { Candle } from '../domain/types';

const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = DAY_MINUTES * MINUTE_MS;
const INITIAL_CASH_USD = 10_000;
const FEE_RATE = 0.001;
const QUALIFICATION_SLEEVE_USD = 100;
const GENUINE_SLEEVE_USD = INITIAL_CASH_USD - QUALIFICATION_SLEEVE_USD;
const QUALIFICATION_TARGET_ROUND_TRIPS = 5;

export type ResearchCandidate = {
  id: string;
  family: string;
  allocationRate: number;
  params: Record<string, unknown>;
};

export type ResearchWindow = {
  offsetHours: number;
  startTime: number;
  endTime: number;
  startIndex: number;
  endIndex: number;
  partition: 'development' | 'holdout';
};

export type WindowSet = { offsetHours: number; windows: ResearchWindow[] };

type Trade = { profitUsd: number; feesUsd: number; returnFraction: number };

type Accounting = {
  roundTrips: number;
  profitUsd: number;
  feesUsd: number;
  allocatedSleeveUsd: number;
  trades: Trade[];
};

export type WindowEvaluation = {
  candidateId: string;
  startTime: number;
  endTime: number;
  genuine: Accounting;
  qualification: Accounting;
  total: Accounting;
  returnFraction: number;
  endsFlat: boolean;
};

export type AggregateMetrics = {
  windows: number;
  positiveWindows: number;
  negativeWindows: number;
  flatWindows: number;
  positiveWindowRatio: number;
  meanReturn: number;
  medianReturn: number;
  expectancyUsd: number;
  profitFactor: number | null;
  worstWindowLoss: number;
  maxDrawdown: number;
  totalProfitUsd: number;
  largestPositiveWindowProfitUsd: number;
  genuineProfitUsd: number;
  qualificationProfitUsd: number;
  genuineFeesUsd: number;
  qualificationFeesUsd: number;
  genuineRoundTrips: number;
  qualificationRoundTrips: number;
};

export type CandidateMetrics = {
  candidate: ResearchCandidate;
  aggregate: AggregateMetrics;
  byOffset: Record<string, AggregateMetrics>;
};

type Position = { entryPrice: number; allocatedCashUsd: number; entryIndex: number; exitTargetPrice?: number };

export type CandleStreakCycle = {
  signalIndex: number;
  entryIndices: [number, number, number, number, number];
  exitIndex: number;
};

type SignalContext = {
  candles: Candle[];
  closes: number[];
  ema: (period: number, index: number) => number | null;
  index: number;
  candle: Candle;
};

function assertMinuteCandles(candles: Candle[]): void {
  if (candles.length < DAY_MINUTES + 1) throw new Error('Research requires at least one complete 24-hour window plus its boundary open.');
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!Number.isFinite(candle.openTime) || !Number.isFinite(candle.open) || !Number.isFinite(candle.close) || candle.open <= 0 || candle.close <= 0) {
      throw new Error(`Invalid candle at index ${index}.`);
    }
    if (index > 0 && candle.openTime - candles[index - 1].openTime !== MINUTE_MS) throw new Error('Research candles must be contiguous one-minute candles.');
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function makeAccounting(trades: Trade[], allocatedSleeveUsd: number): Accounting {
  return {
    roundTrips: trades.length,
    profitUsd: trades.reduce((sum, trade) => sum + trade.profitUsd, 0),
    feesUsd: trades.reduce((sum, trade) => sum + trade.feesUsd, 0),
    allocatedSleeveUsd,
    trades,
  };
}

function tradeFor(entryPrice: number, exitPrice: number, allocatedCashUsd: number): Trade {
  const quantity = allocatedCashUsd / (entryPrice * (1 + FEE_RATE));
  const entryFeeUsd = quantity * entryPrice * FEE_RATE;
  const grossProceedsUsd = quantity * exitPrice;
  const exitFeeUsd = grossProceedsUsd * FEE_RATE;
  const profitUsd = grossProceedsUsd - exitFeeUsd - allocatedCashUsd;
  return { profitUsd, feesUsd: entryFeeUsd + exitFeeUsd, returnFraction: profitUsd / allocatedCashUsd };
}

function tradeForFiveEntries(candles: Candle[], cycle: CandleStreakCycle, allocatedCashUsd: number): Trade {
  const trancheCashUsd = allocatedCashUsd / cycle.entryIndices.length;
  const entries = cycle.entryIndices.map((entryIndex) => {
    const price = candles[entryIndex].open;
    const quantity = trancheCashUsd / (price * (1 + FEE_RATE));
    return { quantity, feeUsd: quantity * price * FEE_RATE };
  });
  const quantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const exitPrice = candles[cycle.exitIndex].open;
  const grossProceedsUsd = quantity * exitPrice;
  const exitFeeUsd = grossProceedsUsd * FEE_RATE;
  const profitUsd = grossProceedsUsd - exitFeeUsd - allocatedCashUsd;
  return { profitUsd, feesUsd: entries.reduce((sum, entry) => sum + entry.feeUsd, 0) + exitFeeUsd, returnFraction: profitUsd / allocatedCashUsd };
}

/** Finds non-overlapping causal five-entry cycles within a window. */
export function candleStreakCycles(candles: Candle[], startIndex: number, endIndex: number): CandleStreakCycle[] {
  const cycles: CandleStreakCycle[] = [];
  for (let index = Math.max(startIndex, 2); index + 6 <= endIndex; index += 1) {
    const greenStreak = candles[index - 2].close > candles[index - 2].open
      && candles[index - 1].close > candles[index - 1].open
      && candles[index].close > candles[index].open;
    if (!greenStreak) continue;
    cycles.push({ signalIndex: index, entryIndices: [index + 1, index + 2, index + 3, index + 4, index + 5], exitIndex: index + 6 });
    // Entries through index+5 are active. The exit candle may complete a new
    // signal, so it remains eligible as the next signal index.
    index += 5;
  }
  return cycles;
}

function emaSeries(closes: number[], period: number): number[] {
  const values: number[] = [];
  const multiplier = 2 / (period + 1);
  let previous = closes[0];
  for (let index = 0; index < closes.length; index += 1) {
    previous = index === 0 ? closes[0] : closes[index] * multiplier + previous * (1 - multiplier);
    values.push(previous);
  }
  return values;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function naturalNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

function params(candidate: ResearchCandidate, key: string): number {
  const value = finiteNumber(candidate.params[key]);
  if (value === null) throw new Error(`${candidate.id} has no finite ${key}.`);
  return value;
}

function sessionHours(candidate: ResearchCandidate): number[] {
  const value = candidate.params.sessionsUtcHour;
  if (!Array.isArray(value) || value.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) throw new Error(`${candidate.id} has invalid sessionsUtcHour.`);
  return value as number[];
}

function minutesSinceUtcSessionStart(openTime: number, sessionHour: number): number {
  const date = new Date(openTime);
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (minuteOfDay - sessionHour * 60 + 24 * 60) % (24 * 60);
}

function isGreen(candle: Candle): boolean {
  return candle.close > candle.open;
}

function isEntrySignal(candidate: ResearchCandidate, context: SignalContext): boolean {
  const { candles, closes, index, candle, ema } = context;
  if (candidate.family === 'cash') return false;
  if (candidate.family === 'buy-and-hold') return false;
  if (candidate.family === 'v1') {
    const fast = ema(10, index);
    const slow = ema(20, index);
    const trend = ema(60, index);
    const priorTrend = ema(60, index - 10);
    return fast !== null && slow !== null && trend !== null && priorTrend !== null && fast > slow && candle.close > trend && trend > priorTrend;
  }
  if (candidate.family === 'selective-regime-pullback') {
    const fastPeriod = naturalNumber(candidate.params.fastEma);
    const slowPeriod = naturalNumber(candidate.params.slowEma);
    const trendPeriod = naturalNumber(candidate.params.trendEma);
    const pullback = params(candidate, 'pullbackFraction');
    if (fastPeriod === null || slowPeriod === null || trendPeriod === null) throw new Error(`${candidate.id} has invalid EMA periods.`);
    const fast = ema(fastPeriod, index);
    const slow = ema(slowPeriod, index);
    const trend = ema(trendPeriod, index);
    return fast !== null && slow !== null && trend !== null && fast > slow && slow > trend && candle.close > trend && candle.close <= fast * (1 - pullback);
  }
  if (candidate.family === 'volatility-contraction-breakout-retest') {
    const lookback = naturalNumber(candidate.params.breakoutLookbackMinutes);
    const contraction = params(candidate, 'contractionRatioMax');
    const tolerance = params(candidate, 'retestToleranceFraction');
    if (lookback === null || index < 2 * lookback) return false;
    const high = Math.max(...closes.slice(index - lookback, index));
    const currentReturns = closes.slice(index - lookback + 1, index + 1).map((price, offset, values) => offset === 0 ? 0 : price / values[offset - 1] - 1).slice(1);
    const prior = closes.slice(index - 2 * lookback, index - lookback + 1);
    const priorReturns = prior.map((price, offset) => offset === 0 ? 0 : price / prior[offset - 1] - 1).slice(1);
    const currentVolatility = standardDeviation(currentReturns);
    const priorVolatility = standardDeviation(priorReturns);
    return priorVolatility > 0 && currentVolatility / priorVolatility <= contraction && candle.close > high && closes[index - 1] >= high * (1 - tolerance);
  }
  if (candidate.family === 'range-regime-mean-reversion') {
    const lookback = naturalNumber(candidate.params.lookbackMinutes);
    const maxTrend = params(candidate, 'maxTrendFraction');
    const entryZScore = params(candidate, 'entryZScore');
    if (lookback === null || index < lookback) return false;
    const values = closes.slice(index - lookback, index);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = standardDeviation(values);
    const trend = Math.abs(candle.close / closes[index - lookback] - 1);
    const zScore = deviation === 0 ? 0 : (candle.close - average) / deviation;
    return trend <= maxTrend && zScore <= entryZScore;
  }
  if (candidate.family === 'session-momentum') {
    const lookback = naturalNumber(candidate.params.lookbackMinutes);
    const minimumMomentum = params(candidate, 'minimumMomentumFraction');
    if (lookback === null || index < lookback) return false;
    const hour = new Date(candle.openTime).getUTCHours();
    return sessionHours(candidate).includes(hour) && candle.close / closes[index - lookback] - 1 >= minimumMomentum;
  }
  if (candidate.family === 'green-streak-continuation' || candidate.family === 'red-streak-mean-reversion') {
    const length = naturalNumber(candidate.params.streakLength);
    const minimumReturn = params(candidate, 'minimumReturnFraction');
    if (length === null || index < length - 1) return false;
    const streak = candlesForContext(context, length);
    const green = candidate.family === 'green-streak-continuation';
    if (!streak.every((entry) => green ? entry.close > entry.open : entry.close < entry.open)) return false;
    const returnFraction = streak[streak.length - 1].close / streak[0].open - 1;
    return green ? returnFraction >= minimumReturn : -returnFraction >= minimumReturn;
  }
  if (candidate.family === 'green-streak-delayed-continuation') {
    const length = naturalNumber(candidate.params.streakLength);
    const minimumReturn = params(candidate, 'minimumReturnFraction');
    if (length === null || index < length) return false;
    const streak = candlesForContext({ ...context, index: index - 1, candle: { ...candle } }, length);
    if (candle.close > candle.open || !streak.every((entry) => entry.close > entry.open)) return false;
    return streak[streak.length - 1].close / streak[0].open - 1 >= minimumReturn;
  }
  if (candidate.family === 'majority-momentum') {
    const length = naturalNumber(candidate.params.lookbackLength);
    const minimumGreen = naturalNumber(candidate.params.minimumGreen);
    const minimumReturn = params(candidate, 'minimumReturnFraction');
    if (length === null || minimumGreen === null || index < length - 1) return false;
    const lookback = candlesForContext(context, length);
    return lookback.filter((entry) => entry.close > entry.open).length >= minimumGreen
      && lookback[lookback.length - 1].close / lookback[0].open - 1 >= minimumReturn;
  }
  if (candidate.family === 'utc-opening-range-breakout') {
    const sessionHour = params(candidate, 'sessionUtcHour');
    const rangeMinutes = naturalNumber(candidate.params.rangeMinutes);
    const buffer = params(candidate, 'breakoutBufferFraction');
    if (rangeMinutes === null || ![0, 6, 12, 18].includes(sessionHour)) return false;
    const elapsed = minutesSinceUtcSessionStart(candle.openTime, sessionHour);
    if (elapsed < rangeMinutes || elapsed >= 360 || index < rangeMinutes) return false;
    const range = candles.slice(index - elapsed, index - elapsed + rangeMinutes);
    const high = Math.max(...range.map((entry) => Math.max(entry.open, entry.close)));
    return candle.close > high * (1 + buffer);
  }
  if (candidate.family === 'session-dip-recovery') {
    const sessionHour = params(candidate, 'sessionUtcHour');
    const lookback = naturalNumber(candidate.params.declineLookbackMinutes);
    const decline = params(candidate, 'minimumDeclineFraction');
    const greens = naturalNumber(candidate.params.recoveryGreenCandles);
    if (lookback === null || greens === null || ![0, 6, 12, 18].includes(sessionHour) || index < lookback + greens - 1) return false;
    const elapsed = minutesSinceUtcSessionStart(candle.openTime, sessionHour);
    if (elapsed >= 360 || elapsed < lookback + greens - 1) return false;
    const recovery = candles.slice(index - greens + 1, index + 1);
    return candle.close / closes[index - lookback] - 1 <= -decline && recovery.every(isGreen);
  }
  if (candidate.family === 'volatility-expansion-continuation') {
    const lookback = naturalNumber(candidate.params.quietLookbackMinutes);
    const quietRange = params(candidate, 'quietRangeMaxFraction');
    const breakout = params(candidate, 'breakoutCandleFraction');
    if (lookback === null || index < lookback) return false;
    const prior = closes.slice(index - lookback, index);
    const realizedRange = Math.max(...prior) / Math.min(...prior) - 1;
    return realizedRange <= quietRange && candle.close / candle.open - 1 >= breakout;
  }
  if (candidate.family === 'daily-time-bias') {
    const hour = params(candidate, 'entryUtcHour');
    const priorFourHourSign = params(candidate, 'priorFourHourSign');
    if (new Date(candle.openTime).getUTCHours() !== hour || new Date(candle.openTime).getUTCMinutes() !== 0 || index < 240) return false;
    const priorReturn = candle.close / closes[index - 240] - 1;
    return priorFourHourSign === 0 || (priorFourHourSign > 0 ? priorReturn > 0 : priorReturn < 0);
  }
  if (candidate.family === 'long-horizon-trend-pullback') {
    const trend = params(candidate, 'minimumFourHourReturnFraction');
    const pullback = params(candidate, 'minimumThirtyMinutePullbackFraction');
    if (index < 240) return false;
    const longReturn = candle.close / closes[index - 240] - 1;
    const pullbackReturn = candle.close / closes[index - 30] - 1;
    return longReturn >= trend && pullbackReturn <= -pullback && isGreen(candle);
  }
  if (candidate.family === 'range-mean-reversion') {
    const maxTrend = params(candidate, 'maxSixHourTrendFraction');
    const bottomFraction = params(candidate, 'bottomRangeFraction');
    if (index < 360) return false;
    const range = closes.slice(index - 360, index);
    const low = Math.min(...range);
    const high = Math.max(...range);
    const trendMagnitude = Math.abs(candle.close / closes[index - 360] - 1);
    return high > low && trendMagnitude <= maxTrend && candle.close <= low + (high - low) * bottomFraction;
  }
  throw new Error(`Unknown research candidate family: ${candidate.family}.`);
}

function candlesForContext(context: SignalContext, length: number): Candle[] {
  const firstIndex = context.index - length + 1;
  return context.candles.slice(firstIndex, context.index + 1);
}

function exitSignal(candidate: ResearchCandidate, position: Position, index: number, closes: number[], ema: (period: number, index: number) => number | null): boolean {
  const heldMinutes = index - position.entryIndex;
  if (candidate.family === 'green-streak-continuation' || candidate.family === 'red-streak-mean-reversion' || candidate.family === 'green-streak-delayed-continuation' || candidate.family === 'majority-momentum') {
    return heldMinutes >= params(candidate, 'holdMinutes') - 1;
  }
  if (candidate.family === 'utc-opening-range-breakout' || candidate.family === 'session-dip-recovery' || candidate.family === 'volatility-expansion-continuation' || candidate.family === 'daily-time-bias' || candidate.family === 'long-horizon-trend-pullback') return heldMinutes >= params(candidate, 'holdMinutes') - 1;
  if (candidate.family === 'range-mean-reversion') return (position.exitTargetPrice !== undefined && closes[index] >= position.exitTargetPrice) || heldMinutes >= params(candidate, 'timeoutMinutes') - 1;
  const returnFraction = closes[index] / position.entryPrice - 1;
  if (candidate.family === 'cash') return false;
  const takeProfit = candidate.family === 'v1' ? 0.0025 : params(candidate, 'takeProfitFraction');
  const stopLoss = candidate.family === 'v1' ? 0.0025 : params(candidate, 'stopLossFraction');
  const maxHold = candidate.family === 'v1' ? 60 : params(candidate, 'maxHoldMinutes');
  const bearishCross = candidate.family === 'v1'
    && ema(10, index) !== null
    && ema(20, index) !== null
    && ema(10, index - 1) !== null
    && ema(20, index - 1) !== null
    && (ema(10, index - 1) as number) >= (ema(20, index - 1) as number)
    && (ema(10, index) as number) < (ema(20, index) as number);
  return returnFraction >= takeProfit || returnFraction <= -stopLoss || heldMinutes >= maxHold - 1 || bearishCross;
}

function evaluateFiveEntryCandleStreak(candles: Candle[], startIndex: number, endIndex: number, candidate: ResearchCandidate): Accounting {
  if (candidate.allocationRate <= 0 || candidate.allocationRate > 1) throw new Error(`${candidate.id} has invalid allocationRate.`);
  const trades: Trade[] = [];
  let cashUsd = GENUINE_SLEEVE_USD;
  for (const cycle of candleStreakCycles(candles, startIndex, endIndex)) {
    const allocatedCashUsd = Math.min(GENUINE_SLEEVE_USD * candidate.allocationRate, cashUsd);
    if (allocatedCashUsd <= 0) break;
    const trade = tradeForFiveEntries(candles, cycle, allocatedCashUsd);
    trades.push(trade);
    cashUsd += trade.profitUsd;
  }
  return makeAccounting(trades, GENUINE_SLEEVE_USD);
}

function evaluateGenuine(candles: Candle[], startIndex: number, endIndex: number, candidate: ResearchCandidate): Accounting {
  if (candidate.family === 'buy-and-hold') {
    // This predeclared baseline is continuously long: its decision predates the
    // window, it fills at the window's first observable open, and it force-closes
    // at the observable boundary open without inspecting later data.
    return makeAccounting([tradeFor(candles[startIndex].open, candles[endIndex].open, GENUINE_SLEEVE_USD)], GENUINE_SLEEVE_USD);
  }
  if (candidate.family === 'five-entry-green-candle-streak') return evaluateFiveEntryCandleStreak(candles, startIndex, endIndex, candidate);
  const closes = candles.map((candle) => candle.close);
  const emaCache = new Map<number, number[]>();
  const ema = (period: number, index: number): number | null => {
    if (index < 0 || index < period - 1) return null;
    let values = emaCache.get(period);
    if (!values) {
      values = emaSeries(closes, period);
      emaCache.set(period, values);
    }
    return values[index];
  };
  const trades: Trade[] = [];
  let position: Position | null = null;
  let cashUsd = GENUINE_SLEEVE_USD;
  let v1Entered = false;
  for (let index = startIndex; index < endIndex - 1; index += 1) {
    if (position) {
      if (exitSignal(candidate, position, index, closes, ema)) {
        const trade = tradeFor(position.entryPrice, candles[index + 1].open, position.allocatedCashUsd);
        trades.push(trade);
        cashUsd += position.allocatedCashUsd + trade.profitUsd;
        position = null;
      }
      continue;
    }
    if ((!v1Entered || candidate.family !== 'v1') && isEntrySignal(candidate, { candles, closes, ema, index, candle: candles[index] })) {
      const fixedPattern = candidate.family === 'green-streak-continuation' || candidate.family === 'red-streak-mean-reversion' || candidate.family === 'green-streak-delayed-continuation' || candidate.family === 'majority-momentum';
      const allocatedCashUsd = fixedPattern ? Math.min(GENUINE_SLEEVE_USD * candidate.allocationRate, cashUsd) : cashUsd * candidate.allocationRate;
      if (allocatedCashUsd <= 0 || candidate.allocationRate <= 0 || candidate.allocationRate > 1) throw new Error(`${candidate.id} has invalid allocationRate.`);
      cashUsd -= allocatedCashUsd;
      const rangeTarget = candidate.family === 'range-mean-reversion'
        ? (() => { const range = closes.slice(index - 360, index); return (Math.min(...range) + Math.max(...range)) / 2; })()
        : undefined;
      position = { entryPrice: candles[index + 1].open, allocatedCashUsd, entryIndex: index + 1, exitTargetPrice: rangeTarget };
      v1Entered ||= candidate.family === 'v1';
    }
  }
  if (position) {
    const trade = tradeFor(position.entryPrice, candles[endIndex].open, position.allocatedCashUsd);
    trades.push(trade);
  }
  return makeAccounting(trades, GENUINE_SLEEVE_USD);
}

function evaluateQualification(candles: Candle[], startIndex: number, endIndex: number, neededRoundTrips: number): Accounting {
  const trades: Trade[] = [];
  const firstDecisionIndex = endIndex - 10;
  for (let slot = 0; slot < neededRoundTrips; slot += 1) {
    const decisionIndex = firstDecisionIndex + slot * 2;
    const entryIndex = decisionIndex + 1;
    const exitIndex = entryIndex + 1;
    if (exitIndex > endIndex) throw new Error('Qualification schedule cannot fit within the window boundary.');
    trades.push(tradeFor(candles[entryIndex].open, candles[exitIndex].open, QUALIFICATION_SLEEVE_USD));
  }
  return makeAccounting(trades, QUALIFICATION_SLEEVE_USD);
}

/**
 * Evaluates one finite 24-hour window causally: completed closes decide and the
 * following observed open fills. The boundary open flat-closes an open position.
 */
export function evaluateCandidateWindow(candles: Candle[], startIndex: number, endIndex: number, candidate: ResearchCandidate): WindowEvaluation {
  assertMinuteCandles(candles);
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex - startIndex !== DAY_MINUTES || startIndex < 0 || endIndex >= candles.length) {
    throw new Error('A research window must contain exactly 1,440 minutes and its observable boundary open.');
  }
  const genuine = evaluateGenuine(candles, startIndex, endIndex, candidate);
  const qualification = evaluateQualification(candles, startIndex, endIndex, Math.max(0, QUALIFICATION_TARGET_ROUND_TRIPS - genuine.roundTrips));
  const totalTrades = [...genuine.trades, ...qualification.trades];
  const total = makeAccounting(totalTrades, INITIAL_CASH_USD);
  return {
    candidateId: candidate.id,
    startTime: candles[startIndex].openTime,
    endTime: candles[endIndex].openTime,
    genuine,
    qualification,
    total,
    returnFraction: total.profitUsd / INITIAL_CASH_USD,
    endsFlat: true,
  };
}

/** Builds the latest requested complete chronological windows for each UTC offset. */
export function buildWindows(candles: Candle[], offsetsHours: number[], windowCount = 30): WindowSet[] {
  assertMinuteCandles(candles);
  if (!Number.isInteger(windowCount) || windowCount <= 0) throw new Error('windowCount must be a positive integer.');
  const byTime = new Map(candles.map((candle, index) => [candle.openTime, index]));
  return offsetsHours.map((offsetHours) => {
    if (!Number.isInteger(offsetHours) || offsetHours < 0 || offsetHours > 23) throw new Error('UTC offsets must be whole hours from 0 through 23.');
    const offsetMs = offsetHours * 60 * MINUTE_MS;
    const latest = candles[candles.length - 1].openTime;
    const finalEndTime = Math.floor((latest - offsetMs) / DAY_MS) * DAY_MS + offsetMs;
    const firstEndTime = finalEndTime - (windowCount - 1) * DAY_MS;
    const windows: ResearchWindow[] = [];
    for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
      const endTime = firstEndTime + windowIndex * DAY_MS;
      const startTime = endTime - DAY_MS;
      const startIndex = byTime.get(startTime);
      const endIndex = byTime.get(endTime);
      if (startIndex === undefined || endIndex === undefined) throw new Error(`Insufficient exact data bounds for UTC offset ${offsetHours}.`);
      windows.push({ offsetHours, startTime, endTime, startIndex, endIndex, partition: windowIndex < windowCount - 10 ? 'development' : 'holdout' });
    }
    return { offsetHours, windows };
  });
}

function emptyMetrics(): AggregateMetrics {
  return {
    windows: 0, positiveWindows: 0, negativeWindows: 0, flatWindows: 0, positiveWindowRatio: 0, meanReturn: 0, medianReturn: 0, expectancyUsd: 0, profitFactor: null, worstWindowLoss: 0, maxDrawdown: 0, totalProfitUsd: 0, largestPositiveWindowProfitUsd: 0, genuineProfitUsd: 0, qualificationProfitUsd: 0, genuineFeesUsd: 0, qualificationFeesUsd: 0, genuineRoundTrips: 0, qualificationRoundTrips: 0,
  };
}

function aggregate(results: WindowEvaluation[]): AggregateMetrics {
  if (results.length === 0) return emptyMetrics();
  const returns = results.map((result) => result.returnFraction);
  const trades = results.flatMap((result) => result.total.trades);
  const grossProfit = trades.filter((trade) => trade.profitUsd > 0).reduce((sum, trade) => sum + trade.profitUsd, 0);
  const grossLoss = -trades.filter((trade) => trade.profitUsd < 0).reduce((sum, trade) => sum + trade.profitUsd, 0);
  let equity = INITIAL_CASH_USD;
  let peak = equity;
  let maxDrawdown = 0;
  for (const result of results) {
    equity += result.total.profitUsd;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  const positiveWindows = results.filter((result) => result.returnFraction > 0).length;
  const negativeWindows = results.filter((result) => result.returnFraction < 0).length;
  return {
    windows: results.length,
    positiveWindows,
    negativeWindows,
    flatWindows: results.length - positiveWindows - negativeWindows,
    positiveWindowRatio: positiveWindows / results.length,
    meanReturn: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    medianReturn: median(returns),
    expectancyUsd: trades.length === 0 ? 0 : trades.reduce((sum, trade) => sum + trade.profitUsd, 0) / trades.length,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : null) : grossProfit / grossLoss,
    worstWindowLoss: Math.min(...returns),
    maxDrawdown,
    totalProfitUsd: results.reduce((sum, result) => sum + result.total.profitUsd, 0),
    largestPositiveWindowProfitUsd: Math.max(0, ...results.map((result) => result.total.profitUsd)),
    genuineProfitUsd: results.reduce((sum, result) => sum + result.genuine.profitUsd, 0),
    qualificationProfitUsd: results.reduce((sum, result) => sum + result.qualification.profitUsd, 0),
    genuineFeesUsd: results.reduce((sum, result) => sum + result.genuine.feesUsd, 0),
    qualificationFeesUsd: results.reduce((sum, result) => sum + result.qualification.feesUsd, 0),
    genuineRoundTrips: results.reduce((sum, result) => sum + result.genuine.roundTrips, 0),
    qualificationRoundTrips: results.reduce((sum, result) => sum + result.qualification.roundTrips, 0),
  };
}

/**
 * Summarizes boundary-offset robustness without pretending the overlapping
 * offsets are independent observations or one sequential account. Counts,
 * P&L, fees, and trade totals are equal-weight per-offset averages; drawdown is
 * the worst offset and the largest positive window is the maximum observed.
 */
function aggregateOffsets(byOffset: Record<string, AggregateMetrics>): AggregateMetrics {
  const offsets = Object.values(byOffset);
  if (offsets.length === 0) return emptyMetrics();
  const average = (field: keyof AggregateMetrics): number => offsets.reduce((sum, metric) => sum + Number(metric[field] ?? 0), 0) / offsets.length;
  const profitFactors = offsets.map((metric) => metric.profitFactor).filter((value): value is number => value !== null);
  return {
    windows: average('windows'),
    positiveWindows: average('positiveWindows'),
    negativeWindows: average('negativeWindows'),
    flatWindows: average('flatWindows'),
    positiveWindowRatio: average('positiveWindowRatio'),
    meanReturn: average('meanReturn'),
    medianReturn: median(offsets.map((metric) => metric.medianReturn)),
    expectancyUsd: average('expectancyUsd'),
    profitFactor: profitFactors.length === offsets.length ? profitFactors.reduce((sum, value) => sum + value, 0) / profitFactors.length : null,
    worstWindowLoss: Math.min(...offsets.map((metric) => metric.worstWindowLoss)),
    maxDrawdown: Math.max(...offsets.map((metric) => metric.maxDrawdown)),
    totalProfitUsd: average('totalProfitUsd'),
    largestPositiveWindowProfitUsd: Math.max(...offsets.map((metric) => metric.largestPositiveWindowProfitUsd)),
    genuineProfitUsd: average('genuineProfitUsd'),
    qualificationProfitUsd: average('qualificationProfitUsd'),
    genuineFeesUsd: average('genuineFeesUsd'),
    qualificationFeesUsd: average('qualificationFeesUsd'),
    genuineRoundTrips: average('genuineRoundTrips'),
    qualificationRoundTrips: average('qualificationRoundTrips'),
  };
}

export function evaluatePartition(candles: Candle[], candidate: ResearchCandidate, windowSets: WindowSet[], partition: 'development' | 'holdout'): CandidateMetrics {
  const byOffset: Record<string, AggregateMetrics> = {};
  for (const set of windowSets) {
    const results = set.windows.filter((window) => window.partition === partition).map((window) => evaluateCandidateWindow(candles, window.startIndex, window.endIndex, candidate));
    byOffset[String(set.offsetHours).padStart(2, '0')] = aggregate(results);
  }
  return { candidate, aggregate: aggregateOffsets(byOffset), byOffset };
}

function sealedMetrics(offsetsHours: number[]): Record<string, AggregateMetrics> {
  return Object.fromEntries(offsetsHours.map((offset) => [String(offset).padStart(2, '0'), emptyMetrics()]));
}

/**
 * Builds a selection-safe protocol view. Development is evaluated; holdout is a
 * deliberately empty shape until a caller explicitly evaluates a frozen winner.
 */
export function summarizeProtocol(candles: Candle[], candidates: ResearchCandidate[], offsetsHours = [0, 6, 12, 18], windowCount = 30): { windowSets: WindowSet[]; development: { candidates: CandidateMetrics[] }; holdout: { opened: false; candidates: CandidateMetrics[] } } {
  const windowSets = buildWindows(candles, offsetsHours, windowCount);
  return {
    windowSets,
    development: { candidates: candidates.map((candidate) => evaluatePartition(candles, candidate, windowSets, 'development')) },
    holdout: {
      opened: false,
      candidates: candidates.map((candidate) => ({ candidate, aggregate: emptyMetrics(), byOffset: sealedMetrics(offsetsHours) })),
    },
  };
}

export function rankDevelopment(metrics: CandidateMetrics[]): CandidateMetrics[] {
  return [...metrics].sort((left, right) => {
    const fields: Array<keyof AggregateMetrics> = ['positiveWindowRatio', 'meanReturn', 'medianReturn', 'profitFactor', 'maxDrawdown', 'worstWindowLoss'];
    for (const field of fields) {
      const leftValue = left.aggregate[field] ?? -Infinity;
      const rightValue = right.aggregate[field] ?? -Infinity;
      const normalizedLeft = typeof leftValue === 'number' ? leftValue : -Infinity;
      const normalizedRight = typeof rightValue === 'number' ? rightValue : -Infinity;
      const descending = field !== 'maxDrawdown';
      if (normalizedLeft !== normalizedRight) return descending ? normalizedRight - normalizedLeft : normalizedLeft - normalizedRight;
    }
    return left.candidate.id.localeCompare(right.candidate.id);
  });
}

export type DevelopmentGenerationMetrics = {
  generation: number;
  candidates: CandidateMetrics[];
};

export type DevelopmentQualification = {
  passed: boolean;
  gates: Record<string, boolean>;
};

export type DevelopmentSelectionResult = {
  status: 'qualified' | 'no-development-qualifier';
  evaluatedGenerations: number[];
  frozen: CandidateMetrics | null;
  qualification: DevelopmentQualification | null;
};

/**
 * Screens development candidates before the sealed holdout can be opened. The
 * overlay remains in total accounting, while genuine P&L must also be positive
 * so compliance trades cannot manufacture strategy credibility.
 */
export function developmentQualificationGate(metrics: CandidateMetrics, minimumPositiveWindowRatio = 0.6): DevelopmentQualification {
  const offsets = Object.values(metrics.byOffset);
  const minimumPositiveWindows = Math.ceil(20 * minimumPositiveWindowRatio);
  const gates = {
    morePositiveThanNegative: offsets.every((offset) => offset.positiveWindows > offset.negativeWindows),
    positiveMeanAndMedian: offsets.every((offset) => offset.meanReturn > 0 && offset.medianReturn > 0),
    positiveExpectancyAndProfitFactor: offsets.every((offset) => offset.expectancyUsd > 0 && offset.profitFactor !== null && offset.profitFactor > 1),
    positiveTotalProfit: offsets.every((offset) => offset.totalProfitUsd > 0),
    positiveGenuineProfit: offsets.every((offset) => offset.genuineProfitUsd > 0),
    everyOffsetPositiveMean: offsets.every((offset) => offset.meanReturn > 0),
    positiveWindowsMeetExplorationThreshold: offsets.every((offset) => offset.positiveWindows >= minimumPositiveWindows && offset.positiveWindowRatio >= minimumPositiveWindowRatio),
  };
  return { passed: Object.values(gates).every(Boolean), gates };
}

/**
 * Evaluates only the supplied predeclared generations in order. A frozen
 * candidate exists only after it clears development-only gates; callers must
 * not evaluate any holdout data for the no-qualifier result.
 */
export function selectQualifiedDevelopmentCandidate(generations: DevelopmentGenerationMetrics[]): DevelopmentSelectionResult {
  if (generations.length === 0 || generations.length > 4) throw new Error('Development selection requires one through four predeclared generations.');
  const evaluatedGenerations: number[] = [];
  for (const [index, generation] of generations.entries()) {
    if (generation.generation !== index + 1) throw new Error('Predeclared generations must be contiguous and ordered from one.');
    evaluatedGenerations.push(generation.generation);
    for (const candidate of rankDevelopment(generation.candidates)) {
      const qualification = developmentQualificationGate(candidate);
      if (qualification.passed) return { status: 'qualified', evaluatedGenerations, frozen: candidate, qualification };
    }
  }
  return { status: 'no-development-qualifier', evaluatedGenerations, frozen: null, qualification: null };
}

export function winnerGate(holdout: CandidateMetrics, v1: CandidateMetrics, cash: CandidateMetrics): { passed: boolean; gates: Record<string, boolean> } {
  const metric = holdout.aggregate;
  const offsetMeans = Object.values(holdout.byOffset).map((offset) => offset.meanReturn);
  const resultByWindowTotal = metric.totalProfitUsd;
  const largestWindowProfit = Math.max(0, ...Object.values(holdout.byOffset).map((offset) => offset.largestPositiveWindowProfitUsd));
  const gates = {
    morePositiveThanNegative: metric.positiveWindows > metric.negativeWindows,
    positiveMeanAndMedian: metric.meanReturn > 0 && metric.medianReturn > 0,
    positiveExpectancyAndProfitFactor: metric.expectancyUsd > 0 && metric.profitFactor !== null && metric.profitFactor > 1,
    betterRiskThanV1: metric.worstWindowLoss > v1.aggregate.worstWindowLoss && metric.maxDrawdown < v1.aggregate.maxDrawdown,
    boundaryAndOutlierRobust: offsetMeans.every((value) => value >= 0) && (resultByWindowTotal <= 0 || largestWindowProfit <= resultByWindowTotal * 0.5),
    materiallyBeatsV1AndCash: metric.positiveWindowRatio >= v1.aggregate.positiveWindowRatio + 0.05 && metric.meanReturn > cash.aggregate.meanReturn,
  };
  return { passed: Object.values(gates).every(Boolean), gates };
}
