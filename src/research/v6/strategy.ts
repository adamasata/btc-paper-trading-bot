import { validateCompleteOhlcv } from './data-contract';
import { baseCostScenario, createCostScenarioRegistry, executeLongBuy, executeLongSell } from './cost-model';
import { MINUTE_MS, type NormalizedOhlcv } from './types';

export const V6_TRAILING_MEDIAN_MINUTES = 1_440;
export const V6_ASSESSMENT_MINUTES = 60;
export const V6_EXIT_CHECK_MINUTES = 30;
export const V6_MAX_HOLD_MINUTES = 12 * 60;
export const V6_MAX_ENTRIES_PER_UTC_DAY = 2;
export const V6_ENTRY_CUTOFF_UTC_HOUR = 12;
export const V6_ALLOCATION_FRACTION = 0.25;
export const V6_INITIAL_EQUITY_USD = 10_000;
export const V6_FEE_RATE = 0.001;
export const V6_ADVERSE_FILL_STRESS_BPS = [0, 5, 10] as const;

export type V6CandidateDefinition = Readonly<{
  id: 'v6-avwap-vrel3-accept60-a025' | 'v6-avwap-vrel5-accept60-a025' | 'v6-avwap-vrel8-accept60-a025';
  anchorVolumeMultiplier: 3 | 5 | 8;
  allocationFraction: 0.25;
}>;

const EXPECTED_CANDIDATES = [
  { id: 'v6-avwap-vrel3-accept60-a025', anchorVolumeMultiplier: 3, allocationFraction: V6_ALLOCATION_FRACTION },
  { id: 'v6-avwap-vrel5-accept60-a025', anchorVolumeMultiplier: 5, allocationFraction: V6_ALLOCATION_FRACTION },
  { id: 'v6-avwap-vrel8-accept60-a025', anchorVolumeMultiplier: 8, allocationFraction: V6_ALLOCATION_FRACTION },
] as const satisfies readonly V6CandidateDefinition[];

/** The frozen Stage-1 multiplicity family. It is deliberately not configurable. */
export const V6_CANDIDATE_REGISTRY: readonly V6CandidateDefinition[] = Object.freeze(
  EXPECTED_CANDIDATES.map((candidate) => Object.freeze({ ...candidate })),
);

const v6CostRegistry = createCostScenarioRegistry([
  baseCostScenario({ id: 'v6-shadow-fee-10bp', version: 'v6.0', feeRate: V6_FEE_RATE, spreadBps: 0, adverseSlippageBps: 0 }),
]);
const v6CostScenario = v6CostRegistry.get('v6-shadow-fee-10bp');

function isExactCandidate(candidate: unknown, expected: V6CandidateDefinition): boolean {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const item = candidate as Record<string, unknown>;
  return Object.keys(item).length === 3
    && item.id === expected.id
    && item.anchorVolumeMultiplier === expected.anchorVolumeMultiplier
    && item.allocationFraction === expected.allocationFraction;
}

/** Rejects additions, reorderings, parameter changes, and unregistered fields at runtime. */
export function validateV6CandidateRegistry(registry: unknown): asserts registry is readonly V6CandidateDefinition[] {
  if (!Array.isArray(registry) || registry.length !== EXPECTED_CANDIDATES.length) throw new Error('v6 candidate registry must contain exactly three preregistered candidates.');
  for (let index = 0; index < EXPECTED_CANDIDATES.length; index += 1) {
    if (!isExactCandidate(registry[index], EXPECTED_CANDIDATES[index])) throw new Error(`v6 candidate registry entry ${index} does not match the frozen preregistration.`);
  }
}

export type V6ShadowState = 'insufficient_history' | 'waiting_for_anchor' | 'waiting_for_assessment' | 'entry_ready' | 'long' | 'exit_ready' | 'no_signal' | 'data_invalid';
export type V6ExecutionIntent = 'NONE' | 'BUY_AT_NEXT_OPEN' | 'SELL_AT_NEXT_OPEN';
export type ObservedMinuteOpen = Readonly<{ openTime: number; open: number }>;

