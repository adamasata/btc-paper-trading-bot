import type { Candle } from '@/domain/types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const BINANCE_US_URL = 'https://api.binance.us/api/v3/klines';
const COINBASE_URL = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';

type Source = 'Binance.US' | 'Coinbase Exchange';
export type MarketWindow = { startTime: number; endTime: number; source: Source; candles: Candle[] };

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];
type CoinbaseCandle = [number, number, number, number, number, number];

export function latestCompletedWindow(now = Date.now()): { startTime: number; endTime: number } {
  const endTime = Math.floor(now / MINUTE) * MINUTE;
  return { startTime: endTime - DAY, endTime };
}

export function parseBinance(payload: unknown, startTime: number, endTime: number): Candle[] {
  if (!Array.isArray(payload)) throw new Error('Binance.US returned a non-array payload.');
  return (payload as BinanceKline[])
    .map((row) => ({ openTime: Number(row[0]), open: Number(row[1]), close: Number(row[4]) }))
    .filter((candle) => candle.openTime >= startTime && candle.openTime < endTime)
    .sort((a, b) => a.openTime - b.openTime);
}

export function parseCoinbase(payload: unknown, startTime: number, endTime: number): Candle[] {
  if (!Array.isArray(payload)) throw new Error('Coinbase returned a non-array payload.');
  return (payload as CoinbaseCandle[])
    .map((row) => ({ openTime: Number(row[0]) * 1000, open: Number(row[3]), close: Number(row[4]) }))
    .filter((candle) => candle.openTime >= startTime && candle.openTime < endTime)
    .sort((a, b) => a.openTime - b.openTime);
}

export function validateCandles(candles: Candle[], startTime: number, endTime: number): Candle[] {
  const byTime = new Map(candles.map((candle) => [candle.openTime, candle]));
  const ordered = [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
  const expectedCount = (endTime - startTime) / MINUTE;
  if (ordered.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} complete one-minute candles, received ${ordered.length}.`);
  }
  for (let time = startTime; time < endTime; time += MINUTE) {
    const candle = byTime.get(time);
    if (!candle || !Number.isFinite(candle.open) || !Number.isFinite(candle.close) || candle.open <= 0 || candle.close <= 0) {
      throw new Error('The provider returned a gap or invalid BTC/USD price.');
    }
  }
  return ordered;
}

async function requestJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'application/json', 'User-Agent': 'btc-paper-replay/1.0' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from market-data provider.`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Market-data request failed.');
}

async function fetchBinance(startTime: number, endTime: number): Promise<Candle[]> {
  const midpoint = startTime + (endTime - startTime) / 2;
  const ranges: Array<[number, number]> = [
    [startTime, midpoint - 1],
    [midpoint, endTime - 1],
  ];
  const payloads = await Promise.all(ranges.map(([start, end]) => requestJson(
    `${BINANCE_US_URL}?symbol=BTCUSD&interval=1m&startTime=${start}&endTime=${end}&limit=1000`,
  )));
  return validateCandles(payloads.flatMap((payload) => parseBinance(payload, startTime, endTime)), startTime, endTime);
}

async function fetchCoinbase(startTime: number, endTime: number): Promise<Candle[]> {
  const chunk = 240 * MINUTE;
  const requests: Promise<unknown>[] = [];
  for (let start = startTime; start < endTime; start += chunk) {
    const end = Math.min(start + chunk, endTime);
    const query = new URLSearchParams({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      granularity: '60',
    });
    requests.push(requestJson(`${COINBASE_URL}?${query.toString()}`));
  }
  const payloads = await Promise.all(requests);
  return validateCandles(payloads.flatMap((payload) => parseCoinbase(payload, startTime, endTime)), startTime, endTime);
}

export async function fetchLatest24h(now = Date.now()): Promise<MarketWindow> {
  const { startTime, endTime } = latestCompletedWindow(now);
  try {
    return { startTime, endTime, source: 'Binance.US', candles: await fetchBinance(startTime, endTime) };
  } catch (binanceError) {
    try {
      return { startTime, endTime, source: 'Coinbase Exchange', candles: await fetchCoinbase(startTime, endTime) };
    } catch (coinbaseError) {
      const b = binanceError instanceof Error ? binanceError.message : 'unknown error';
      const c = coinbaseError instanceof Error ? coinbaseError.message : 'unknown error';
      throw new Error(`BTC/USD data unavailable. Binance.US: ${b} Coinbase: ${c}`);
    }
  }
}
