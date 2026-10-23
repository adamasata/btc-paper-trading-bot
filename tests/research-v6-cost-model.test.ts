import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adverseCostScenario,
  assertFillMonetaryIntegrity,
  baseCostScenario,
  CostScenarioRegistry,
  createCostScenarioRegistry,
  executeLongBuy,
  executeLongSell,
  MONEY_TOLERANCE_USD,
  totalFillFeesUsd,
} from '../src/research/v6/cost-model';

const baseDefinition = baseCostScenario({ id: 'base', version: 'v1', feeRate: 0.001, spreadBps: 10, adverseSlippageBps: 0 });
const adverseDefinition = adverseCostScenario({ id: 'adverse', version: 'v1', feeRate: 0.0015, spreadBps: 20, adverseSlippageBps: 15 });
const registry = createCostScenarioRegistry([baseDefinition, adverseDefinition]);
const base = registry.get('base');
const adverse = registry.get('adverse');

test('long buy and sell fills reconcile quantity, spread, slippage, and fees independently', () => {
  const buy = executeLongBuy({ scenario: adverse, referencePrice: 100, cashAvailableUsd: 1000, cashToSpendUsd: 500 });
  const sell = executeLongSell({ scenario: adverse, referencePrice: 110, quantityBtc: buy.quantityBtc });
  assert.ok(buy.totalDebitUsd <= 500);
  assert.ok(Math.abs(buy.totalDebitUsd - buy.grossNotionalUsd - buy.feeUsd) <= MONEY_TOLERANCE_USD);
  assert.ok(buy.executionPrice > 100);
  assert.ok(sell.executionPrice < 110);
  assert.ok(Math.abs(buy.feeUsd - Math.round(buy.grossNotionalUsd * adverse.feeRate * 1e8) / 1e8) < 1e-12);
  assert.ok(Math.abs(totalFillFeesUsd([buy, sell]) - buy.feeUsd - sell.feeUsd) < 1e-8);
  assert.doesNotThrow(() => assertFillMonetaryIntegrity(buy));
  assert.throws(() => assertFillMonetaryIntegrity({ ...buy, totalDebitUsd: buy.totalDebitUsd + 0.01 }));
});

test('scenario-set validation prevents economically favorable adverse labels and forged fill scenarios', () => {
  assert.throws(() => createCostScenarioRegistry([
    baseDefinition,
    adverseCostScenario({ id: 'bad', version: 'v1', feeRate: 0.0005, spreadBps: 20, adverseSlippageBps: 15 }),
  ]));
  assert.throws(() => createCostScenarioRegistry([
    baseDefinition,
    adverseCostScenario({ id: 'equal', version: 'v1', feeRate: 0.001, spreadBps: 10, adverseSlippageBps: 0 }),
  ]));
  assert.throws(() => createCostScenarioRegistry([baseDefinition, { ...baseDefinition, id: 'base-2' }]));
  assert.throws(() => CostScenarioRegistry.issueValidated([baseDefinition], Symbol('forged')));
  const forged = { ...adverse };
  assert.throws(() => executeLongBuy({ scenario: forged, referencePrice: 100, cashAvailableUsd: 100, cashToSpendUsd: 100 }));
  assert.throws(() => executeLongSell({ scenario: forged, referencePrice: 100, quantityBtc: 1 }));
});

test('adverse scenario never improves long buy or sell execution versus base', () => {
  const baseBuy = executeLongBuy({ scenario: base, referencePrice: 100, cashAvailableUsd: 1000, cashToSpendUsd: 500 });
  const adverseBuy = executeLongBuy({ scenario: adverse, referencePrice: 100, cashAvailableUsd: 1000, cashToSpendUsd: 500 });
  const baseSell = executeLongSell({ scenario: base, referencePrice: 100, quantityBtc: 2 });
  const adverseSell = executeLongSell({ scenario: adverse, referencePrice: 100, quantityBtc: 2 });
  assert.ok(adverseBuy.executionPrice >= baseBuy.executionPrice);
  assert.ok(adverseBuy.quantityBtc <= baseBuy.quantityBtc);
  assert.ok(adverseSell.executionPrice <= baseSell.executionPrice);
  assert.ok(adverseSell.netCreditUsd <= baseSell.netCreditUsd);
  assert.throws(() => executeLongBuy({ scenario: base, referencePrice: 100, cashAvailableUsd: 99.99, cashToSpendUsd: 100 }));
});