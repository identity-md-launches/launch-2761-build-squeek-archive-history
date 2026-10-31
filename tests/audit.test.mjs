import test from 'node:test';
import assert from 'node:assert/strict';
import { addSample, auditRows, deltaRows, summarise, toSample, workPerRevolution } from '../src/lib/audit.js';

const T0 = Date.parse('2026-10-31T03:00:00Z');
/** @param {Partial<Record<string, any>>} m @param {number} [offsetS] */
const status = (m, offsetS = 0) => ({
  measurement: {
    observedAt: new Date(T0 + offsetS * 1000).toISOString(),
    staleAfterSeconds: 120,
    counterEpoch: 'epoch-a',
    cumulativeWorkUnits: '56197',
    distanceMm: 8990720,
    rpmMilli: 0,
    speedMmPerSecond: 0,
    ...m,
  },
  signer: { kind: 'trust-m', algorithm: 'ecdsa-p256-sha256', keySlot: '0xE0F3', lastVerifiedAt: new Date(T0 + offsetS * 1000).toISOString() },
});

test('reads speedMmPerSecond, never a measurement.speed field', () => {
  const s = toSample(status({ speedMmPerSecond: 1200 }), T0);
  assert.equal(s.speed, 1200);
  assert.throws(() => toSample({ measurement: { ...status({}).measurement, speedMmPerSecond: undefined, speed: 5 } }, T0));
});

test('work per revolution with the default 471 mm rim', () => {
  const s = toSample(status({}), T0);
  const r = workPerRevolution(s, 471);
  assert.equal(r.magnets, 3);
  assert.ok(Math.abs(r.perRev - 2.944) < 0.001);
  const rows = auditRows([s], T0 + 5000, 471);
  const per = rows.find((x) => x.id === 'per-rev');
  assert.equal(per?.label, 'CONSISTENT');
  assert.match(per?.detail || '', /3 magnets per revolution/);
  // An edited rim far from a whole-number ratio drifts.
  assert.equal(auditRows([s], T0, 600).find((x) => x.id === 'per-rev')?.label, 'DRIFTING');
});

test('freshness and attestation print their numbers', () => {
  const s = toSample(status({}), T0);
  const rows = auditRows([s], T0 + 200_000, 471);
  const fresh = rows.find((x) => x.id === 'freshness');
  assert.equal(fresh?.verdict, 'check');
  assert.match(fresh?.detail || '', /200 s old.*120 s/);
  const att = rows.find((x) => x.id === 'attestation');
  assert.match(att?.detail || '', /trust-m.*ecdsa-p256-sha256.*0xE0F3.*200 s ago/);
  assert.equal(summarise(rows), 'CHECK');
});

test('a consistent run passes every delta rule', () => {
  const a = toSample(status({ rpmMilli: 60000, speedMmPerSecond: 471 }), T0);
  const b = toSample(status({ rpmMilli: 60000, speedMmPerSecond: 471, distanceMm: 8990720 + 7065, cumulativeWorkUnits: '56242' }, 15), T0 + 15000);
  const rows = auditRows([a, b], T0 + 16000, 471);
  assert.equal(summarise(rows), 'CONSISTENT');
  const bound = rows.find((r) => r.id === 'distance-bound');
  assert.match(bound?.detail || '', /\+7,065 mm added; limit max\(471, 471\) mm\/s × 15\.0 s × 1\.25 \+ 471 mm = 9,302 mm/);
});

test('each delta rule can fail and makes the ribbon IMPLAUSIBLE', () => {
  const a = toSample(status({}), T0);
  const cases = [
    ['distance-monotonic', { distanceMm: 8990000 }],
    ['work-monotonic', { cumulativeWorkUnits: '56000' }],
    ['idle-work', { cumulativeWorkUnits: '56300' }],
    ['distance-bound', { distanceMm: 8990720 + 472 }],
  ];
  for (const [id, change] of cases) {
    const b = toSample(status(change, 15), T0 + 15000);
    const rows = deltaRows([a, b], 471);
    assert.equal(rows.find((r) => r.id === id)?.verdict, 'fail', String(id));
    assert.equal(summarise(rows), 'IMPLAUSIBLE', String(id));
  }
});

test('a counterEpoch change discards the delta and says so', () => {
  const a = toSample(status({}), T0);
  const b = toSample(status({ counterEpoch: 'epoch-b', distanceMm: 0, cumulativeWorkUnits: '0' }, 15), T0 + 15000);
  const rows = deltaRows([a, b], 471);
  assert.equal(rows.find((r) => r.id === 'distance-monotonic')?.verdict, 'waiting');
  const epoch = rows.find((r) => r.id === 'epoch');
  assert.equal(epoch?.verdict, 'note');
  assert.match(epoch?.detail || '', /discarded/);
  assert.notEqual(summarise(rows), 'IMPLAUSIBLE');
});

test('a repeated observation does not add a sample', () => {
  const list = [];
  assert.equal(addSample(list, toSample(status({}), T0)), true);
  assert.equal(addSample(list, toSample(status({}), T0 + 15000)), false);
  assert.equal(list.length, 1);
  assert.equal(list[0].fetchedAt, T0 + 15000);
});
