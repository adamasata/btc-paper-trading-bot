import type { CostScenario, LongFill, ResearchFill } from './types';

export const USD_ROUNDING_DECIMALS = 8;
export const MONEY_TOLERANCE_USD = 1 / 10 ** USD_ROUNDING_DECIMALS;
const BTC_QUANTITY_DECIMALS = 12;

export type CostScenarioInput = CostScenario;
export type RegisteredCostScenario = Readonly<CostScenario>;

const scenarioRegistryByIdentity = new WeakMap<object, CostScenarioRegistry>();
const executedFillRegistryByIdentity = new WeakMap<object, CostScenarioRegistry>();
const researchFillRegistryByIdentity = new WeakMap<object, CostScenarioRegistry>();
const registryIssuer = Symbol('validated-cost-scenario-registry');

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 10 ** USD_ROUNDING_DECIMALS) / 10 ** USD_ROUNDING_DECIMALS;
}

function roundDownBtc(value: number): number {
  return Math.floor((value + Number.EPSILON) * 10 ** BTC_QUANTITY_DECIMALS) / 10 ** BTC_QUANTITY_DECIMALS;
}

function assertScenarioShape(input: unknown): asserts input is CostScenario {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cost scenario must be an object.');
  const scenario = input as CostScenario;
  if ((scenario.classification !== 'base' && scenario.classification !== 'adverse')
    || typeof scenario.id !== 'string' || scenario.id.trim() === ''
    || typeof scenario.version !== 'string' || scenario.version.trim() === ''
    || !Number.isFinite(scenario.feeRate) || scenario.feeRate < 0 || scenario.feeRate >= 1
    || !Number.isFinite(scenario.spreadBps) || scenario.spreadBps < 0
    || !Number.isFinite(scenario.adverseSlippageBps) || scenario.adverseSlippageBps < 0) {
    throw new Error('Cost scenario has an invalid schema or economic component.');
  }
}

/** A validated registry is the sole issuer of scenario objects accepted by fill execution. */
export class CostScenarioRegistry {
  readonly #byId: ReadonlyMap<string, RegisteredCostScenario>;

  static issueValidated(scenarios: readonly CostScenario[], issuer: symbol): CostScenarioRegistry {
    if (issuer !== registryIssuer) throw new Error('Cost scenario registries must be created through validation.');
    return new CostScenarioRegistry(scenarios);
  }

  private constructor(scenarios: readonly CostScenario[]) {
    const byId = new Map<string, RegisteredCostScenario>();
    for (const input of scenarios) {
      const scenario = Object.freeze({ ...input });
      byId.set(scenario.id, scenario);
      scenarioRegistryByIdentity.set(scenario, this);
    }
    this.#byId = byId;
    Object.freeze(this);
  }

  get(id: string): RegisteredCostScenario {
    const scenario = this.#byId.get(id);
    if (scenario === undefined) throw new Error(`Cost scenario is not registered: ${id}.`);
    return scenario;
  }

