import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchV6DecisionMarketData, V6_DECISION_COMPLETED_CANDLE_COUNT, V6MarketDataValidityError } from '../src/lib/v6-decision-data';
import { clearV6ShadowDecisionCacheForTests, getV6ShadowDecision } from '../src/lib/v6-decision-service';
import { createV6DecisionRoute } from '../src/lib/v6-decision-route';
import { createRateLimiter } from '../src/lib/rate-limit';
import type { NormalizedOhlcv } from '../src/research/v6/types';

const MINUTE = 60_000;

function bitstampRow(openTime: number, open = 100, volume = '10') {
  return { timestamp: String(openTime / 1_000), open: String(open), high: String(open + 2), low: String(open - 2), close: String(open + 1), volume };
}

function candle(openTime: number, volume = 10, price = 100): NormalizedOhlcv {
  return { openTime, closeTime: openTime + MINUTE, open: price, high: price, low: price, close: price, volume };
}

function market(candles: readonly NormalizedOhlcv[], observedExecutionOpen: { openTime: number; open: number } | null = null) {
  return { source: 'Bitstamp' as const, candles, observedExecutionOpen };
}

test('v6 paper-account sizing uses the actual pre-buy equity and observed next open', async () => {
  const dayStart = Date.UTC(2026, 0, 3);
  const candles = Array.from({ length: 1_440 }, (_, index) => candle(dayStart - 1_440 * MINUTE + index * MINUTE));
  candles.push(candle(dayStart, 30));
  for (let minute = 1; minute <= 60; minute += 1) candles.push(candle(dayStart + minute * MINUTE, 1, 101));
  const asOf = dayStart + 61 * MINUTE;
  const payload = await getV6ShadowDecision({ now: () => asOf, fetchMarket: async () => market(candles, { openTime: asOf, open: 100 }) });
  const k3 = payload.candidates.find((candidate) => candidate.candidateId === 'v6-avwap-vrel3-accept60-a025');
  assert.ok(k3);
  assert.equal(k3.state, 'long');
  assert.equal(k3.paperAccount.preBuyEquityUsd, 10_000);
  assert.equal(k3.paperAccount.intendedAllocationUsd, 2_500);
  assert.ok(k3.paperAccount.btcQuantity > 0);
  assert.equal(payload.data.dataQualityPass, true);
});

test('v6 fetches exact bounded Bitstamp BTC/USD pages and accepts a current-minute open during the minute', async () => {
  const now = Date.UTC(2026, 0, 3, 12, 0, 30);
  const latestCompleted = Math.floor(now / MINUTE) * MINUTE - MINUTE;
  const first = latestCompleted - (V6_DECISION_COMPLETED_CANDLE_COUNT - 1) * MINUTE;
  const requested: URL[] = [];
  const fetcher: typeof fetch = async (url) => {
    const parsed = new URL(String(url));
    requested.push(parsed);
    const start = Number(parsed.searchParams.get('start')) * 1_000;
    const limit = Number(parsed.searchParams.get('limit'));
    return new Response(JSON.stringify({ data: { pair: 'BTC/USD', ohlc: Array.from({ length: limit }, (_, index) => bitstampRow(start + index * MINUTE)) } }));
  };
  const result = await fetchV6DecisionMarketData(now, fetcher, async () => undefined);
  assert.equal(result.source, 'Bitstamp');
  assert.equal(result.candles.length, V6_DECISION_COMPLETED_CANDLE_COUNT);
  assert.equal(result.candles[0].openTime, first);
  assert.equal(result.candles.at(-1)?.openTime, latestCompleted);
  assert.deepEqual(result.observedExecutionOpen, { openTime: now - 30_000, open: 100 });
  assert.deepEqual(requested.map((url) => Number(url.searchParams.get('limit'))), [1_000, 1_000, 881, 1]);
  assert.ok(requested.every((url) => url.hostname === 'www.bitstamp.net' && url.pathname === '/api/v2/ohlc/btcusd/' && url.searchParams.get('step') === '60'));
});

