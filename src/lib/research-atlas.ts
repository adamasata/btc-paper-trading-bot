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

export type DevelopmentResult = {
  label: string;
  candidatesTried?: string;
  positiveWindows: string;
  meanReturn: string;
  profitFactor: string;
  totalProfit: string;
  qualification: string;
};

export type DevelopmentResultsTable = {
  title: string;
  caption: string;
  note: string;
  rows: readonly DevelopmentResult[];
};

export type ResearchExperiment = {
  id: ExperimentId;
  name: string;
  method: string;
  evaluationState: EvaluationState;
  treatment: EvidenceTreatment;
  keyScore: ExperimentScore | null;
  developmentResults?: DevelopmentResultsTable;
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
    developmentResults: {
      title: 'Development-only top candidates',
      caption: 'First recorded top-candidate aggregate from each predeclared v2 generation.',
      note: 'These are development-only top candidates, not a valid cross-family winner selection. All four generations failed qualification gates, so the holdout remained sealed.',
      rows: [
        { label: 'selective-regime-pullback', candidatesTried: '96', positiveWindows: '4 / 20 (20.0%)', meanReturn: '−0.247630%', profitFactor: '0.320', totalProfit: '−$495.26', qualification: '0 qualified' },
        { label: 'volatility-contraction-breakout-retest', candidatesTried: '24', positiveWindows: '2.25 / 20 (11.25%)', meanReturn: '−0.169924%', profitFactor: '0.171', totalProfit: '−$339.85', qualification: '0 qualified' },
        { label: 'range-regime-mean-reversion', candidatesTried: '24', positiveWindows: '0 / 20', meanReturn: '−0.534258%', profitFactor: '0.103', totalProfit: '−$1,068.52', qualification: '0 qualified' },
        { label: 'session-momentum', candidatesTried: '24', positiveWindows: '2.25 / 20 (11.25%)', meanReturn: '−0.058525%', profitFactor: '0.228', totalProfit: '−$117.05', qualification: '0 qualified' },
      ],
    },
    failureOrLearning: 'Actual v2 outcome: NO WINNER. Generations 1–4 were evaluated, but no development candidate passed every pre-holdout qualification gate.',
    holdout: 'Sealed; never opened because no candidate was frozen.',
    source: 'research/runs/2026-10-23T06-25-51-688Z/development.json and outcome.json.',
  },
  {
    id: 'v3',
    name: 'Allocation study',
    method: 'A five-entry green-candle-streak continuation rule tested at three declared allocation levels on the persisted accepted artifact.',
    evaluationState: 'rejected',
    treatment: 'chronological development and holdout',
    keyScore: null,
    developmentResults: {
      title: 'Declared allocation results',
      caption: 'All declared v3 allocation variants on the persisted accepted artifact.',
      note: 'Observed learning: fee and turnover drag dominated every allocation. No allocation qualified, and the holdout remained sealed.',
      rows: [
        { label: '25% allocation', positiveWindows: '0 / 20', meanReturn: '−1.449183%', profitFactor: '0.0075', totalProfit: '−$2,898.37', qualification: 'Not qualified' },
        { label: '40% allocation', positiveWindows: '0 / 20', meanReturn: '−2.318635%', profitFactor: '0.0075', totalProfit: '−$4,637.27', qualification: 'Not qualified' },
        { label: '60% allocation', positiveWindows: '0 / 20', meanReturn: '−3.477905%', profitFactor: '0.0075', totalProfit: '−$6,955.81', qualification: 'Not qualified' },
      ],
    },
    failureOrLearning: 'No allocation passed the unchanged development qualification gate. Fee and turnover drag were the observed learning, not a candidate to promote.',
    holdout: 'Sealed; never opened.',
    source: 'research/runs/2026-10-23T06-33-11-306Z-v3/development.json and outcome.json.',
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
    failureOrLearning: 'Caveated post-hoc observation, not a success: it failed every qualification gate, including at least 12 of 20 positive development windows.',
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