export type V6AnchorMetrics = Readonly<{ avwap: number; participationQ: number; anchorVolume: number }>;
export type V6Execution = Readonly<{ intent: V6ExecutionIntent; openTime: number | null; observedOpen: number | null; executable: boolean }>;
export type V6PaperAccount = Readonly<{
  initialEquityUsd: number;
  currentEquityUsd: number;
  cashUsd: number;
  btcQuantity: number;
  markPrice: number | null;
  preBuyEquityUsd: number | null;
  intendedAllocationUsd: number | null;
}>;

export type V6CandidateShadowDecision = Readonly<{
  candidateId: V6CandidateDefinition['id'];
  anchorTime: number | null;
  assessmentTime: number | null;
  price: number | null;
  avwap: number | null;
  participationQ: number | null;
  state: V6ShadowState;
  reason: string;
  execution: V6Execution;
  paperAccount: V6PaperAccount;
  filledEntriesToday: number;
  completedRoundTripsToday: number;
  lastExitReason: 'avwap_loss' | 'max_hold_12h' | 'utc_boundary' | null;
}>;

export type V6ShadowDecisionResult = Readonly<{ modelStatus: 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY'; asOf: number; candidates: readonly V6CandidateShadowDecision[] }>;
export type V6ShadowDecisionInput = Readonly<{ candles: readonly NormalizedOhlcv[]; asOf: number; observedExecutionOpen: ObservedMinuteOpen | null; registry?: readonly V6CandidateDefinition[] }>;

type ActiveAnchor = { index: number; openTime: number };
type PendingOrder = { side: 'buy' | 'sell'; fillIndex: number; reason: 'entry' | 'avwap_loss' | 'max_hold_12h' | 'utc_boundary' };
type OpenPosition = { anchorIndex: number; entryDecisionIndex: number; entryFillIndex: number };
type Account = { cashUsd: number; btcQuantity: number; preBuyEquityUsd: number | null; intendedAllocationUsd: number | null };
type Runtime = {
  activeAnchor: ActiveAnchor | null;
  pendingOrder: PendingOrder | null;
  position: OpenPosition | null;
  account: Account;
  filledEntriesToday: number;
  completedRoundTripsToday: number;
  lastExitReason: V6CandidateShadowDecision['lastExitReason'];
  state: V6ShadowState;
  reason: string;
  terminalNoSignal: boolean;
  strategyStarted: boolean;
};

const noExecution = (): V6Execution => ({ intent: 'NONE', openTime: null, observedOpen: null, executable: false });
const DAY_MS = 24 * 60 * MINUTE_MS;

function utcDayStart(timestamp: number): number { return Math.floor(timestamp / DAY_MS) * DAY_MS; }
function isUtcBoundaryOpen(timestamp: number): boolean { return timestamp === utcDayStart(timestamp); }
function executionFor(intent: V6ExecutionIntent, openTime: number, observed: ObservedMinuteOpen | null): V6Execution {
  const executable = observed !== null && observed.openTime === openTime && Number.isFinite(observed.open) && observed.open > 0;
  return { intent, openTime, observedOpen: executable ? observed.open : null, executable };
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Median requires values.');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = ordered.length / 2;
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[Math.floor(middle)];
}

/** The current bar is intentionally excluded from the 1,440 completed predecessor volumes. */
export function trailingVolumeMedian(candles: readonly NormalizedOhlcv[], index: number): number | null {
  if (!Number.isInteger(index) || index < V6_TRAILING_MEDIAN_MINUTES || index >= candles.length) return null;
  return median(candles.slice(index - V6_TRAILING_MEDIAN_MINUTES, index).map((candle) => candle.volume));
}

/** Computes each expensive trailing median once, shared by all preregistered candidates. */
function precomputeTrailingVolumeMedians(candles: readonly NormalizedOhlcv[]): readonly (number | null)[] {
  return candles.map((_, index) => trailingVolumeMedian(candles, index));
}

export function typicalPrice(candle: NormalizedOhlcv): number { return (candle.high + candle.low + candle.close) / 3; }

/** Includes anchor and assessment bars in AVWAP; Q intentionally begins one minute after the anchor. */
export function anchorMetrics(candles: readonly NormalizedOhlcv[], anchorIndex: number, index: number): V6AnchorMetrics {
  if (!Number.isInteger(anchorIndex) || !Number.isInteger(index) || anchorIndex < 0 || index < anchorIndex || index >= candles.length) throw new Error('Anchor metrics require an in-range inclusive anchor-to-current window.');
  let weightedPriceVolume = 0;
  let totalVolume = 0;
  let postAnchorVolume = 0;
  for (let cursor = anchorIndex; cursor <= index; cursor += 1) {
    const candle = candles[cursor];
    weightedPriceVolume += typicalPrice(candle) * candle.volume;
    totalVolume += candle.volume;
    if (cursor > anchorIndex) postAnchorVolume += candle.volume;
  }
  if (!Number.isFinite(weightedPriceVolume) || !Number.isFinite(totalVolume) || totalVolume <= 0) throw new Error('Anchor metrics require positive finite volume.');
  return { avwap: weightedPriceVolume / totalVolume, participationQ: postAnchorVolume / candles[anchorIndex].volume, anchorVolume: candles[anchorIndex].volume };
}

function initialRuntime(): Runtime {
  return {
    activeAnchor: null, pendingOrder: null, position: null,
    account: { cashUsd: V6_INITIAL_EQUITY_USD, btcQuantity: 0, preBuyEquityUsd: null, intendedAllocationUsd: null },
    filledEntriesToday: 0, completedRoundTripsToday: 0, lastExitReason: null,
    state: 'waiting_for_anchor', reason: 'Awaiting the first complete UTC day boundary; initial partial-day candles are warm-up only.',
    terminalNoSignal: false, strategyStarted: false,
  };
}

function resetForUtcDay(runtime: Runtime, retainedExitReason: Runtime['lastExitReason'] = null): void {
  runtime.activeAnchor = null;
  runtime.pendingOrder = null;
  runtime.position = null;
  runtime.filledEntriesToday = 0;
  runtime.completedRoundTripsToday = 0;
  runtime.lastExitReason = retainedExitReason;
  runtime.state = 'waiting_for_anchor';
  runtime.reason = 'No eligible relative-volume anchor has completed.';
  runtime.terminalNoSignal = false;
}

function accountEquity(account: Account, referencePrice: number): number { return account.cashUsd + account.btcQuantity * referencePrice; }

function fillPendingOrder(runtime: Runtime, order: PendingOrder, referenceOpen: number): void {
  if (order.side === 'buy') {
    if (runtime.activeAnchor === null) throw new Error('Entry fill requires its active anchor.');
    const preBuyEquityUsd = accountEquity(runtime.account, referenceOpen);
    const intendedAllocationUsd = preBuyEquityUsd * V6_ALLOCATION_FRACTION;
    const fill = executeLongBuy({ scenario: v6CostScenario, referencePrice: referenceOpen, cashAvailableUsd: runtime.account.cashUsd, cashToSpendUsd: intendedAllocationUsd });
    runtime.account.cashUsd -= fill.totalDebitUsd;
    runtime.account.btcQuantity += fill.quantityBtc;
    runtime.account.preBuyEquityUsd = preBuyEquityUsd;
    runtime.account.intendedAllocationUsd = intendedAllocationUsd;
    runtime.position = { anchorIndex: runtime.activeAnchor.index, entryDecisionIndex: order.fillIndex - 1, entryFillIndex: order.fillIndex };
    runtime.filledEntriesToday += 1;
    runtime.pendingOrder = null;
    runtime.state = 'long';
    runtime.reason = 'Paper long is open from a prior completed-bar decision; anchors are ignored while long.';
    return;
  }
  if (runtime.position === null || runtime.account.btcQuantity <= 0) throw new Error('Exit fill requires an open paper position.');
  const fill = executeLongSell({ scenario: v6CostScenario, referencePrice: referenceOpen, quantityBtc: runtime.account.btcQuantity });
  runtime.account.cashUsd += fill.netCreditUsd;
  runtime.account.btcQuantity = 0;
  runtime.position = null;
  runtime.pendingOrder = null;
  runtime.completedRoundTripsToday += 1;
  const exitReason: Exclude<PendingOrder['reason'], 'entry'> = order.reason === 'entry' ? (() => { throw new Error('A buy order cannot settle as an exit.'); })() : order.reason;
  runtime.lastExitReason = exitReason;
  runtime.activeAnchor = null;
  runtime.state = runtime.filledEntriesToday >= V6_MAX_ENTRIES_PER_UTC_DAY ? 'no_signal' : 'waiting_for_anchor';
  runtime.reason = runtime.filledEntriesToday >= V6_MAX_ENTRIES_PER_UTC_DAY
    ? 'Two filled entries already occurred this UTC day.'
    : 'Exit filled at the minute open; waiting for a later eligible anchor.';
}

function failClosed(candidate: V6CandidateDefinition['id'], reason: string): V6CandidateShadowDecision {
  return {
    candidateId: candidate, anchorTime: null, assessmentTime: null, price: null, avwap: null, participationQ: null,
    state: 'data_invalid', reason, execution: noExecution(),
    paperAccount: { initialEquityUsd: V6_INITIAL_EQUITY_USD, currentEquityUsd: V6_INITIAL_EQUITY_USD, cashUsd: V6_INITIAL_EQUITY_USD, btcQuantity: 0, markPrice: null, preBuyEquityUsd: null, intendedAllocationUsd: null },
    filledEntriesToday: 0, completedRoundTripsToday: 0, lastExitReason: null,
  };
}

function isBeforeEntryCutoff(executionOpenTime: number): boolean { return executionOpenTime - utcDayStart(executionOpenTime) < V6_ENTRY_CUTOFF_UTC_HOUR * 60 * MINUTE_MS; }

function candidateDecision(candidate: V6CandidateDefinition, candles: readonly NormalizedOhlcv[], medians: readonly (number | null)[], observedExecutionOpen: ObservedMinuteOpen | null): V6CandidateShadowDecision {
  const runtime = initialRuntime();
  const initialDay = utcDayStart(candles[0].openTime);
  let priorDay = initialDay;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const day = utcDayStart(candle.openTime);
    if (day !== priorDay) {
      // A 23:59 boundary intent is filled at this 00:00 open before daily state resets.
      if (runtime.pendingOrder?.side === 'sell' && runtime.pendingOrder.fillIndex === index) fillPendingOrder(runtime, runtime.pendingOrder, candle.open);
      const boundaryExit = runtime.lastExitReason === 'utc_boundary';
      resetForUtcDay(runtime, boundaryExit ? 'utc_boundary' : null);
      runtime.strategyStarted = true;
      priorDay = day;
    }

    if (!runtime.strategyStarted) {
      runtime.state = 'waiting_for_anchor';
      runtime.reason = 'Initial partial UTC day is warm-up only; strategy actions begin after the first 00:00 UTC boundary.';
      continue;
    }

    if (runtime.pendingOrder?.fillIndex === index) fillPendingOrder(runtime, runtime.pendingOrder, candle.open);

    if (runtime.position !== null) {
      const position = runtime.position;
      // The final completed 23:59 bar always creates a boundary sell intent; it beats every other exit.
      if (isUtcBoundaryOpen(candle.closeTime)) {
        runtime.pendingOrder = { side: 'sell', fillIndex: index + 1, reason: 'utc_boundary' };
        runtime.state = 'exit_ready';
        runtime.reason = 'UTC boundary takes precedence: sell the remaining paper long at the next 00:00 UTC open.';
        continue;
      }
      const metrics = anchorMetrics(candles, position.anchorIndex, index);
      const exitCheckDue = index - position.entryDecisionIndex > 0 && (index - position.entryDecisionIndex) % V6_EXIT_CHECK_MINUTES === 0;
      const maxHoldDue = index === position.entryFillIndex + V6_MAX_HOLD_MINUTES;
      if ((exitCheckDue && candle.close <= metrics.avwap) || maxHoldDue) {
        const reason = maxHoldDue ? '12-hour maximum hold reached.' : 'Completed close is at or below the anchor AVWAP on a 30-minute check.';
        runtime.pendingOrder = { side: 'sell', fillIndex: index + 1, reason: maxHoldDue ? 'max_hold_12h' : 'avwap_loss' };
        runtime.state = 'exit_ready';
        runtime.reason = reason;
      } else {
        runtime.state = 'long';
        runtime.reason = 'Paper long remains open; only 30-minute AVWAP-loss checks, 12-hour maximum hold, or UTC boundary may exit.';
      }
      continue;
    }

    if (runtime.pendingOrder !== null || runtime.terminalNoSignal || runtime.filledEntriesToday >= V6_MAX_ENTRIES_PER_UTC_DAY) {
      if (runtime.filledEntriesToday >= V6_MAX_ENTRIES_PER_UTC_DAY) {
        runtime.state = 'no_signal';
        runtime.reason = 'Two filled entries already occurred this UTC day.';
      }
      continue;
    }

    if (runtime.activeAnchor === null) {
      const baseline = medians[index];
      if (baseline === null) {
        runtime.state = 'insufficient_history';
        runtime.reason = 'Requires 1,440 contiguous completed predecessor minutes for the volume median.';
      } else if (candle.volume >= candidate.anchorVolumeMultiplier * baseline) {
        runtime.activeAnchor = { index, openTime: candle.openTime };
        runtime.state = 'waiting_for_assessment';
        runtime.reason = 'Relative-volume anchor completed; its single 60-minute assessment is pending.';
      } else {
        runtime.state = 'waiting_for_anchor';
        runtime.reason = 'No eligible relative-volume anchor has completed.';
      }
      continue;
    }

    const age = index - runtime.activeAnchor.index;
    if (age < V6_ASSESSMENT_MINUTES) {
      runtime.state = 'waiting_for_assessment';
      runtime.reason = `Anchor assessment is due after exactly ${V6_ASSESSMENT_MINUTES} completed minutes.`;
      continue;
    }
    if (age !== V6_ASSESSMENT_MINUTES) throw new Error('Active v6 anchor missed its mandatory single assessment.');
    const metrics = anchorMetrics(candles, runtime.activeAnchor.index, index);
    const executionOpenTime = candle.openTime + MINUTE_MS;
    const passed = candle.close > metrics.avwap && metrics.participationQ >= 1;
    if (passed && isBeforeEntryCutoff(executionOpenTime)) {
      runtime.pendingOrder = { side: 'buy', fillIndex: index + 1, reason: 'entry' };
      runtime.state = 'entry_ready';
      runtime.reason = 'The single completed 60-minute AVWAP acceptance and participation assessment passed; execution is next-minute-open only.';
    } else {
      runtime.activeAnchor = null;
      if (passed) {
        runtime.terminalNoSignal = true;
        runtime.state = 'no_signal';
        runtime.reason = 'A passed assessment is cutoff-precluded because its next-minute open is at or after 12:00 UTC.';
      } else {
        runtime.state = 'waiting_for_anchor';
        runtime.reason = 'The single 60-minute assessment failed AVWAP acceptance or participation; waiting for a later anchor.';
      }
    }
  }

  const latest = candles.at(-1)!;
  // A currently forming next minute may contribute only its observed open. It can settle the pending fill without admitting its H/L/C/V.
  if (runtime.pendingOrder !== null && observedExecutionOpen !== null && observedExecutionOpen.openTime === latest.closeTime) {
    const order = runtime.pendingOrder;
    fillPendingOrder(runtime, order, observedExecutionOpen.open);
    if (order.reason === 'utc_boundary') {
      resetForUtcDay(runtime, 'utc_boundary');
      runtime.strategyStarted = true;
    }
  }

  const activeAnchorIndex = runtime.position?.anchorIndex ?? runtime.activeAnchor?.index ?? null;
  const metrics = activeAnchorIndex === null ? null : anchorMetrics(candles, activeAnchorIndex, candles.length - 1);
  const assessmentTime = runtime.activeAnchor === null ? null : runtime.activeAnchor.openTime + V6_ASSESSMENT_MINUTES * MINUTE_MS;
  const execution = runtime.pendingOrder === null ? noExecution() : executionFor(runtime.pendingOrder.side === 'buy' ? 'BUY_AT_NEXT_OPEN' : 'SELL_AT_NEXT_OPEN', latest.closeTime, observedExecutionOpen);
  const markPrice = runtime.position !== null && observedExecutionOpen !== null && observedExecutionOpen.openTime === latest.closeTime ? observedExecutionOpen.open : latest.close;
  const pendingBuyPreEquityUsd = runtime.pendingOrder?.side === 'buy' ? accountEquity(runtime.account, latest.close) : null;
  const displayedPreBuyEquityUsd = pendingBuyPreEquityUsd ?? runtime.account.preBuyEquityUsd;
  const displayedAllocationUsd = pendingBuyPreEquityUsd === null ? runtime.account.intendedAllocationUsd : pendingBuyPreEquityUsd * V6_ALLOCATION_FRACTION;

  return {
    candidateId: candidate.id,
    anchorTime: activeAnchorIndex === null ? null : candles[activeAnchorIndex].openTime,
    assessmentTime,
    price: latest.close,
    avwap: metrics?.avwap ?? null,
    participationQ: metrics?.participationQ ?? null,
    state: runtime.state,
    reason: runtime.reason,
    execution,
    paperAccount: {
      initialEquityUsd: V6_INITIAL_EQUITY_USD,
      currentEquityUsd: accountEquity(runtime.account, markPrice),
      cashUsd: runtime.account.cashUsd,
      btcQuantity: runtime.account.btcQuantity,
      markPrice,
      preBuyEquityUsd: displayedPreBuyEquityUsd,
      intendedAllocationUsd: displayedAllocationUsd,
    },
    filledEntriesToday: runtime.filledEntriesToday,
    completedRoundTripsToday: runtime.completedRoundTripsToday,
    lastExitReason: runtime.lastExitReason,
  };
}

