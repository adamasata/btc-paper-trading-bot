import type { LabCandle, ObservedHourlyOpen } from '@/domain/decision';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const BINANCE_US_URL = 'https://api.binance.us/api/v3/klines';


export type DecisionMarketData = {
  source: 'Binance.US';
  daily: LabCandle[];
  hourly: LabCandle[];
  /** Present only when the request lands exactly on a UTC hourly boundary. */
  executionOpen: ObservedHourlyOpen | null;
};

type BinanceLabKline = [number, string, string, string, string, string, number, ...unknown[]];


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


export async function fetchDecisionMarketData(now = Date.now(), fetcher: typeof fetch = fetch): Promise<DecisionMarketData> {
  const [dailyPayload, hourlyPayload] = await Promise.all([
    requestJson(`${BINANCE_US_URL}?symbol=BTCUSD&interval=1d&limit=260`, fetcher),
    requestJson(`${BINANCE_US_URL}?symbol=BTCUSD&interval=1h&limit=72`, fetcher),
  ]);
  const daily = validateCompletedLabCandles(parseCompletedBinanceLabCandles(dailyPayload, DAY, now), DAY, now, 220);
  const hourly = validateCompletedLabCandles(parseCompletedBinanceLabCandles(hourlyPayload, HOUR, now), HOUR, now, 22);
  return {
    source: 'Binance.US',
    daily,
    hourly,
    executionOpen: parseObservedHourlyOpenAtBoundary(hourlyPayload, now),
  };
}

export const decisionLabSources = {
  binanceUs: 'https://api.binance.us/api/v3/klines',
} as const;
