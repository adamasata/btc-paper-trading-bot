export type LabCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};


/** The only live value accepted by the evaluator: an hourly open observable at asOf. */
export type ObservedHourlyOpen = {
  openTime: number;
  open: number;
};

export type DecisionRule = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type DecisionInput = {
  daily: LabCandle[];
  hourly: LabCandle[];
  asOf: number;
  executionOpen?: ObservedHourlyOpen | null;
};

export type DecisionOutput = {
  generatedAt: string;
  action: 'ENTER LONG' | 'NO TRADE';
  actionReason: string;
  evidenceScore: { passed: number; total: number; label: 'action-rule coverage, not probability' };
  regime: {
    bullish: boolean;
    dailyClose: number | null;
    sma21: number | null;
    ema21: number | null;
    sma100: number | null;
    sma200: number | null;
    context: string;
  };
  setup: {
    pivot: number | null;
    pivotName: 'Prior 7-day close mean' | 'Prior 30-day close mean' | null;
    confirmedReclaim: boolean;
    atr14: number | null;
    ema21h: number | null;
    noChase: boolean;
    volatilityPass: boolean;
    executionModel: 'NEXT HOUR OPEN';
    executionStatus: 'CURRENT' | 'EXPIRED' | 'UNAVAILABLE' | 'REJECTED';
    executionAt: number | null;
    observedExecutionOpen: number | null;
    entry: null;
    proposedInvalidation: number | null;
    target1: null;
    target2: null;
    expiry: number | null;
    executionInstruction: string;
  };
  data: { dailyCompleted: number; hourlyCompleted: number; dataQualityPass: boolean };
  actionRules: DecisionRule[];
};

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

const MAX_ATR_RATIO = 0.05;
const NO_CHASE_ATR_MULTIPLIER = 0.5;

function finite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function orderedCompleted(candles: LabCandle[], duration: number, asOf: number): LabCandle[] {
  const byOpenTime = new Map<number, LabCandle>();
  for (const candle of candles) {
    if (
      Number.isFinite(candle.openTime)
      && candle.openTime + duration <= asOf
      && finite(candle.open)
      && finite(candle.high)
      && finite(candle.low)
      && finite(candle.close)
      && candle.high >= candle.low
      && candle.high >= candle.open
      && candle.high >= candle.close
      && candle.low <= candle.open
      && candle.low <= candle.close
    ) byOpenTime.set(candle.openTime, candle);
  }
  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}

function hasContiguousTrailingCandles(candles: LabCandle[], minimumCount: number, duration: number): boolean {
  if (candles.length < minimumCount) return false;
  for (let index = candles.length - minimumCount + 1; index < candles.length; index += 1) {
    if (candles[index].openTime - candles[index - 1].openTime !== duration) return false;
  }
  return true;
}

function mean(values: number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function simpleMovingAverage(values: number[], period: number): number | null {
  return period > 0 && values.length >= period ? mean(values.slice(-period)) : null;
}

/** Uses an SMA seed followed by the standard recursive EMA calculation. */
export function exponentialMovingAverage(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period || values.some((value) => !Number.isFinite(value))) return null;
  let ema = mean(values.slice(0, period));
  if (ema === null) return null;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) ema = (values[index] - ema) * multiplier + ema;
  return ema;
}

/** Wilder ATR over completed bars only. */
export function averageTrueRange(candles: LabCandle[], period: number): number | null {
  if (period <= 0 || candles.length < period + 1) return null;
  const trueRanges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(Math.max(current.high - current.low, Math.abs(current.high - previousClose), Math.abs(current.low - previousClose)));
  }
  let atr = mean(trueRanges.slice(0, period));
  if (atr === null) return null;
  for (let index = period; index < trueRanges.length; index += 1) atr = ((atr * (period - 1)) + trueRanges[index]) / period;
  return atr;
}


function utcCompletedOpen(asOf: number, duration: number): number {
  return Math.floor(asOf / duration) * duration - duration;
}