  toArtifact(): readonly CostScenario[] {
    return Object.freeze([...this.#byId.values()].map((scenario) => Object.freeze({ ...scenario })));
  }

  has(scenario: unknown): scenario is RegisteredCostScenario {
    return typeof scenario === 'object' && scenario !== null && scenarioRegistryByIdentity.get(scenario) === this;
  }
}

/** Validates scenario-set economics: one base and each adverse component never improves it. */
export function createCostScenarioRegistry(inputs: readonly CostScenarioInput[]): CostScenarioRegistry {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Cost scenario registry cannot be empty.');
  const ids = new Set<string>();
  let base: CostScenario | undefined;
  const adverse: CostScenario[] = [];
  for (const input of inputs) {
    assertScenarioShape(input);
    if (ids.has(input.id)) throw new Error(`Duplicate cost scenario id: ${input.id}.`);
    ids.add(input.id);
    if (input.classification === 'base') {
      if (base !== undefined) throw new Error('Cost scenario registry requires exactly one base scenario.');
      base = input;
    } else {
      adverse.push(input);
    }
  }
  if (base === undefined) throw new Error('Cost scenario registry requires exactly one base scenario.');
  for (const scenario of adverse) {
    const neverBetter = scenario.feeRate >= base.feeRate
      && scenario.spreadBps >= base.spreadBps
      && scenario.adverseSlippageBps >= base.adverseSlippageBps;
    const strictlyWorse = scenario.feeRate > base.feeRate
      || scenario.spreadBps > base.spreadBps
      || scenario.adverseSlippageBps > base.adverseSlippageBps;
    if (!neverBetter || !strictlyWorse) throw new Error(`Adverse scenario ${scenario.id} must be component-wise no better than base and strictly worse in at least one component.`);
  }
  return CostScenarioRegistry.issueValidated(inputs, registryIssuer);
}

/** Convenience constructors produce schema-valid definitions; registry enrollment is still mandatory. */
export function baseCostScenario(input: Omit<CostScenarioInput, 'classification'>): CostScenario {
  const scenario = { ...input, classification: 'base' as const };
  assertScenarioShape(scenario);
  return scenario;
}

export function adverseCostScenario(input: Omit<CostScenarioInput, 'classification'>): CostScenario {
  const scenario = { ...input, classification: 'adverse' as const };
  assertScenarioShape(scenario);
  return scenario;
}

function assertRegisteredScenario(scenario: unknown): asserts scenario is RegisteredCostScenario {
  if (scenario === null || typeof scenario !== 'object' || scenarioRegistryByIdentity.get(scenario) === undefined) {
    throw new Error('Fill execution requires a scenario issued by a validated cost scenario registry.');
  }
}

function executionComponents(referencePrice: number, scenario: RegisteredCostScenario): { halfSpreadUsd: number; slippageUsd: number } {
  assertPositiveFinite(referencePrice, 'Reference price');
  return {
    halfSpreadUsd: referencePrice * scenario.spreadBps / 20_000,
    slippageUsd: referencePrice * scenario.adverseSlippageBps / 10_000,
  };
}

function assertMoneyWithinTolerance(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > MONEY_TOLERANCE_USD) throw new Error(`${label} exceeds deterministic USD rounding tolerance.`);
}

/** Checks the documented eight-decimal USD debit/credit policy used by the ledger. */
export function assertFillMonetaryIntegrity(fill: Pick<LongFill, 'side' | 'grossNotionalUsd' | 'feeUsd' | 'totalDebitUsd' | 'netCreditUsd'>): void {
  if (fill.side === 'buy') {
    assertMoneyWithinTolerance(fill.totalDebitUsd, roundUsd(fill.grossNotionalUsd + fill.feeUsd), 'Buy total debit');
    assertMoneyWithinTolerance(fill.netCreditUsd, 0, 'Buy net credit');
  } else {
    assertMoneyWithinTolerance(fill.totalDebitUsd, 0, 'Sell total debit');
    assertMoneyWithinTolerance(fill.netCreditUsd, roundUsd(fill.grossNotionalUsd - fill.feeUsd), 'Sell net credit');
  }
}

export type BuyRequest = {
  scenario: RegisteredCostScenario;
  referencePrice: number;
  cashAvailableUsd: number;
  cashToSpendUsd: number;
};

export type SellRequest = {
  scenario: RegisteredCostScenario;
  referencePrice: number;
  quantityBtc: number;
};

/** Buy quantity is rounded down deterministically so debit is calculated, not copied from budget. */
export function executeLongBuy(request: BuyRequest): LongFill {
  const { referencePrice, cashAvailableUsd, cashToSpendUsd, scenario } = request;
  assertRegisteredScenario(scenario);
  assertPositiveFinite(cashAvailableUsd, 'Available cash');
  assertPositiveFinite(cashToSpendUsd, 'Cash to spend');
  if (cashToSpendUsd > cashAvailableUsd + MONEY_TOLERANCE_USD) throw new Error('Long buy exceeds available sleeve cash.');
  const { halfSpreadUsd, slippageUsd } = executionComponents(referencePrice, scenario);
  const executionPrice = referencePrice + halfSpreadUsd + slippageUsd;
  const quantityBtc = roundDownBtc(cashToSpendUsd / (executionPrice * (1 + scenario.feeRate)));
  if (quantityBtc <= 0) throw new Error('Cash budget is too small after deterministic quantity rounding.');
  const grossNotionalUsd = roundUsd(quantityBtc * executionPrice);
  const feeUsd = roundUsd(grossNotionalUsd * scenario.feeRate);
  const totalDebitUsd = roundUsd(grossNotionalUsd + feeUsd);
  if (totalDebitUsd > cashToSpendUsd + MONEY_TOLERANCE_USD || totalDebitUsd > cashAvailableUsd + MONEY_TOLERANCE_USD) throw new Error('Rounded buy debit exceeds the available sleeve cash.');
  const fill: LongFill = Object.freeze({
    side: 'buy', scenarioId: scenario.id, scenarioVersion: scenario.version, referencePrice, executionPrice, quantityBtc,
    grossNotionalUsd, feeUsd, totalDebitUsd, netCreditUsd: 0,
    spreadCostUsd: roundUsd(quantityBtc * halfSpreadUsd), slippageCostUsd: roundUsd(quantityBtc * slippageUsd),
  });
  assertFillMonetaryIntegrity(fill);
  executedFillRegistryByIdentity.set(fill, scenarioRegistryByIdentity.get(scenario) as CostScenarioRegistry);
  return fill;
}

export function executeLongSell(request: SellRequest): LongFill {
  const { referencePrice, quantityBtc, scenario } = request;
  assertRegisteredScenario(scenario);
  assertPositiveFinite(quantityBtc, 'Sell quantity');
  const { halfSpreadUsd, slippageUsd } = executionComponents(referencePrice, scenario);
  const executionPrice = referencePrice - halfSpreadUsd - slippageUsd;
  if (executionPrice <= 0) throw new Error('Costs make long sell execution price non-positive.');
  const grossNotionalUsd = roundUsd(quantityBtc * executionPrice);
  const feeUsd = roundUsd(grossNotionalUsd * scenario.feeRate);
  const fill: LongFill = Object.freeze({
    side: 'sell', scenarioId: scenario.id, scenarioVersion: scenario.version, referencePrice, executionPrice, quantityBtc,
    grossNotionalUsd, feeUsd, totalDebitUsd: 0, netCreditUsd: roundUsd(grossNotionalUsd - feeUsd),
    spreadCostUsd: roundUsd(quantityBtc * halfSpreadUsd), slippageCostUsd: roundUsd(quantityBtc * slippageUsd),
  });
  assertFillMonetaryIntegrity(fill);
  executedFillRegistryByIdentity.set(fill, scenarioRegistryByIdentity.get(scenario) as CostScenarioRegistry);
  return fill;
}

export type ResearchFillAttribution = Omit<ResearchFill, keyof LongFill>;

/** Converts an immutable, registry-issued execution into an immutable attributed research fill. */
export function attributeResearchFill(fill: LongFill, attribution: ResearchFillAttribution): ResearchFill {
  const registry = executedFillRegistryByIdentity.get(fill);
  if (registry === undefined) throw new Error('Research fill attribution requires an execution issued by a validated cost scenario registry.');
  const researchFill: ResearchFill = Object.freeze({ ...attribution, ...fill });
  researchFillRegistryByIdentity.set(researchFill, registry);
  return researchFill;
}

/** Ledger gate: a fill must be the original attributed execution from this exact validated registry. */
export function assertResearchFillIssuedBy(fill: unknown, registry: CostScenarioRegistry): asserts fill is ResearchFill {
  if (fill === null || typeof fill !== 'object' || researchFillRegistryByIdentity.get(fill) !== registry) {
    throw new Error('Ledger accepts only immutable research fills attributed from this validated scenario registry.');
  }
}

export function totalFillFeesUsd(fills: readonly Pick<LongFill, 'feeUsd'>[]): number {
  return roundUsd(fills.reduce((total, fill) => total + fill.feeUsd, 0));
}