import type { FearGreedValue, LabCandle, ObservedHourlyOpen } from '@/domain/decision';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const BINANCE_US_URL = 'https://api.binance.us/api/v3/klines';
const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=7&format=json';

export type DecisionMarketData = {
  source: 'Binance.US';
  daily: LabCandle[];
  hourly: LabCandle[];
  fearGreed: FearGreedValue[];
  /** Present only when the request lands exactly on a UTC hourly boundary. */
  executionOpen: ObservedHourlyOpen | null;
};

type BinanceLabKline = [number, string, string, string, string, string, number, ...unknown[]];
type FearGreedPayload = { data?: unknown };
type CachedFearGreed = { expiresAt: number; values: FearGreedValue[] };

let latestFearGreed: CachedFearGreed | null = null;
let inFlightFearGreed: Promise<void> | null = null;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function completedStart(now: number, intervalMs: number): number {
  return Math.floor(now / intervalMs) * intervalMs;
}

/** Parses public klines and removes the currently forming bar by close boundary. */
export function parseCompletedBinanceLabCandles(payload: unknown, intervalMs: number, now: number): LabCandle[] {
  if (!Array.isArray(payload)) throw new Error('Binance.US returned a non-array candle payload.');
  const completeBefore = completedStart(now, intervalMs);
  const byOpenTime = new Map<number, LabCandle>();
  for (const row of payload as BinanceLabKline[]) {
    if (!Array.isArray(row) || row.length < 7) throw new Error('Binance.US returned a malformed candle row.');
    const candle: LabCandle = {
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    };
    if (!Number.isFinite(candle.openTime) || !isPositiveFinite(candle.open) || !isPositiveFinite(candle.high) || !isPositiveFinite(candle.low) || !isPositiveFinite(candle.close) || candle.high < candle.low || candle.high < candle.open || candle.high < candle.close || candle.low > candle.open || candle.low > candle.close) {
      throw new Error('Binance.US returned an invalid BTCUSD candle.');
    }
    if (candle.openTime % intervalMs !== 0) throw new Error('Binance.US returned a candle outside the expected UTC interval boundary.');
    if (candle.openTime + intervalMs <= now && candle.openTime < completeBefore) byOpenTime.set(candle.openTime, candle);
  }
  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}

export function validateCompletedLabCandles(candles: LabCandle[], intervalMs: number, now: number, minimumCount: number): LabCandle[] {
  if (candles.length < minimumCount) throw new Error(`Expected at least ${minimumCount} completed candles, received ${candles.length}.`);
  const expectedLatest = completedStart(now, intervalMs) - intervalMs;
  const latest = candles.at(-1);
  if (!latest || latest.openTime !== expectedLatest) throw new Error('Market data does not include the latest completed UTC candle.');
  for (let index = candles.length - minimumCount + 1; index < candles.length; index += 1) {
    if (candles[index].openTime - candles[index - 1].openTime !== intervalMs) throw new Error('Market data has a gap in the required completed candle range.');
  }
  return candles;
}

/**
 * The in-progress hourly candle is otherwise deliberately excluded. Its open
 * is usable only at the instant a new UTC hour begins: it is observable then,
 * while its later high, low, and close remain unavailable to the evaluator.
 */
export function parseObservedHourlyOpenAtBoundary(payload: unknown, now: number): ObservedHourlyOpen | null {
  if (now % HOUR !== 0 || !Array.isArray(payload)) return null;
  for (const row of payload as BinanceLabKline[]) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    if (openTime === now && openTime % HOUR === 0 && isPositiveFinite(open)) return { openTime, open };
  }
  return null;
}

export function parseFearGreed(payload: unknown): FearGreedValue[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as FearGreedPayload).data)) throw new Error('Alternative.me returned a malformed Fear & Greed payload.');
  const entries = (payload as FearGreedPayload).data as Array<Record<string, unknown>>;
  const byTimestamp = new Map<number, FearGreedValue>();
  for (const entry of entries) {
    const value = Number(entry.value);
    const timestampSeconds = Number(entry.timestamp);
    const classification = typeof entry.value_classification === 'string' ? entry.value_classification.trim() : '';
    if (!Number.isInteger(value) || value < 0 || value > 100 || !Number.isFinite(timestampSeconds) || timestampSeconds <= 0 || !classification) throw new Error('Alternative.me returned an invalid Fear & Greed value.');
    byTimestamp.set(timestampSeconds * 1_000, { value, classification, timestamp: timestampSeconds * 1_000 });
  }
  const values = [...byTimestamp.values()].sort((a, b) => b.timestamp - a.timestamp);
  if (values.length < 7) throw new Error(`Expected 7 Fear & Greed values, received ${values.length}.`);
  return values.slice(0, 7);
}

async function requestJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'application/json', 'User-Agent': 'btc-paper-decision-lab/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from public Decision Lab provider.`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Decision Lab data request failed.');
}

/**
 * Starts an optional context refresh without holding required candle data open.
 * This cache/single-flight is module-local best effort; CDN caching protects
 * public deployments but a distributed production service needs shared limits.
 */
function currentFearGreedContext(now: number, fetcher: typeof fetch): FearGreedValue[] {
  if ((!latestFearGreed || latestFearGreed.expiresAt <= now) && !inFlightFearGreed) {
    const refresh = requestJson(FEAR_GREED_URL, fetcher)
      .then(parseFearGreed)
      .then((values) => { latestFearGreed = { values, expiresAt: now + 60_000 }; })
      .catch(() => undefined)
      .finally(() => { if (inFlightFearGreed === refresh) inFlightFearGreed = null; });
    inFlightFearGreed = refresh;
  }
  return latestFearGreed?.values ?? [];
}

export function clearFearGreedContextForTests(): void {
  latestFearGreed = null;
  inFlightFearGreed = null;
}

export async function fetchDecisionMarketData(now = Date.now(), fetcher: typeof fetch = fetch): Promise<DecisionMarketData> {
  const [dailyPayload, hourlyPayload] = await Promise.all([
    requestJson(`${BINANCE_US_URL}?symbol=BTCUSD&interval=1d&limit=260`, fetcher),
    requestJson(`${BINANCE_US_URL}?symbol=BTCUSD&interval=1h&limit=72`, fetcher),
  ]);
  const daily = validateCompletedLabCandles(parseCompletedBinanceLabCandles(dailyPayload, DAY, now), DAY, now, 220);
  const hourly = validateCompletedLabCandles(parseCompletedBinanceLabCandles(hourlyPayload, HOUR, now), HOUR, now, 22);
  // Optional context starts after required validation and never delays a
  // candle-based result. A later request can render its module-local cache.
  const fearGreed = currentFearGreedContext(now, fetcher);
  return {
    source: 'Binance.US',
    daily,
    hourly,
    fearGreed,
    executionOpen: parseObservedHourlyOpenAtBoundary(hourlyPayload, now),
  };
}

export const decisionLabSources = {
  binanceUs: 'https://api.binance.us/api/v3/klines',
  fearGreed: 'https://api.alternative.me/fng/?limit=7&format=json',
} as const;