function toRule(id: string, label: string, passed: boolean, detail: string): DecisionRule {
  return { id, label, passed, detail };
}

/**
 * Pure v1 research decision. It consumes completed candles only and never
 * reaches the replay or trading path.
 */
export function evaluateDecision(input: DecisionInput): DecisionOutput {
  const daily = orderedCompleted(input.daily, DAY, input.asOf);
  const hourly = orderedCompleted(input.hourly, HOUR, input.asOf);
  const latestDaily = daily.at(-1);
  const latestHourly = hourly.at(-1);
  const closes = daily.map((candle) => candle.close);
  const hourlyCloses = hourly.map((candle) => candle.close);
  const sma21 = simpleMovingAverage(closes, 21);
  const ema21 = exponentialMovingAverage(closes, 21);
  const sma100 = simpleMovingAverage(closes, 100);
  const sma200 = simpleMovingAverage(closes, 200);
  const ema21h = exponentialMovingAverage(hourlyCloses, 21);
  const dailyFresh = latestDaily?.openTime === utcCompletedOpen(input.asOf, DAY);
  const hourlyFresh = latestHourly?.openTime === utcCompletedOpen(input.asOf, HOUR);
  const enoughDaily = daily.length >= 220 && sma21 !== null && ema21 !== null && sma100 !== null && sma200 !== null;
  const enoughHourly = hourly.length >= 22 && ema21h !== null;
  const dailyHistoryPass = enoughDaily && hasContiguousTrailingCandles(daily, 220, DAY);
  const hourlyHistoryPass = enoughHourly && hasContiguousTrailingCandles(hourly, 22, HOUR);
  const regimeBullish = Boolean(dailyHistoryPass && latestDaily && latestDaily.close > (sma21 ?? Infinity) && latestDaily.close > (ema21 ?? Infinity));

  const priorSevenMean = daily.length >= 8 ? mean(daily.slice(-8, -1).map((candle) => candle.close)) : null;
  const priorThirtyMean = daily.length >= 31 ? mean(daily.slice(-31, -1).map((candle) => candle.close)) : null;
  const atr14 = averageTrueRange(hourly, 14);
  const currentPrice = latestHourly?.close ?? null;
  const eligiblePivots = [
    { name: 'Prior 7-day close mean' as const, value: priorSevenMean },
    { name: 'Prior 30-day close mean' as const, value: priorThirtyMean },
  ].filter((pivot): pivot is { name: 'Prior 7-day close mean' | 'Prior 30-day close mean'; value: number } => pivot.value !== null && currentPrice !== null && pivot.value <= currentPrice)
    .sort((a, b) => b.value - a.value);
  const pivot = eligiblePivots[0] ?? null;
  const previousHourly = hourly.at(-2);
  // Strict reclaim: the prior completed close is not above the frozen pivot,
  // the confirming completed candle trades to/through it, and closes above it.
  const confirmedReclaim = Boolean(pivot && previousHourly && latestHourly
    && previousHourly.close <= pivot.value
    && latestHourly.low <= pivot.value
    && latestHourly.close > pivot.value);
  const noChase = Boolean(pivot && currentPrice !== null && atr14 !== null && currentPrice - pivot.value <= NO_CHASE_ATR_MULTIPLIER * atr14);
  const volatilityPass = Boolean(currentPrice !== null && atr14 !== null && atr14 / currentPrice <= MAX_ATR_RATIO);

  const dataQualityPass = Boolean(dailyHistoryPass && hourlyHistoryPass && dailyFresh && hourlyFresh);
  const setupRules = [
    toRule('daily-history', '220+ contiguous completed daily candles with 21/100/200-day context', dailyHistoryPass, `${daily.length} usable completed daily candles; trailing 220 are ${dailyHistoryPass ? 'contiguous' : 'not contiguous or insufficient'}.`),
    toRule('daily-freshness', 'Latest daily bar is the latest completed UTC day', Boolean(dailyFresh), latestDaily ? new Date(latestDaily.openTime).toISOString() : 'No usable daily bar.'),
    toRule('hourly-history', '22+ contiguous completed hourly bars for 21-hour EMA and ATR inputs', hourlyHistoryPass, `${hourly.length} usable completed hourly candles; trailing 22 are ${hourlyHistoryPass ? 'contiguous' : 'not contiguous or insufficient'}.`),
    toRule('hourly-freshness', 'Latest hourly bar is the latest completed UTC hour', Boolean(hourlyFresh), latestHourly ? new Date(latestHourly.openTime).toISOString() : 'No usable hourly bar.'),
    toRule('bullish-regime', 'Daily close is above the 21-day SMA and EMA', regimeBullish, latestDaily && sma21 !== null && ema21 !== null ? `Close ${latestDaily.close.toFixed(2)}; SMA ${sma21.toFixed(2)}; EMA ${ema21.toFixed(2)}.` : 'Insufficient completed daily history.'),
    toRule('eligible-pivot', 'Nearest eligible frozen prior close-mean pivot exists', pivot !== null, pivot ? `${pivot.name}: ${pivot.value.toFixed(2)}.` : 'No frozen 7/30-day close mean is at or below price.'),
    toRule('hourly-reclaim', 'Strict completed-hour pivot reclaim confirmation', confirmedReclaim, pivot && latestHourly && previousHourly ? `Prior close ${previousHourly.close.toFixed(2)}, latest low/close ${latestHourly.low.toFixed(2)}/${latestHourly.close.toFixed(2)}, pivot ${pivot.value.toFixed(2)}.` : 'Requires a pivot and two completed hourly bars.'),
    toRule('no-chase', 'Confirming close is within 0.5 ATR above the reclaimed pivot', noChase, pivot && currentPrice !== null && atr14 !== null ? `Distance ${(currentPrice - pivot.value).toFixed(2)}; max ${(NO_CHASE_ATR_MULTIPLIER * atr14).toFixed(2)}.` : 'Requires pivot, completed confirming close, and ATR.'),
    toRule('volatility', '14-hour ATR is no more than 5% of confirming close', volatilityPass, currentPrice !== null && atr14 !== null ? `ATR ${(100 * atr14 / currentPrice).toFixed(2)}% of price.` : 'Requires completed hourly ATR.'),
  ];
  const setupPassed = setupRules.every((rule) => rule.passed);
  const candidateExecutionAt = setupPassed && latestHourly ? latestHourly.openTime + HOUR : null;
  const observedExecutionOpen = input.executionOpen
    && candidateExecutionAt !== null
    && input.executionOpen.openTime === candidateExecutionAt
    && finite(input.executionOpen.open)
    ? input.executionOpen.open
    : null;
  const atExecutionBoundary = candidateExecutionAt !== null && input.asOf === candidateExecutionAt;
  const executionOpenPass = Boolean(observedExecutionOpen !== null && pivot && atr14 !== null
    && observedExecutionOpen > pivot.value
    && observedExecutionOpen - pivot.value <= NO_CHASE_ATR_MULTIPLIER * atr14);
  const executionStatus = !setupPassed
    ? 'UNAVAILABLE'
    : input.asOf > (candidateExecutionAt ?? Infinity)
      ? 'EXPIRED'
      : atExecutionBoundary && executionOpenPass
        ? 'CURRENT'
        : atExecutionBoundary
          ? 'REJECTED'
          : 'UNAVAILABLE';
  const executionDetail = executionStatus === 'CURRENT'
    ? `Observed current UTC-hour open ${observedExecutionOpen!.toFixed(2)} at ${new Date(candidateExecutionAt!).toISOString()}; it is above the pivot and within 0.5 ATR.`
    : executionStatus === 'EXPIRED'
      ? `The next-open opportunity at ${new Date(candidateExecutionAt!).toISOString()} is in the past; past instructions are not displayed as current proposals.`
      : executionStatus === 'REJECTED'
        ? observedExecutionOpen === null
          ? 'The exact next-hour boundary has no valid observed execution open.'
          : `Observed current UTC-hour open ${observedExecutionOpen.toFixed(2)} is not above the pivot and within 0.5 ATR.`
        : candidateExecutionAt !== null
          ? `Next-open execution is only evaluated at ${new Date(candidateExecutionAt).toISOString()} when that hour's open is observable.`
          : 'Requires a passing completed-candle setup.';
  const actionRules = [
    ...setupRules,
    toRule('next-open-execution', 'Observed next-hour open is current, above the pivot, and within 0.5 ATR', executionStatus === 'CURRENT', executionDetail),
  ];
  const action = actionRules.every((rule) => rule.passed) ? 'ENTER LONG' : 'NO TRADE';
  const executionAt = executionStatus === 'CURRENT' ? candidateExecutionAt : null;
  const proposedInvalidation = executionStatus === 'CURRENT' && pivot && atr14 !== null ? pivot.value - NO_CHASE_ATR_MULTIPLIER * atr14 : null;
  // The boundary itself is the execution opportunity; expiry follows four full subsequent hourly bars.
  const expiry = executionAt === null ? null : executionAt + 4 * HOUR;
  const executionInstruction = executionStatus === 'CURRENT'
    ? 'Current execution opportunity only: the observed hourly open passed the entry filter. This is an ENTER LONG instruction, not a recorded fill; calculate risk and +1R/+2R only from an actual fill.'
    : executionStatus === 'EXPIRED'
      ? 'The confirmed reclaim has expired because its next-hour execution instant passed. Return NO TRADE; do not display or backfill a past execution.'
      : executionStatus === 'REJECTED'
        ? 'No trade at this boundary: the observed execution open did not meet the above-pivot and no-chase conditions. No fill, risk, or targets are recorded.'
        : 'No current observable next-hour execution opportunity. Risk, invalidation, and targets are not calculated without a current actioning setup.';
  const passed = actionRules.filter((rule) => rule.passed).length;

  return {
    generatedAt: new Date(input.asOf).toISOString(),
    action,
    actionReason: action === 'ENTER LONG'
      ? 'All deterministic v1 action rules passed at the current observed next-hour open; this is an instruction, not a recorded fill.'
      : executionStatus === 'EXPIRED'
        ? 'Fail closed: the confirmed setup expired after its next-hour execution instant passed.'
        : 'Fail closed: one or more deterministic v1 action rules did not pass.',
    evidenceScore: { passed, total: actionRules.length, label: 'action-rule coverage, not probability' },
    regime: {
      bullish: regimeBullish,
      dailyClose: latestDaily?.close ?? null,
      sma21,
      ema21,
      sma100,
      sma200,
      context: sma100 !== null && sma200 !== null && latestDaily ? `100-day SMA ${sma100.toFixed(2)}; 200-day SMA ${sma200.toFixed(2)}; close is ${latestDaily.close > sma100 ? 'above' : 'below'} 100-day and ${latestDaily.close > sma200 ? 'above' : 'below'} 200-day context.` : 'Unavailable until 220 completed daily candles pass validation.',
    },
    setup: {
      pivot: pivot?.value ?? null,
      pivotName: pivot?.name ?? null,
      confirmedReclaim,
      atr14,
      ema21h,
      noChase,
      volatilityPass,
      executionModel: 'NEXT HOUR OPEN',
      executionStatus,
      executionAt,
      observedExecutionOpen: executionStatus === 'CURRENT' || executionStatus === 'REJECTED' ? observedExecutionOpen : null,
      entry: null,
      proposedInvalidation,
      target1: null,
      target2: null,
      expiry,
      executionInstruction,
    },
    data: { dailyCompleted: daily.length, hourlyCompleted: hourly.length, dataQualityPass },
    actionRules,
  };
}
