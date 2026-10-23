export const MINUTE_MS = 60_000;
export const TIMEFRAME_MS = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '4h': 4 * 60 * MINUTE_MS,
  '1d': 24 * 60 * MINUTE_MS,
} as const;

export type Timeframe = keyof typeof TIMEFRAME_MS;
export type TimestampMs = number;

/** Provider rows are retained without projection so normalization is auditable. */
export type RawOhlcvRow = {
  openTime: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  [field: string]: unknown;
};

/** A base or derived UTC candle with an exclusive close boundary. */
export type NormalizedOhlcv = {
  openTime: TimestampMs;
  closeTime: TimestampMs;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TimeframeBars = Readonly<Record<Timeframe, readonly NormalizedOhlcv[]>>;

export type TimeRange = {
  startTime: TimestampMs;
  endTime: TimestampMs;
};

export type QuarantinedRange = TimeRange & { id: string };

/** Legacy evidence is retained as a location and immutable content hash only. */
export type LegacyQuarantineRecord = {
  path: string;
  sha256: string;
};

/** Required evaluation-grade quarantine manifest, including an explicit empty registry. */
export type QuarantineRegistry = {
  schemaVersion: 1;
  ranges: readonly QuarantinedRange[];
  legacyRecords: readonly LegacyQuarantineRecord[];
};

export type DataManifestIntegrity = {
  rawSha256: string;
  normalizedSha256: string;
  quarantineRegistrySha256: string;
  normalizerVersion: string;
  firstOpenTime: TimestampMs;
  lastCompleteOpenTime: TimestampMs;
  candleCount: number;
};

export type CostScenario = {
  id: string;
  version: string;
  feeRate: number;
  spreadBps: number;
  adverseSlippageBps: number;
  classification: 'base' | 'adverse';
};

export type LongFill = {
  side: 'buy' | 'sell';
  scenarioId: string;
  scenarioVersion: string;
  referencePrice: number;
  executionPrice: number;
  quantityBtc: number;
  grossNotionalUsd: number;
  feeUsd: number;
  totalDebitUsd: number;
  netCreditUsd: number;
  spreadCostUsd: number;
  slippageCostUsd: number;
};

export type ResearchFill = LongFill & {
  id: string;
  candidateId: string;
  windowId: string;
  foldId: string | null;
  decisionTime: TimestampMs;
  featureAvailableThrough: TimestampMs;
  fillTime: TimestampMs;
  sleeve: 'genuine' | 'qualification_overlay';
  reason: string;
  forcedBoundaryExit: boolean;
};

export type ResearchTrade = {
  id: string;
  candidateId: string;
  windowId: string;
  foldId: string | null;
  scenarioId: string;
  sleeve: 'genuine' | 'qualification_overlay';
  entryFill: ResearchFill;
  exitFill: ResearchFill;
  quantityBtc: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  holdMinutes: number;
  exitReason: string;
  forcedBoundaryExit: boolean;
};

export type PrimaryWindow = TimeRange & {
  id: string;
  classification: 'primary_independent';
};

/** Diagnostics intentionally have no primary-denominator capability. */
export type CorrelatedRobustnessWindow = TimeRange & {
  id: string;
  offsetHours: number;
  classification: 'correlated_diagnostic';
};

export type Fold = {
  id: string;
  trainRange: TimeRange;
  purgeRange: TimeRange;
  validationRange: TimeRange;
  maxLookbackMinutes: number;
  maxHoldingMinutes: number;
};