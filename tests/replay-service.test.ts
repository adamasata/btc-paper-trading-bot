import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLatestReplayCacheForTests, getLatestReplay } from '../src/lib/replay-service';
import type { Candle } from '../src/domain/types';

const minute = 60_000;
const candles: Candle[] = Array.from({ length: 80 }, (_, index) => ({ openTime: index * minute, open: 100, close: 100 }));


test('latest replay cache coalesces concurrent work and refreshes after its short TTL', async () => {
  clearLatestReplayCacheForTests();
  let currentTime = 1_000_000;
  let fetchCount = 0;
  const fetchMarket = async () => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { startTime: 0, endTime: 80 * minute, source: 'Binance.US' as const, candles };
  };
  const dependencies = { fetchMarket, now: () => currentTime };

  const [first, second] = await Promise.all([getLatestReplay(dependencies), getLatestReplay(dependencies)]);
  assert.strictEqual(first, second);
  assert.equal(fetchCount, 1);
  assert.strictEqual(await getLatestReplay(dependencies), first);
  assert.equal(fetchCount, 1);

  currentTime += 20_001;
  const refreshed = await getLatestReplay(dependencies);
  assert.notStrictEqual(refreshed, first);
  assert.equal(fetchCount, 2);
});
