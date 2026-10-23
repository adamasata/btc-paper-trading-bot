import { normalizeProviderOhlcv } from '@/research/v6/data-contract';
import { MINUTE_MS, type NormalizedOhlcv, type RawOhlcvRow } from '@/research/v6/types';
import type { ObservedMinuteOpen } from '@/research/v6/strategy';

const BITSTAMP_OHLC_URL = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';
const BITSTAMP_MAX_LIMIT = 1_000;
// 1,440 predecessor bars plus a complete possible current UTC day and its first bar.
export const V6_DECISION_COMPLETED_CANDLE_COUNT = 2_881;

export class V6MarketDataValidityError extends Error {
  readonly completedCandles: number;
  constructor(message: string, completedCandles = 0) {
    super(message);
    this.name = 'V6MarketDataValidityError';
    this.completedCandles = completedCandles;
  }
}

type BitstampPayload = Readonly<{ data?: Readonly<{ ohlc?: readonly unknown[] }> }>;

export type V6DecisionMarketData = Readonly<{
  source: 'Bitstamp';
  candles: readonly NormalizedOhlcv[];
  observedExecutionOpen: ObservedMinuteOpen | null;
}>;

type Pause = (milliseconds: number) => Promise<void>;

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function completedMinuteOpen(now: number): number { return Math.floor(now / MINUTE_MS) * MINUTE_MS - MINUTE_MS; }

function asPositiveFinite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new V6MarketDataValidityError(`Bitstamp returned an invalid ${label}.`);
  return parsed;
}

function parseOpenTimeSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new V6MarketDataValidityError('Bitstamp returned an invalid 1m open timestamp.');
  const openTime = seconds * 1_000;
  if (openTime % MINUTE_MS !== 0) throw new V6MarketDataValidityError('Bitstamp returned a non-minute 1m open timestamp.');
  return openTime;
}

function toRawRow(row: unknown): RawOhlcvRow {
  if (row === null || typeof row !== 'object') throw new V6MarketDataValidityError('Bitstamp returned a malformed 1m candle row.');
  const fields = row as Record<string, unknown>;
  return {
    openTime: parseOpenTimeSeconds(fields.timestamp),
    open: asPositiveFinite(fields.open, 'open'),
    high: asPositiveFinite(fields.high, 'high'),
    low: asPositiveFinite(fields.low, 'low'),
    close: asPositiveFinite(fields.close, 'close'),
    volume: asPositiveFinite(fields.volume, 'volume'),
  };
}