/** Pure causal evaluator for the frozen v6 family. */
export function evaluateV6ShadowDecisions(input: V6ShadowDecisionInput): V6ShadowDecisionResult {
  const registry = input.registry ?? V6_CANDIDATE_REGISTRY;
  try {
    validateV6CandidateRegistry(registry);
    if (!Number.isInteger(input.asOf) || input.asOf <= 0) throw new Error('asOf must be a positive integer UTC millisecond timestamp.');
    if (!Array.isArray(input.candles) || input.candles.length === 0) throw new Error('Completed v6 candle history is required.');
    validateCompleteOhlcv(input.candles, '1m');
    if (input.candles.some((candle) => candle.closeTime > input.asOf)) throw new Error('v6 rejects candles not completed as of the evaluation timestamp.');
    if (input.observedExecutionOpen !== null && (!Number.isInteger(input.observedExecutionOpen.openTime) || !Number.isFinite(input.observedExecutionOpen.open) || input.observedExecutionOpen.open <= 0 || input.observedExecutionOpen.openTime > input.asOf)) throw new Error('Observed next-minute open is malformed or unavailable as of evaluation.');
    const medians = precomputeTrailingVolumeMedians(input.candles);
    return { modelStatus: 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY', asOf: input.asOf, candidates: registry.map((candidate) => candidateDecision(candidate, input.candles, medians, input.observedExecutionOpen)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'v6 data validation failed.';
    return { modelStatus: 'EXPERIMENTAL / UNVALIDATED / PAPER ONLY', asOf: input.asOf, candidates: EXPECTED_CANDIDATES.map((candidate) => failClosed(candidate.id, reason)) };
  }
}
