import assert from 'node:assert/strict';
import test from 'node:test';
import { clearFearGreedContextForTests, fetchDecisionMarketData, parseCompletedBinanceLabCandles, parseFearGreed, parseObservedHourlyOpenAtBoundary, validateCompletedLabCandles } from '../src/lib/decision-data';
import { clearLatestDecisionCacheForTests, getLatestDecision } from '../src/lib/decision-service';

const HOUR = 60 * 60 * 1_000;
const now = 5 * HOUR + 30_000;

function row(openTime: number, open = 100): [number, string, string, string, string, string, number] {
  return [openTime, String(open), String(open + 2), String(open - 2), String(open + 1), '1', openTime + HOUR - 1];
}

test('Decision Lab parser keeps completed Binance.US bars and validates contiguous latest history', () => {
  const candles = parseCompletedBinanceLabCandles([row(3 * HOUR), row(HOUR), row(2 * HOUR), row(4 * HOUR)], HOUR, now);
  assert.deepEqual(candles.map((item) => item.openTime), [HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR]);
  assert.deepEqual(validateCompletedLabCandles(candles, HOUR, now, 4), candles);
  assert.throws(() => validateCompletedLabCandles([candles[0], candles[2], candles[3]], HOUR, now, 3), /gap/);
});

test('observed execution open is exposed only at an exact hourly boundary', () => {
  const payload = [row(4 * HOUR, 123), row(5 * HOUR, 456)];
  assert.deepEqual(parseObservedHourlyOpenAtBoundary(payload, 5 * HOUR), { openTime: 5 * HOUR, open: 456 });
  assert.equal(parseObservedHourlyOpenAtBoundary(payload, 5 * HOUR + 1), null);
  assert.equal(parseObservedHourlyOpenAtBoundary([row(4 * HOUR, 123)], 5 * HOUR), null);
});

test('Decision Lab parser rejects malformed and invalid candle payloads', () => {
  assert.throws(() => parseCompletedBinanceLabCandles({ data: [] }, HOUR, now), /non-array/);
  assert.throws(() => parseCompletedBinanceLabCandles([[HOUR]], HOUR, now), /malformed/);
  assert.throws(() => parseCompletedBinanceLabCandles([[HOUR, '100', '99', '101', '100', '1', 0]], HOUR, now), /invalid/);
});

test('Fear & Greed parser normalizes seven newest values and rejects provider errors', () => {
  const payload = { data: Array.from({ length: 8 }, (_, index) => ({ value: String(60 - index), value_classification: 'Neutral', timestamp: String(1_700_000_000 - index * 86_400) })) };
  const values = parseFearGreed(payload);
  assert.equal(values.length, 7);
  assert.equal(values[0].timestamp, 1_700_000_000_000);
  assert.throws(() => parseFearGreed({ data: [{ value: '101', value_classification: 'No', timestamp: '1' }] }), /invalid/);
  assert.throws(() => parseFearGreed({ data: [] }), /Expected 7/);
});

test('optional Fear & Greed refresh never delays validated required candle data', async () => {
  clearFearGreedContextForTests();
  const decisionNow = Date.UTC(2026, 0, 15, 12, 30);
  const dailyStart = Math.floor(decisionNow / (24 * HOUR)) * (24 * HOUR) - 220 * 24 * HOUR;
  const hourlyStart = Math.floor(decisionNow / HOUR) * HOUR - 72 * HOUR;
  const dailyRows = Array.from({ length: 220 }, (_, index) => row(dailyStart + index * 24 * HOUR, 100 + index));
  const hourlyRows = Array.from({ length: 72 }, (_, index) => row(hourlyStart + index * HOUR, 200 + index));
  const fetcher: typeof fetch = async (url) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('alternative.me')) return new Promise<Response>(() => undefined);
    return new Response(JSON.stringify(href.includes('interval=1d') ? dailyRows : hourlyRows));
  };
  const result = await Promise.race([
    fetchDecisionMarketData(decisionNow, fetcher),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('optional context blocked required data')), 100)),
  ]);
  assert.equal(result.daily.length, 220);
  assert.equal(result.hourly.length, 72);
  assert.deepEqual(result.fearGreed, []);
  clearFearGreedContextForTests();
});

test('Decision service coalesces cache misses and does not retain a failed refresh', async () => {
  clearLatestDecisionCacheForTests();
  let currentTime = now;
  let calls = 0;
  let requestedAsOf: number | null = null;
  const fetchMarket = async (asOf: number) => {
    calls += 1;
    requestedAsOf = asOf;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { source: 'Binance.US' as const, daily: [], hourly: [], fearGreed: [], executionOpen: null };
  };
  const dependencies = { fetchMarket, now: () => currentTime };
  const [first, second] = await Promise.all([getLatestDecision(dependencies), getLatestDecision(dependencies)]);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(requestedAsOf, currentTime);
  assert.strictEqual(await getLatestDecision(dependencies), first);
  currentTime += 60_001;
  await getLatestDecision(dependencies);
  assert.equal(calls, 2);

  clearLatestDecisionCacheForTests();
  let attempts = 0;
  const flaky = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary outage');
    return { source: 'Binance.US' as const, daily: [], hourly: [], fearGreed: [], executionOpen: null };
  };
  await assert.rejects(getLatestDecision({ fetchMarket: flaky, now: () => currentTime }), /temporary outage/);
  await getLatestDecision({ fetchMarket: flaky, now: () => currentTime });
  assert.equal(attempts, 2);

  clearLatestDecisionCacheForTests();
  const unavailable = await getLatestDecision({
    fetchMarket: async () => { throw new Error('required provider unavailable'); },
    failClosedOnMarketError: true,
    now: () => currentTime,
  });
  assert.equal(unavailable.decision.action, 'NO TRADE');
  assert.equal(unavailable.decision.data.dataQualityPass, false);
  assert.match(unavailable.decision.actionReason, /required candle data is temporarily unavailable/);
});
