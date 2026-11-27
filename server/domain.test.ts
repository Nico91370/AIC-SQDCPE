import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureStatus, actionState, applyStatus, nextPdca, nextStatus, dayState, aggregate, measureDate } from './domain.ts';

test('mesure OK / NOK selon le sens', () => {
  assert.equal(measureStatus(98, 98, '>='), 'OK');
  assert.equal(measureStatus(97, 98, '>='), 'NOK');
  assert.equal(measureStatus(0, 0, '<='), 'OK');
  assert.equal(measureStatus(1, 0, '<='), 'NOK');
  assert.equal(measureStatus(null, 0, '<='), null);
});

test("état d'une action", () => {
  const t = '2026-11-27';
  assert.equal(actionState({ status: 'Soldée', due_date: '2026-01-01' }, t), 'Soldée');
  assert.equal(actionState({ status: 'En cours', due_date: '2026-11-26' }, t), 'En retard');
  assert.equal(actionState({ status: 'En cours', due_date: '2026-11-30' }, t), 'Échéance proche');
  assert.equal(actionState({ status: 'En cours', due_date: '2026-12-30' }, t), 'En cours');
  assert.equal(actionState({ status: 'À faire', due_date: null }, t), 'Sans échéance');
});

test('changements de statut', () => {
  const t = '2026-11-27';
  assert.deepEqual(applyStatus({ status: 'À faire', pdca: 'P', done_date: null }, 'En cours', t),
    { status: 'En cours', pdca: 'D', done_date: null, trace: 'Démarrée' });
  assert.deepEqual(applyStatus({ status: 'En cours', pdca: 'D', done_date: null }, 'Soldée', t),
    { status: 'Soldée', pdca: 'A', done_date: t, trace: 'Soldée' });
  assert.deepEqual(applyStatus({ status: 'Soldée', pdca: 'A', done_date: t }, 'À faire', t),
    { status: 'À faire', pdca: 'P', done_date: null, trace: 'Réouverte' });
  assert.equal(nextStatus('En cours'), 'Soldée');
  assert.equal(nextPdca('A'), 'P');
});

test('état du jour et agrégation', () => {
  assert.equal(dayState(['OK', 'NOK'], '2026-11-25', new Set()), 2);
  assert.equal(dayState(['OK'], '2026-11-25', new Set()), 1);
  assert.equal(dayState([], '2026-11-28', new Set()), 3);
  assert.equal(dayState([], '2026-11-11', new Set(['2026-11-11'])), 3);
  assert.equal(dayState([], '2026-11-25', new Set()), 0);
  const v = [{ date: '2026-11-02', value: 2 }, { date: '2026-11-03', value: 4 }];
  assert.equal(aggregate(v, 'Somme'), 6);
  assert.equal(aggregate(v, 'Moyenne'), 3);
  assert.equal(aggregate(v, 'Dernier'), 4);
  assert.equal(measureDate('2026-11-03', 1), '2026-11-02');
});
