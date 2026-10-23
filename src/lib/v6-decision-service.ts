import { MINUTE_MS } from '@/research/v6/types';
import { V6_CANDIDATE_REGISTRY, evaluateV6ShadowDecisions, type V6ShadowDecisionResult } from '@/research/v6/strategy';
import { fetchV6DecisionMarketData, V6MarketDataValidityError, type V6DecisionMarketData } from './v6-decision-data';

export type V6DecisionPayload = Readonly<{
  generatedAt: string;
  source: 'Bitstamp';
  modelStatus: 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY';
  data: Readonly<{ completedCandles: number; dataQualityPass: boolean }>;
  candidates: V6ShadowDecisionResult['candidates'];
}>;

export type V6DecisionServiceDependencies = Readonly<{
  now?: () => number;
  fetchMarket?: (now: number) => Promise<V6DecisionMarketData>;
  evaluate?: (input: Parameters<typeof evaluateV6ShadowDecisions>[0]) => V6ShadowDecisionResult;
}>;

type CachedDecision = { expiresAt: number; payload: V6DecisionPayload };
const cachedDecisions = new Map<number, CachedDecision>();
const inFlightDecisions = new Map<number, Promise<V6DecisionPayload>>();

function payloadFromEvaluation(asOf: number, source: V6DecisionPayload['source'], completedCandles: number, evaluated: V6ShadowDecisionResult): V6DecisionPayload {
  return {
    generatedAt: new Date(asOf).toISOString(),
    source,
    modelStatus: evaluated.modelStatus,
    data: {
      completedCandles,
      dataQualityPass: evaluated.candidates.every((candidate) => candidate.state !== 'data_invalid' && candidate.state !== 'insufficient_history'),
    },
    candidates: evaluated.candidates,
  };
}

/** Read-only shadow assembly keyed by the causal observation minute. */
export async function getV6ShadowDecision(dependencies: V6DecisionServiceDependencies = {}): Promise<V6DecisionPayload> {
  const now = dependencies.now ?? Date.now;
  const asOf = now();
  const observationMinute = Math.floor(asOf / MINUTE_MS) * MINUTE_MS;
  const exactMinuteBoundary = asOf === observationMinute;
  for (const [minute, cached] of cachedDecisions) {
    if (cached.expiresAt <= asOf || minute !== observationMinute) cachedDecisions.delete(minute);
  }
  if (!exactMinuteBoundary) {
    const cached = cachedDecisions.get(observationMinute);
    if (cached !== undefined && cached.expiresAt > asOf) return cached.payload;
  }
  const inFlight = inFlightDecisions.get(observationMinute);
  if (inFlight !== undefined) return inFlight;

  const fetchMarket = dependencies.fetchMarket ?? fetchV6DecisionMarketData;
  const evaluate = dependencies.evaluate ?? evaluateV6ShadowDecisions;
  const refresh = (async () => {
    try {
      const market = await fetchMarket(asOf);
      const evaluated = evaluate({ candles: market.candles, asOf, observedExecutionOpen: market.observedExecutionOpen, registry: V6_CANDIDATE_REGISTRY });
      const payload = payloadFromEvaluation(asOf, market.source, market.candles.length, evaluated);
      if (!exactMinuteBoundary) cachedDecisions.set(observationMinute, { expiresAt: observationMinute + MINUTE_MS, payload });
      return payload;
    } catch (error) {
      if (!(error instanceof V6MarketDataValidityError)) throw error;
      // Provider data arrived but cannot satisfy the frozen V>0/no-gap contract: report a truthful fail-closed observation.
      const evaluated = evaluate({ candles: [], asOf, observedExecutionOpen: null, registry: V6_CANDIDATE_REGISTRY });
      const payload = payloadFromEvaluation(asOf, 'Bitstamp', error.completedCandles, evaluated);
      if (!exactMinuteBoundary) cachedDecisions.set(observationMinute, { expiresAt: observationMinute + MINUTE_MS, payload });
      return payload;
    }
  })();
  inFlightDecisions.set(observationMinute, refresh);
  try {
    return await refresh;
  } finally {
    if (inFlightDecisions.get(observationMinute) === refresh) inFlightDecisions.delete(observationMinute);
  }
}

export function clearV6ShadowDecisionCacheForTests(): void {
  cachedDecisions.clear();
  inFlightDecisions.clear();
}
