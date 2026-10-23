import { assertFillMonetaryIntegrity, assertResearchFillIssuedBy, type CostScenarioRegistry, MONEY_TOLERANCE_USD } from './cost-model';
import { MINUTE_MS, type ResearchFill, type ResearchTrade } from './types';

export type Sleeve = 'genuine' | 'qualification_overlay';
export type SleeveBalance = {
  cashUsd: number;
  inventoryBtc: number;
};
export type LedgerReconciliation = {
  genuine: SleeveBalance;
  qualificationOverlay: SleeveBalance;
  fillCount: number;
  tradeCount: number;
};

function round(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 1e8) / 1e8;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundBtc(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 1e12) / 1e12;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`);
}

function assertFiniteNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
}

function assertTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer millisecond timestamp.`);
}

function assertSleeve(value: unknown): asserts value is Sleeve {
  if (value !== 'genuine' && value !== 'qualification_overlay') throw new Error('Ledger fills must use a genuine or qualification_overlay sleeve.');
}

/** Validates every attribution and economic field before it can change a sleeve balance. */
export function validateResearchFill(fill: unknown): asserts fill is ResearchFill {
  if (fill === null || typeof fill !== 'object' || Array.isArray(fill)) throw new Error('Research fill must be an object.');
  const record = fill as ResearchFill;
  assertString(record.id, 'Fill id');
  assertString(record.candidateId, 'Candidate id');
  assertString(record.windowId, 'Window id');
  if (record.foldId !== null) assertString(record.foldId, 'Fold id');
  assertString(record.scenarioId, 'Scenario id');
  assertString(record.scenarioVersion, 'Scenario version');
  assertSleeve(record.sleeve);
  assertString(record.reason, 'Fill reason');
  if (typeof record.forcedBoundaryExit !== 'boolean') throw new Error('Fill forced-boundary flag is required.');
  if (record.side !== 'buy' && record.side !== 'sell') throw new Error('Fill side must be buy or sell.');
  assertTimestamp(record.featureAvailableThrough, 'Feature cutoff');
  assertTimestamp(record.decisionTime, 'Decision time');
  assertTimestamp(record.fillTime, 'Fill time');
  if (record.featureAvailableThrough > record.decisionTime || record.decisionTime > record.fillTime) throw new Error('Feature cutoff, decision, and fill timestamps must be chronological.');
  for (const [label, value] of Object.entries({
    referencePrice: record.referencePrice,
    executionPrice: record.executionPrice,
    quantityBtc: record.quantityBtc,
    grossNotionalUsd: record.grossNotionalUsd,
    feeUsd: record.feeUsd,
    totalDebitUsd: record.totalDebitUsd,
    netCreditUsd: record.netCreditUsd,
    spreadCostUsd: record.spreadCostUsd,
    slippageCostUsd: record.slippageCostUsd,
  })) assertFiniteNonNegative(value, label);
  if (record.referencePrice <= 0 || record.executionPrice <= 0 || record.quantityBtc <= 0 || record.grossNotionalUsd <= 0) throw new Error('Fill price, quantity, and gross notional must be positive.');
  assertFillMonetaryIntegrity(record);
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= MONEY_TOLERANCE_USD;
}

function assertTradeFields(trade: unknown): asserts trade is ResearchTrade {
  if (trade === null || typeof trade !== 'object' || Array.isArray(trade)) throw new Error('Research trade must be an object.');
  const record = trade as ResearchTrade;
  assertString(record.id, 'Trade id');
  assertString(record.candidateId, 'Trade candidate id');
  assertString(record.windowId, 'Trade window id');
  if (record.foldId !== null) assertString(record.foldId, 'Trade fold id');
  assertString(record.scenarioId, 'Trade scenario id');
  assertSleeve(record.sleeve);
  assertString(record.exitReason, 'Exit reason');
  if (typeof record.forcedBoundaryExit !== 'boolean' || !Number.isInteger(record.holdMinutes) || record.holdMinutes < 0) throw new Error('Trade forced-boundary flag and non-negative integer hold minutes are required.');
  assertFiniteNonNegative(record.quantityBtc, 'Trade quantity');
  if (record.quantityBtc <= 0 || !Number.isFinite(record.grossPnlUsd) || !Number.isFinite(record.netPnlUsd)) throw new Error('Trade quantity must be positive and P&L values finite.');
  validateResearchFill(record.entryFill);
  validateResearchFill(record.exitFill);
}

function applyFill(balance: SleeveBalance, fill: ResearchFill): SleeveBalance {
  if (fill.side === 'buy') return { cashUsd: round(balance.cashUsd - fill.totalDebitUsd), inventoryBtc: roundBtc(balance.inventoryBtc + fill.quantityBtc) };
  if (balance.inventoryBtc + MONEY_TOLERANCE_USD < fill.quantityBtc) throw new Error(`Sell fill ${fill.id} exceeds ${fill.sleeve} inventory.`);
  return { cashUsd: round(balance.cashUsd + fill.netCreditUsd), inventoryBtc: roundBtc(balance.inventoryBtc - fill.quantityBtc) };
}

function emptyBalances(opening: { genuineCashUsd: number; qualificationOverlayCashUsd: number }): Record<Sleeve, SleeveBalance> {
  return {
    genuine: { cashUsd: opening.genuineCashUsd, inventoryBtc: 0 },
    qualification_overlay: { cashUsd: opening.qualificationOverlayCashUsd, inventoryBtc: 0 },
  };
}