test('v6 Bitstamp fetch rejects zero volume and gaps without interpolation', async () => {
  const now = Date.UTC(2026, 0, 3, 12, 0, 30);
  let call = 0;
  const invalidVolume: typeof fetch = async (url) => {
    call += 1;
    const parsed = new URL(String(url));
    const start = Number(parsed.searchParams.get('start')) * 1_000;
    const limit = Number(parsed.searchParams.get('limit'));
    const rows = Array.from({ length: limit }, (_, index) => bitstampRow(start + index * MINUTE, 100, call === 1 && index === 10 ? '0' : '10'));
    return new Response(JSON.stringify({ data: { ohlc: rows } }));
  };
  await assert.rejects(fetchV6DecisionMarketData(now, invalidVolume, async () => undefined), V6MarketDataValidityError);

  const gapped: typeof fetch = async (url) => {
    const parsed = new URL(String(url));
    const start = Number(parsed.searchParams.get('start')) * 1_000;
    const limit = Number(parsed.searchParams.get('limit'));
    return new Response(JSON.stringify({ data: { ohlc: Array.from({ length: limit - 1 }, (_, index) => bitstampRow(start + index * MINUTE)) } }));
  };
  await assert.rejects(fetchV6DecisionMarketData(now, gapped, async () => undefined), /exact/);
});

test('v6 structurally invalid market data returns a truthful fail-closed 200 payload', async () => {
  clearV6ShadowDecisionCacheForTests();
  const asOf = Date.UTC(2026, 0, 3, 12, 0, 30);
  const payload = await getV6ShadowDecision({ now: () => asOf, fetchMarket: async () => { throw new V6MarketDataValidityError('zero volume', 2_000); } });
  assert.equal(payload.source, 'Bitstamp');
  assert.equal(payload.data.completedCandles, 2_000);
  assert.equal(payload.data.dataQualityPass, false);
  assert.ok(payload.candidates.every((candidate) => candidate.state === 'data_invalid'));
});

test('v6 service coalesces concurrent non-boundary refreshes, expires its TTL, and bypasses exact boundaries', async () => {
  clearV6ShadowDecisionCacheForTests();
  const candles = Array.from({ length: V6_DECISION_COMPLETED_CANDLE_COUNT }, (_, index) => candle(Date.UTC(2026, 0, 1) + index * MINUTE));
  let now = Date.UTC(2026, 0, 3, 12, 0, 30);
  let calls = 0;
  const fetchMarket = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 15)); return market(candles); };
  await Promise.all([getV6ShadowDecision({ now: () => now, fetchMarket }), getV6ShadowDecision({ now: () => now, fetchMarket })]);
  assert.equal(calls, 1);
  now += 20_000;
  await getV6ShadowDecision({ now: () => now, fetchMarket });
  assert.equal(calls, 1);
  now += 60_000;
  await getV6ShadowDecision({ now: () => now, fetchMarket });
  assert.equal(calls, 2);
  now = Date.UTC(2026, 0, 3, 12, 3, 0);
  await getV6ShadowDecision({ now: () => now, fetchMarket });
  await getV6ShadowDecision({ now: () => now, fetchMarket });
  assert.equal(calls, 4);
});

