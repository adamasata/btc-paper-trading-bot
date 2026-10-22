import assert from 'node:assert/strict';
import test from 'node:test';
import { latestCompletedWindow, parseBinance, parseCoinbase, validateCandles } from '../src/lib/market-data';

const minute = 60_000;

test('latest data window ends on the prior completed UTC minute', () => {
  const { startTime, endTime } = latestCompletedWindow(1_000_123);
  assert.equal(endTime, 960_000);
  assert.equal(startTime, 960_000 - 24 * 60 * minute);
});

test('provider parsers normalize, filter, and order candles before validation', () => {
  const startTime = 120_000;
  const endTime = 300_000;
  const binance = parseBinance([
    [240_000, '102', '0', '0', '103', '0', 0],
    [60_000, '99', '0', '0', '99', '0', 0],
    [120_000, '100', '0', '0', '101', '0', 0],
    [180_000, '101', '0', '0', '102', '0', 0],
  ], startTime, endTime);
  assert.deepEqual(binance, [
    { openTime: 120_000, open: 100, close: 101 },
    { openTime: 180_000, open: 101, close: 102 },
    { openTime: 240_000, open: 102, close: 103 },
  ]);
  assert.deepEqual(validateCandles(binance, startTime, endTime), binance);

  assert.deepEqual(parseCoinbase([
    [240, 0, 0, 102, 103, 0],
    [120, 0, 0, 100, 101, 0],
  ], startTime, endTime), [
    { openTime: 120_000, open: 100, close: 101 },
    { openTime: 240_000, open: 102, close: 103 },
  ]);
});

test('window validation rejects gaps and invalid prices', () => {
  assert.throws(
    () => validateCandles([{ openTime: 120_000, open: 100, close: 101 }], 120_000, 240_000),
    /Expected 2 complete one-minute candles, received 1/,
  );
  assert.throws(
    () => validateCandles([
      { openTime: 120_000, open: 100, close: 101 },
      { openTime: 180_000, open: 0, close: 102 },
    ], 120_000, 240_000),
    /gap or invalid BTC\/USD price/,
  );
});