async function requestJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json', 'User-Agent': 'btc-paper-v6-shadow/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} from Bitstamp v6 decision provider.`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Bitstamp v6 decision request failed.');
}

function rowsFromPayload(payload: unknown): readonly unknown[] {
  const rows = (payload as BitstampPayload | null)?.data?.ohlc;
  if (!Array.isArray(rows)) throw new V6MarketDataValidityError('Bitstamp returned a non-array v6 candle payload.');
  return rows;
}

/** The forming row is execution evidence only: its H/L/C/V must not be read. */
function parseObservedCurrentOpen(payload: unknown, expectedOpenTime: number): ObservedMinuteOpen {
  const rows = rowsFromPayload(payload);
  if (rows.length !== 1) throw new V6MarketDataValidityError(`Bitstamp returned ${rows.length} rows for the current-minute open.`);
  const row = rows[0];
  if (row === null || typeof row !== 'object') throw new V6MarketDataValidityError('Bitstamp returned a malformed current-minute row.');
  const fields = row as Record<string, unknown>;
  const openTime = parseOpenTimeSeconds(fields.timestamp);
  if (openTime !== expectedOpenTime) throw new V6MarketDataValidityError('Bitstamp current-minute row does not match the requested minute.');
  return { openTime, open: asPositiveFinite(fields.open, 'current open') };
}

async function fetchExactRange(firstOpen: number, count: number, fetcher: typeof fetch, pause: Pause): Promise<readonly RawOhlcvRow[]> {
  const rawByOpenTime = new Map<number, RawOhlcvRow>();
  for (let offset = 0; offset < count; offset += BITSTAMP_MAX_LIMIT) {
    const pageCount = Math.min(BITSTAMP_MAX_LIMIT, count - offset);
    const pageStart = firstOpen + offset * MINUTE_MS;
    const pageEnd = pageStart + (pageCount - 1) * MINUTE_MS;
    const params = new URLSearchParams({ step: '60', limit: String(pageCount), start: String(pageStart / 1_000), end: String(pageEnd / 1_000) });
    const payload = await requestJson(`${BITSTAMP_OHLC_URL}?${params.toString()}`, fetcher);
    const rows = rowsFromPayload(payload);
    if (rows.length !== pageCount) throw new V6MarketDataValidityError(`Bitstamp returned ${rows.length} candles for an exact ${pageCount}-minute page.`, rawByOpenTime.size);
    for (const candidate of rows) {
      const raw = toRawRow(candidate);
      const rawOpenTime = Number(raw.openTime);
      if (rawOpenTime < pageStart || rawOpenTime > pageEnd) throw new V6MarketDataValidityError('Bitstamp returned a candle outside the exact v6 requested range.', rawByOpenTime.size);
      if (rawByOpenTime.has(rawOpenTime)) throw new V6MarketDataValidityError('Bitstamp returned a duplicate v6 candle.', rawByOpenTime.size);
      rawByOpenTime.set(rawOpenTime, raw);
    }
    if (offset + pageCount < count) await pause(125);
  }
  const rawRows = [...rawByOpenTime.values()].sort((left, right) => Number(left.openTime) - Number(right.openTime));
  if (rawRows.length !== count) throw new V6MarketDataValidityError(`Bitstamp returned ${rawRows.length} completed v6 candles; exactly ${count} contiguous candles are required.`, rawRows.length);
  return rawRows;
}

async function fetchObservedCurrentOpen(currentOpen: number, fetcher: typeof fetch): Promise<ObservedMinuteOpen> {
  const params = new URLSearchParams({ step: '60', limit: '1', start: String(currentOpen / 1_000), end: String(currentOpen / 1_000) });
  const payload = await requestJson(`${BITSTAMP_OHLC_URL}?${params.toString()}`, fetcher);
  return parseObservedCurrentOpen(payload, currentOpen);
}

function normalizeCompletedHistory(rawRows: readonly RawOhlcvRow[], firstComplete: number, latestComplete: number): readonly NormalizedOhlcv[] {
  try {
    const normalized = normalizeProviderOhlcv(rawRows).normalized;
    if (normalized[0].openTime !== firstComplete || normalized.at(-1)?.openTime !== latestComplete) {
      throw new V6MarketDataValidityError('Bitstamp v6 history does not cover the required latest completed minute range.', normalized.length);
    }
    return normalized;
  } catch (error) {
    if (error instanceof V6MarketDataValidityError) throw error;
    const reason = error instanceof Error ? error.message : 'unknown completed-history validation error';
    throw new V6MarketDataValidityError(`Bitstamp completed v6 history failed structural validation: ${reason}`, rawRows.length);
  }
}

/**
 * Fetches exact, bounded Bitstamp BTC/USD minute pages. Only completed rows enter
 * evaluation; the in-progress row contributes at most its already-observed open.
 */
export async function fetchV6DecisionMarketData(now = Date.now(), fetcher: typeof fetch = fetch, pause: Pause = sleep): Promise<V6DecisionMarketData> {
  if (!Number.isInteger(now) || now <= 0) throw new Error('v6 decision time must be a positive integer timestamp.');
  const latestComplete = completedMinuteOpen(now);
  const firstComplete = latestComplete - (V6_DECISION_COMPLETED_CANDLE_COUNT - 1) * MINUTE_MS;
  const rawRows = await fetchExactRange(firstComplete, V6_DECISION_COMPLETED_CANDLE_COUNT, fetcher, pause);
  const normalized = normalizeCompletedHistory(rawRows, firstComplete, latestComplete);

  const currentOpen = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  let observedExecutionOpen: ObservedMinuteOpen | null = null;
  try {
    observedExecutionOpen = await fetchObservedCurrentOpen(currentOpen, fetcher);
  } catch (error) {
    // A malformed or unavailable forming row cannot taint completed history; transport failures still surface as 503.
    if (!(error instanceof V6MarketDataValidityError)) throw error;
  }
  return { source: 'Bitstamp', candles: normalized, observedExecutionOpen };
}