test('v6 endpoint is no-store and preserves experimental/unvalidated/paper-only labeling', async () => {
  const payload = { generatedAt: '2026-01-15T12:00:00.000Z', source: 'Bitstamp' as const, modelStatus: 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY' as const, data: { completedCandles: 2881, dataQualityPass: true }, candidates: [] };
  const GET = createV6DecisionRoute({ getDecision: async () => payload, rateLimiter: createRateLimiter() });
  const response = await GET(new Request('http://localhost/api/v6-decision'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json() as typeof payload).modelStatus, 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY');

  const failed = createV6DecisionRoute({ getDecision: async () => { throw new Error('outage'); }, rateLimiter: createRateLimiter(), logError: () => undefined });
  const failure = await failed(new Request('http://localhost/api/v6-decision'));
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
});

test('v6 accepts a forming row with a valid open while ignoring its unavailable later fields', async () => {
  const now = Date.UTC(2026, 0, 3, 12, 0, 30);
  const fetcher: typeof fetch = async (url) => {
    const parsed = new URL(String(url));
    const start = Number(parsed.searchParams.get('start')) * 1_000;
    const limit = Number(parsed.searchParams.get('limit'));
    const rows = limit === 1
      ? [{ timestamp: String(start / 1_000), open: '123.45', high: '', low: '0', close: 'unavailable', volume: '0' }]
      : Array.from({ length: limit }, (_, index) => bitstampRow(start + index * MINUTE));
    return new Response(JSON.stringify({ data: { ohlc: rows } }));
  };

  const result = await fetchV6DecisionMarketData(now, fetcher, async () => undefined);
  assert.deepEqual(result.observedExecutionOpen, { openTime: now - 30_000, open: 123.45 });
});

test('v6 wraps inverted OHLC and normalization-gap history as structural validity failures', async () => {
  const now = Date.UTC(2026, 0, 3, 12, 0, 30);
  const invalidHistoryFetcher = (kind: 'inverted_ohlc' | 'normalization_gap'): typeof fetch => async (url) => {
    const parsed = new URL(String(url));
    const start = Number(parsed.searchParams.get('start')) * 1_000;
    const limit = Number(parsed.searchParams.get('limit'));
    const rows = Array.from({ length: limit }, (_, index) => bitstampRow(start + index * MINUTE));
    if (limit !== 1) {
      if (kind === 'inverted_ohlc') rows[10] = { ...rows[10], high: '99' };
      if (kind === 'normalization_gap') rows[10] = { ...rows[10], timestamp: rows[9].timestamp };
    }
    return new Response(JSON.stringify({ data: { ohlc: rows } }));
  };

  for (const kind of ['inverted_ohlc', 'normalization_gap'] as const) {
    const fetcher = invalidHistoryFetcher(kind);
    await assert.rejects(fetchV6DecisionMarketData(now, fetcher, async () => undefined), V6MarketDataValidityError);
  }

  clearV6ShadowDecisionCacheForTests();
  const payload = await getV6ShadowDecision({
    now: () => now,
    fetchMarket: () => fetchV6DecisionMarketData(now, invalidHistoryFetcher('inverted_ohlc'), async () => undefined),
  });
  assert.equal(payload.data.dataQualityPass, false);
  assert.ok(payload.candidates.every((candidate) => candidate.state === 'data_invalid'));

  clearV6ShadowDecisionCacheForTests();
  const GET = createV6DecisionRoute({
    getDecision: () => getV6ShadowDecision({
      now: () => now,
      fetchMarket: () => fetchV6DecisionMarketData(now, invalidHistoryFetcher('normalization_gap'), async () => undefined),
    }),
    rateLimiter: createRateLimiter(),
  });
  const response = await GET(new Request('http://localhost/api/v6-decision'));
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { dataQualityPass: boolean } };
  assert.equal(body.data.dataQualityPass, false);
});

test('v6 cache refreshes at the next causal observation minute', async () => {
  clearV6ShadowDecisionCacheForTests();
  const candles = Array.from({ length: V6_DECISION_COMPLETED_CANDLE_COUNT }, (_, index) => candle(Date.UTC(2026, 0, 1) + index * MINUTE));
  let now = Date.UTC(2026, 0, 3, 12, 0, 30);
  let calls = 0;
  const fetchMarket = async () => { calls += 1; return market(candles); };

  const first = await getV6ShadowDecision({ now: () => now, fetchMarket });
  now = Date.UTC(2026, 0, 3, 12, 1, 1);
  const second = await getV6ShadowDecision({ now: () => now, fetchMarket });
  assert.equal(calls, 2);
  assert.equal(first.generatedAt, '2026-01-03T12:00:30.000Z');
  assert.equal(second.generatedAt, '2026-01-03T12:01:01.000Z');
});

test('v6 does not join prior-minute in-flight work at an exact minute boundary', async () => {
  clearV6ShadowDecisionCacheForTests();
  const candles = Array.from({ length: V6_DECISION_COMPLETED_CANDLE_COUNT }, (_, index) => candle(Date.UTC(2026, 0, 1) + index * MINUTE));
  let now = Date.UTC(2026, 0, 3, 12, 0, 59);
  const requestedAsOf: number[] = [];
  const release: (() => void)[] = [];
  const fetchMarket = (asOf: number) => new Promise<ReturnType<typeof market>>((resolve) => {
    requestedAsOf.push(asOf);
    release.push(() => resolve(market(candles)));
  });

  const priorMinute = getV6ShadowDecision({ now: () => now, fetchMarket });
  now = Date.UTC(2026, 0, 3, 12, 1, 0);
  const boundaryMinute = getV6ShadowDecision({ now: () => now, fetchMarket });
  assert.deepEqual(requestedAsOf, [Date.UTC(2026, 0, 3, 12, 0, 59), Date.UTC(2026, 0, 3, 12, 1, 0)]);
  release[0]();
  release[1]();
  const [prior, boundary] = await Promise.all([priorMinute, boundaryMinute]);
  assert.equal(prior.generatedAt, '2026-01-03T12:00:59.000Z');
  assert.equal(boundary.generatedAt, '2026-01-03T12:01:00.000Z');
});
