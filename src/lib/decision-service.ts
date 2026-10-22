import { evaluateDecision, type DecisionOutput } from '@/domain/decision';
import { fetchDecisionMarketData, type DecisionMarketData } from '@/lib/decision-data';

const DECISION_CACHE_TTL_MS = 60_000;

export type DecisionPayload = {
  generatedAt: string;
  source: DecisionMarketData['source'];
  decision: DecisionOutput;
};

type DecisionDependencies = {
  fetchMarket?: (asOf: number) => Promise<DecisionMarketData>;
  evaluate?: typeof evaluateDecision;
  now?: () => number;
  failClosedOnMarketError?: boolean;
};

type CachedDecision = { expiresAt: number; payload: DecisionPayload };

let latestDecision: CachedDecision | null = null;
let inFlightDecision: Promise<DecisionPayload> | null = null;

/** Coalesces public data fetches and keeps a short, read-only research cache. */
export async function getLatestDecision(dependencies: DecisionDependencies = {}): Promise<DecisionPayload> {
  const now = dependencies.now ?? Date.now;
  const currentTime = now();
  if (latestDecision && latestDecision.expiresAt > currentTime) return latestDecision.payload;
  if (inFlightDecision) return inFlightDecision;

  const fetchMarket = dependencies.fetchMarket ?? fetchDecisionMarketData;
  const evaluate = dependencies.evaluate ?? evaluateDecision;
  const refresh = (async () => {
    // Capture one as-of instant before fetching so a UTC boundary crossed
    // during network I/O cannot create a false stale-bar failure.
    const generatedAt = currentTime;
    let market: DecisionMarketData;
    try {
      market = await fetchMarket(generatedAt);
    } catch (error) {
      const failClosed = dependencies.failClosedOnMarketError ?? fetchMarket === fetchDecisionMarketData;
      if (!failClosed) throw error;
      const decision = evaluate({ daily: [], hourly: [], fearGreed: [], asOf: generatedAt });
      decision.actionReason = 'Fail closed: required candle data is temporarily unavailable, so no actioning setup can be evaluated.';
      const payload: DecisionPayload = {
        generatedAt: new Date(generatedAt).toISOString(),
        source: 'Binance.US',
        decision,
      };
      latestDecision = { payload, expiresAt: generatedAt + DECISION_CACHE_TTL_MS };
      return payload;
    }
    const payload: DecisionPayload = {
      generatedAt: new Date(generatedAt).toISOString(),
      source: market.source,
      decision: evaluate({ ...market, asOf: generatedAt }),
    };
    latestDecision = { payload, expiresAt: generatedAt + DECISION_CACHE_TTL_MS };
    return payload;
  })();
  inFlightDecision = refresh;
  try {
    return await refresh;
  } finally {
    if (inFlightDecision === refresh) inFlightDecision = null;
  }
}

export function clearLatestDecisionCacheForTests(): void {
  latestDecision = null;
  inFlightDecision = null;
}
