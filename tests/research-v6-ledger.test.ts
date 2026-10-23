import assert from 'node:assert/strict';
import test from 'node:test';
import { adverseCostScenario, attributeResearchFill, baseCostScenario, createCostScenarioRegistry, executeLongBuy, executeLongSell } from '../src/research/v6/cost-model';
import { createResearchLedger } from '../src/research/v6/ledger';
import type { ResearchFill, ResearchTrade } from '../src/research/v6/types';

const start = Date.UTC(2026, 0, 1);
const registry = createCostScenarioRegistry([
  baseCostScenario({ id: 'base', version: 'v1', feeRate: 0.001, spreadBps: 5, adverseSlippageBps: 0 }),
  adverseCostScenario({ id: 'adverse', version: 'v1', feeRate: 0.002, spreadBps: 10, adverseSlippageBps: 5 }),
]);
const scenario = registry.get('adverse');

function attributed(id: string, fill: ReturnType<typeof executeLongBuy> | ReturnType<typeof executeLongSell>, sleeve: ResearchFill['sleeve'], fillTime: number, reason: string, forcedBoundaryExit = false): ResearchFill {
  return attributeResearchFill(fill, {
    id,
    candidateId: 'candidate-a',
    windowId: 'primary:window-a',
    foldId: 'fold-01',
    featureAvailableThrough: fillTime - 2 * 60_000,
    decisionTime: fillTime - 60_000,
    fillTime,
    sleeve,
    reason,
    forcedBoundaryExit,
  });
}

test('appendable ledger reconciles cash/inventory independently for genuine and overlay sleeves', () => {
  const ledger = createResearchLedger({ genuineCashUsd: 1_000, qualificationOverlayCashUsd: 100 }, registry);
  const genuineBuy = attributed('genuine-buy', executeLongBuy({ scenario, referencePrice: 100, cashAvailableUsd: 1_000, cashToSpendUsd: 200 }), 'genuine', start, 'entry');
  const genuineSell = attributed('genuine-sell', executeLongSell({ scenario, referencePrice: 110, quantityBtc: genuineBuy.quantityBtc }), 'genuine', start + 60 * 60_000, 'time-exit', true);
  const overlayBuy = attributed('overlay-buy', executeLongBuy({ scenario, referencePrice: 100, cashAvailableUsd: 100, cashToSpendUsd: 50 }), 'qualification_overlay', start, 'overlay-entry');
  ledger.appendFill(genuineBuy);
  ledger.appendFill(genuineSell);
  ledger.appendFill(overlayBuy);
  const trade: ResearchTrade = {
    id: 'trade-1', candidateId: 'candidate-a', windowId: 'primary:window-a', foldId: 'fold-01', scenarioId: 'adverse', sleeve: 'genuine',
    entryFill: genuineBuy, exitFill: genuineSell, quantityBtc: genuineBuy.quantityBtc,
    grossPnlUsd: Math.round((genuineSell.grossNotionalUsd - genuineBuy.grossNotionalUsd) * 1e8) / 1e8,
    netPnlUsd: Math.round((genuineSell.grossNotionalUsd - genuineBuy.grossNotionalUsd - genuineBuy.feeUsd - genuineSell.feeUsd) * 1e8) / 1e8,
    holdMinutes: 60, exitReason: 'time-exit', forcedBoundaryExit: true,
  };
  ledger.appendTrade(trade);
  const reconciliation = ledger.reconcile();
  assert.equal(reconciliation.fillCount, 3);
  assert.equal(reconciliation.tradeCount, 1);
  assert.equal(reconciliation.genuine.inventoryBtc, 0);
  assert.equal(reconciliation.qualificationOverlay.inventoryBtc, overlayBuy.quantityBtc);
  assert.ok(reconciliation.genuine.cashUsd > 1_000);
  assert.ok(reconciliation.qualificationOverlay.cashUsd < 100);
});

test('ledger rejects missing attribution, duplicate IDs, sleeve cross-funding, unrecorded trades, and forged trade reconciliation', () => {
  const ledger = createResearchLedger({ genuineCashUsd: 100, qualificationOverlayCashUsd: 1_000 }, registry);
  const tooLargeGenuine = attributed('too-large', executeLongBuy({ scenario, referencePrice: 100, cashAvailableUsd: 200, cashToSpendUsd: 200 }), 'genuine', start, 'entry');
  assert.throws(() => ledger.appendFill(tooLargeGenuine));
  const valid = attributed('valid', executeLongBuy({ scenario, referencePrice: 100, cashAvailableUsd: 100, cashToSpendUsd: 50 }), 'genuine', start, 'entry');
  assert.throws(() => ledger.appendFill({ ...valid, forcedBoundaryExit: undefined } as unknown as ResearchFill));
  const attributionAttempt = attributeResearchFill(executeLongBuy({ scenario, referencePrice: 100, cashAvailableUsd: 100, cashToSpendUsd: 10 }), { id: 'forged-attribution', candidateId: 'candidate-a', windowId: 'window', foldId: null, featureAvailableThrough: start, decisionTime: start, fillTime: start, sleeve: 'genuine', reason: 'entry', forcedBoundaryExit: false, scenarioId: 'forged' } as never);
  assert.equal(attributionAttempt.scenarioId, scenario.id);
  ledger.appendFill(valid);
  assert.throws(() => ledger.appendFill(valid));
  const unknownExit = attributed('unknown-exit', executeLongSell({ scenario, referencePrice: 101, quantityBtc: valid.quantityBtc }), 'genuine', start + 60_000, 'exit');
  const forgedTrade = {
    id: 'forged', candidateId: valid.candidateId, windowId: valid.windowId, foldId: valid.foldId, scenarioId: valid.scenarioId, sleeve: valid.sleeve,
    entryFill: valid, exitFill: unknownExit, quantityBtc: valid.quantityBtc, grossPnlUsd: 0, netPnlUsd: 0, holdMinutes: 1, exitReason: 'exit', forcedBoundaryExit: false,
  } as ResearchTrade;
  assert.throws(() => ledger.appendTrade(forgedTrade));
});