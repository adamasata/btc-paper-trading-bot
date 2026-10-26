export const experimentIds = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const;

export type ExperimentId = (typeof experimentIds)[number];
export type EvaluationState = 'rejected' | 'pending';
export type EvidenceTreatment = 'exact-feed observational audit' | 'chronological development and holdout' | 'post-hoc exploratory' | 'frozen shadow observation';

export type ExperimentScore = {
  positiveWindows: string;
  meanReturn: string;
  profitFactor: string;
  totalProfit: string;
};

export type ResearchExperiment = {
  id: ExperimentId;
  name: string;
  method: string;
  evaluationState: EvaluationState;
  treatment: EvidenceTreatment;
  keyScore: ExperimentScore | null;
  failureOrLearning: string;
  holdout: string;
  source: string;
  bestObserved?: true;
};

export const researchExperiments: readonly ResearchExperiment[] = [
  {
    id: 'v1',
    name: 'EMA + scheduled rounds baseline',
    method: 'A causal EMA trend entry plus fixed scheduled rounds; completed one-minute BTC/USD candles and next-open fills.',
    evaluationState: 'rejected',
    treatment: 'exact-feed observational audit',
    keyScore: { positiveWindows: '11 / 52 (21.2%)', meanReturn: '−0.177%', profitFactor: 'Not a promotion result', totalProfit: 'Average fees $20.09' },
    failureOrLearning: 'The exact BTCUSD daily-window audit was mostly negative: median return was −0.225%. It remains a baseline, not an approved strategy.',
    holdout: 'Not a qualified candidate for promotion.',
    source: 'Committed v1 audit facts and research/preregistration-v1.json.',
  },
  {
    id: 'v2',
    name: 'Selective-regime pullback',
    method: 'Trend-regime pullbacks with predeclared EMA, pullback, target, stop, and holding-time combinations.',
    evaluationState: 'rejected',
    treatment: 'chronological development and holdout',
    keyScore: null,
    failureOrLearning: 'Actual v2 outcome: NO WINNER. Generations 1–4 were evaluated, but no development candidate passed every pre-holdout qualification gate.',
    holdout: 'Sealed; never opened because no candidate was frozen.',
    source: 'research/runs/2026-10-23T06-25-51-688Z/outcome.json (v2 successor record).',
  },
  {
    id: 'v3',
    name: 'Allocation study',
    method: 'A five-entry green-candle-streak continuation rule tested at three declared allocation levels on the persisted accepted artifact.',
    evaluationState: 'rejected',
    treatment: 'chronological development and holdout',
    keyScore: null,
    failureOrLearning: 'No allocation passed the unchanged development qualification gate, so the study produced no candidate to promote.',
    holdout: 'Sealed; never opened.',
    source: 'research/runs/2026-10-23T06-33-11-306Z-v3/outcome.json.',
  },
  {
    id: 'v4',
    name: 'Green-streak continuation',
    method: 'Continuation after consecutive completed green minutes, with declared streak length, minimum move, hold time, and allocation grids.',
    evaluationState: 'rejected',
    treatment: 'post-hoc exploratory',
    keyScore: { positiveWindows: '15%', meanReturn: '−0.09285%', profitFactor: '0.255', totalProfit: '−$185.71' },
    failureOrLearning: 'The top rejected candidate was negative and failed all qualification gates, including the added positive-window threshold.',
    holdout: 'Sealed; not accessed.',
    source: 'research/runs/2026-10-23T07-12-34-900Z-v4/outcome.json.',
  },
  {
    id: 'v5',
    name: 'Daily-time bias',
    method: 'A bounded set of UTC entry-hour, prior-four-hour direction, hold-time, and allocation combinations.',
    evaluationState: 'rejected',
    treatment: 'post-hoc exploratory',
    keyScore: { positiveWindows: '28.75% (5.75 / 20)', meanReturn: '−0.0408%', profitFactor: '0.48', totalProfit: '−$81.65' },
    failureOrLearning: 'Closest by the recorded ranking, not a success: it failed every qualification gate, including at least 12 of 20 positive development windows.',
    holdout: 'Sealed; not accessed.',
    source: 'research/runs/2026-10-23T07-03-01-732Z-v5/outcome.json.',
    bestObserved: true,
  },
  {
    id: 'v6',
    name: 'Anchored VWAP / relative volume · Stage 1',
    method: 'A frozen shadow observer: detect a relative-volume event, anchor VWAP, assess after 60 minutes, and use a next-minute open if eligible.',
    evaluationState: 'pending',
    treatment: 'frozen shadow observation',
    keyScore: null,
    failureOrLearning: 'The rules and three 25% variants are frozen, but there is no scored evaluation result to report yet.',
    holdout: 'No evaluation result yet.',
    source: 'research/preregistration-v6.json and research/v6-stage1-family-spec.md.',
  },
] as const;

export type ResearchAtlasSummary = {
  productionWinner: null;
  bestObserved: ResearchExperiment;
  experiments: readonly ResearchExperiment[];
};

export function summarizeResearchAtlas(experiments: readonly ResearchExperiment[] = researchExperiments): ResearchAtlasSummary {
  const ids = new Set(experiments.map((experiment) => experiment.id));
  if (experiments.length !== experimentIds.length || ids.size !== experimentIds.length || experimentIds.some((id) => !ids.has(id))) {
    throw new Error('The Research Atlas must contain each registered experiment exactly once.');
  }

  const bestObserved = experiments.filter((experiment) => experiment.bestObserved === true);
  if (bestObserved.length !== 1 || bestObserved[0].evaluationState !== 'rejected') {
    throw new Error('Best observed must be one explicitly rejected experiment.');
  }

  return { productionWinner: null, bestObserved: bestObserved[0], experiments };
}