/** Append-only, sleeve-separated ledger. Overlay balances can never fund genuine fills or vice versa. */
export class ResearchLedger {
  readonly #opening: Readonly<{ genuineCashUsd: number; qualificationOverlayCashUsd: number }>;
  readonly #registry: CostScenarioRegistry;
  readonly #fills: ResearchFill[] = [];
  readonly #trades: ResearchTrade[] = [];
  readonly #tradedFillIds = new Set<string>();
  #balances: Record<Sleeve, SleeveBalance>;

  constructor(opening: { genuineCashUsd: number; qualificationOverlayCashUsd: number }, registry: CostScenarioRegistry) {
    assertFiniteNonNegative(opening.genuineCashUsd, 'Opening genuine cash');
    assertFiniteNonNegative(opening.qualificationOverlayCashUsd, 'Opening qualification overlay cash');
    this.#opening = Object.freeze({ ...opening });
    this.#registry = registry;
    this.#balances = emptyBalances(this.#opening);
  }

  appendFill(fill: ResearchFill): void {
    assertResearchFillIssuedBy(fill, this.#registry);
    validateResearchFill(fill);
    if (this.#fills.some((entry) => entry.id === fill.id)) throw new Error(`Duplicate ledger fill id: ${fill.id}.`);
    const next = applyFill(this.#balances[fill.sleeve], fill);
    if (next.cashUsd < -MONEY_TOLERANCE_USD) throw new Error(`Fill ${fill.id} overdraws ${fill.sleeve} cash.`);
    this.#balances = { ...this.#balances, [fill.sleeve]: next };
    this.#fills.push(fill);
  }

  appendTrade(trade: ResearchTrade): void {
    assertTradeFields(trade);
    if (this.#trades.some((entry) => entry.id === trade.id)) throw new Error(`Duplicate ledger trade id: ${trade.id}.`);
    const entry = this.#fills.find((fill) => fill.id === trade.entryFill.id);
    const exit = this.#fills.find((fill) => fill.id === trade.exitFill.id);
    if (entry === undefined || exit === undefined || entry !== trade.entryFill || exit !== trade.exitFill) throw new Error('Trades must reference the exact immutable fills already appended to this ledger.');
    if (this.#tradedFillIds.has(entry.id) || this.#tradedFillIds.has(exit.id)) throw new Error('Each entry and exit fill can belong to only one ledger trade.');
    if (entry.side !== 'buy' || exit.side !== 'sell' || entry.candidateId !== trade.candidateId || exit.candidateId !== trade.candidateId
      || entry.windowId !== trade.windowId || exit.windowId !== trade.windowId || entry.foldId !== trade.foldId || exit.foldId !== trade.foldId
      || entry.scenarioId !== trade.scenarioId || exit.scenarioId !== trade.scenarioId || entry.sleeve !== trade.sleeve || exit.sleeve !== trade.sleeve
      || !sameNumber(entry.quantityBtc, exit.quantityBtc) || !sameNumber(trade.quantityBtc, entry.quantityBtc)
      || exit.forcedBoundaryExit !== trade.forcedBoundaryExit || trade.exitReason !== exit.reason) {
      throw new Error('Trade attribution must exactly reconcile its appended entry and exit fills.');
    }
    const expectedHoldMinutes = (exit.fillTime - entry.fillTime) / MINUTE_MS;
    const expectedGrossPnlUsd = round(exit.grossNotionalUsd - entry.grossNotionalUsd);
    const expectedNetPnlUsd = round(expectedGrossPnlUsd - entry.feeUsd - exit.feeUsd);
    if (expectedHoldMinutes !== trade.holdMinutes || !sameNumber(trade.grossPnlUsd, expectedGrossPnlUsd) || !sameNumber(trade.netPnlUsd, expectedNetPnlUsd)) {
      throw new Error('Trade hold duration or P&L does not reconcile to its fills.');
    }
    this.#trades.push(Object.freeze({
      ...trade,
      entryFill: Object.freeze({ ...trade.entryFill }),
      exitFill: Object.freeze({ ...trade.exitFill }),
    }));
    this.#tradedFillIds.add(entry.id);
    this.#tradedFillIds.add(exit.id);
  }

  fills(): readonly ResearchFill[] {
    return Object.freeze(this.#fills.map((fill) => Object.freeze({ ...fill })));
  }

  trades(): readonly ResearchTrade[] {
    return Object.freeze(this.#trades.map((trade) => Object.freeze({
      ...trade,
      entryFill: Object.freeze({ ...trade.entryFill }),
      exitFill: Object.freeze({ ...trade.exitFill }),
    })));
  }

  reconcile(): LedgerReconciliation {
    const balances = emptyBalances(this.#opening);
    for (const fill of this.#fills) balances[fill.sleeve] = applyFill(balances[fill.sleeve], fill);
    for (const sleeve of ['genuine', 'qualification_overlay'] as const) {
      const actual = this.#balances[sleeve];
      const expected = balances[sleeve];
      if (!sameNumber(actual.cashUsd, expected.cashUsd) || !sameNumber(actual.inventoryBtc, expected.inventoryBtc)) throw new Error(`Ledger ${sleeve} balance does not reconcile.`);
    }
    return Object.freeze({
      genuine: Object.freeze({ ...balances.genuine }),
      qualificationOverlay: Object.freeze({ ...balances.qualification_overlay }),
      fillCount: this.#fills.length,
      tradeCount: this.#trades.length,
    });
  }
}

export function createResearchLedger(opening: { genuineCashUsd: number; qualificationOverlayCashUsd: number }, registry: CostScenarioRegistry): ResearchLedger {
  return new ResearchLedger(opening, registry);
}