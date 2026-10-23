import { validateCompleteOhlcv } from './data-contract';
import { MINUTE_MS, TIMEFRAME_MS, type NormalizedOhlcv, type Timeframe } from './types';

type ParentTimeframe = Exclude<Timeframe, '1m'>;
type Aggregated<T extends readonly ParentTimeframe[]> = { [P in T[number]]: NormalizedOhlcv[] };

function aggregateOne(candles: readonly NormalizedOhlcv[], timeframe: ParentTimeframe): NormalizedOhlcv[] {
  const parentMs = TIMEFRAME_MS[timeframe];
  const barsPerParent = parentMs / MINUTE_MS;
  if (candles[0].openTime % parentMs !== 0 || candles.length % barsPerParent !== 0) {
    throw new Error(`Cannot expose partial ${timeframe} parent bars.`);
  }
  const parents: NormalizedOhlcv[] = [];
  for (let index = 0; index < candles.length; index += barsPerParent) {
    const children = candles.slice(index, index + barsPerParent);
    const openTime = children[0].openTime;
    if (children[children.length - 1].closeTime !== openTime + parentMs) throw new Error(`Incomplete ${timeframe} parent bar.`);
    parents.push({
      openTime,
      closeTime: openTime + parentMs,
      open: children[0].open,
      high: Math.max(...children.map((bar) => bar.high)),
      low: Math.min(...children.map((bar) => bar.low)),
      close: children[children.length - 1].close,
      volume: children.reduce((total, bar) => total + bar.volume, 0),
    });
  }
  validateCompleteOhlcv(parents, timeframe);
  return parents;
}

/**
 * Produces only UTC-aligned, fully composed parent bars. A caller must still
 * use completedBarsAt to impose its observation-time boundary.
 */
export function aggregateMinuteTimeframes<T extends readonly ParentTimeframe[]>(candles: readonly NormalizedOhlcv[], timeframes: T): Aggregated<T> {
  validateCompleteOhlcv(candles, '1m');
  if (timeframes.length === 0) throw new Error('At least one parent timeframe is required.');
  if (new Set(timeframes).size !== timeframes.length) throw new Error('Requested timeframes must be unique.');
  return Object.fromEntries(timeframes.map((timeframe) => [timeframe, aggregateOne(candles, timeframe)])) as Aggregated<T>;
}

/** A bar is observable only after its exclusive close boundary has elapsed. */
export function completedBarsAt(bars: readonly NormalizedOhlcv[], timeframe: Timeframe, observationTime: number): NormalizedOhlcv[] {
  validateCompleteOhlcv(bars, timeframe);
  if (!Number.isFinite(observationTime)) throw new Error('Observation time must be finite.');
  return bars.filter((bar) => bar.closeTime <= observationTime);
}

/** Fails closed rather than substituting a zero-valued feature during warm-up. */
export function requireCompletedHistory(bars: readonly NormalizedOhlcv[], timeframe: Timeframe, observationTime: number, count: number): NormalizedOhlcv[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error('History count must be a positive integer.');
  const completed = completedBarsAt(bars, timeframe, observationTime);
  if (completed.length < count) throw new Error(`Insufficient completed history: need ${count}, have ${completed.length}.`);
  return completed.slice(-count);
}
