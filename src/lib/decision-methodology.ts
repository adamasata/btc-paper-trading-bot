export type MethodologySource = {
  id: number;
  title: string;
  creator: string;
  publicationDate: string | null;
  url: string;
  evidence: string;
  decisionLabMapping: string;
  caveat: string;
};

export const methodologySources: MethodologySource[] = [
  {
    id: 1,
    title: 'The #1 Bitcoin Indicator You Need To Watch To Predict Price',
    creator: 'DataDash / Nicholas Merten',
    publicationDate: '2024-04-24',
    url: 'https://www.youtube.com/watch?v=ph7TMt-zIio',
    evidence: 'Discusses a 21-day SMA/EMA pocket, 100/200-day moving-average context, and oscillators as nondeterministic context.',
    decisionLabMapping: 'Motivated displaying completed 21-day SMA/EMA and 100/200-day context. It is not a price prediction or a rule source for oscillators.',
    caveat: 'Registered research summary; the video is not treated as strategy proof or a live signal.',
  },
  {
    id: 2,
    title: 'YouTube source n6oAJKwHcNo (title not independently retrieved)',
    creator: 'DataDash / Paul Sampson',
    publicationDate: '2025-02-06',
    url: 'https://www.youtube.com/watch?v=n6oAJKwHcNo',
    evidence: 'Discusses frozen prior-session averages and Fibonacci/range framing; contains an approximately 70% claim that is not verified here.',
    decisionLabMapping: 'Motivated frozen prior close-mean references only. Fibonacci/range framing and the unverified performance claim are excluded from the rules.',
    caveat: 'The approximate 70% claim is explicitly unverified and must not be read as expectancy evidence.',
  },
  {
    id: 3,
    title: 'Bitcoin Is About to Shock Everyone... The Breakout Has Begun',
    creator: 'DataDash / Paul Sampson',
    publicationDate: '2026-08-20',
    url: 'https://www.youtube.com/watch?v=JcBUcSiRZmI',
    evidence: 'Uses close confirmation, a fixed 180-day average, invalidation, and no-chase framing.',
    decisionLabMapping: 'Motivated completed-close confirmation and an explicit no-chase/invalidation disclosure. The 180-day average and discretionary breakout claim are not copied.',
    caveat: 'Registered research summary; no performance or causality claim is inferred from the video.',
  },
  {
    id: 4,
    title: 'YouTube source mH9o6zAoSw0 (title not independently retrieved)',
    creator: 'Creator not independently retrieved',
    publicationDate: null,
    url: 'https://www.youtube.com/watch?v=mH9o6zAoSw0',
    evidence: 'Recent creator-video example of promotional/certainty framing.',
    decisionLabMapping: 'Used only as a negative example: promotional certainty is not an action rule, source of targets, or probability estimate.',
    caveat: 'Publication date and metadata are unknown in this registry; this source was not used for strategy proof.',
  },
  {
    id: 5,
    title: 'YouTube source iGC1KVUU5sI (title not independently retrieved)',
    creator: 'Creator not independently retrieved',
    publicationDate: null,
    url: 'https://www.youtube.com/watch?v=iGC1KVUU5sI',
    evidence: 'Recent creator-video example of promotional/certainty framing.',
    decisionLabMapping: 'Used only as a negative example: promotional certainty is not an action rule, source of targets, or probability estimate.',
    caveat: 'Publication date and metadata are unknown in this registry; this source was not used for strategy proof.',
  },
  {
    id: 6,
    title: 'YouTube source 2Yni82DI-qQ (title not independently retrieved)',
    creator: 'Creator not independently retrieved',
    publicationDate: null,
    url: 'https://www.youtube.com/watch?v=2Yni82DI-qQ',
    evidence: 'Recent creator-video example of promotional/certainty framing.',
    decisionLabMapping: 'Used only as a negative example: promotional certainty is not an action rule, source of targets, or probability estimate.',
    caveat: 'Publication date and metadata are unknown in this registry; this source was not used for strategy proof.',
  },
  {
    id: 7,
    title: 'DataDash X status 2105311203123695819',
    creator: 'DataDash',
    publicationDate: null,
    url: 'https://x.com/datadashpro/status/2105311203123695819',
    evidence: 'Social-post research example; content was not used as a strategy input.',
    decisionLabMapping: 'Used only to document the access and framing limits of social research. It contributes no rule, score, or action.',
    caveat: 'Access and retrieval can vary by viewer/session; publication date and text are not independently retrieved here.',
  },
  {
    id: 8,
    title: 'Paul X status 2100975556300767234',
    creator: 'Paul Sampson',
    publicationDate: null,
    url: 'https://x.com/paulsampson0x/status/2100975556300767234',
    evidence: 'Social-post research example; content was not used as a strategy input.',
    decisionLabMapping: 'Used only to document the access and framing limits of social research. It contributes no rule, score, or action.',
    caveat: 'Access and retrieval can vary by viewer/session; publication date and text are not independently retrieved here.',
  },
];
