import { runBacktest } from '@/domain/backtest';
import type { BacktestResult } from '@/domain/types';
import { fetchLatest24h, type MarketWindow } from '@/lib/market-data';

const LATEST_REPLAY_TTL_MS = 20_000;

export type ReplayPayload = {
  generatedAt: string;
  source: MarketWindow['source'];
  dataWindow: Pick<MarketWindow, 'startTime' | 'endTime'>;
  result: BacktestResult;
};

type ReplayDependencies = {
  fetchMarket?: () => Promise<MarketWindow>;
  run?: typeof runBacktest;
  now?: () => number;
};

type CachedReplay = {
  expiresAt: number;
  payload: ReplayPayload;
};

let latestReplay: CachedReplay | null = null;
let inFlightReplay: Promise<ReplayPayload> | null = null;

/**
 * Reuses a fresh latest-window replay briefly and coalesces simultaneous cache
 * misses so one burst does not multiply public market-data requests.
 */
export async function getLatestReplay(dependencies: ReplayDependencies = {}): Promise<ReplayPayload> {
  const now = dependencies.now ?? Date.now;
  const currentTime = now();
  if (latestReplay && latestReplay.expiresAt > currentTime) return latestReplay.payload;
  if (inFlightReplay) return inFlightReplay;

  const fetchMarket = dependencies.fetchMarket ?? fetchLatest24h;
  const run = dependencies.run ?? runBacktest;
  const refresh = (async () => {
    const market = await fetchMarket();
    const payload: ReplayPayload = {
      generatedAt: new Date(now()).toISOString(),
      source: market.source,
      dataWindow: { startTime: market.startTime, endTime: market.endTime },
      result: run(market.candles),
    };
    latestReplay = { payload, expiresAt: now() + LATEST_REPLAY_TTL_MS };
    return payload;
  })();

  inFlightReplay = refresh;
  try {
    return await refresh;
  } finally {
    if (inFlightReplay === refresh) inFlightReplay = null;
  }
}

export function clearLatestReplayCacheForTests(): void {
  latestReplay = null;
  inFlightReplay = null;
}
