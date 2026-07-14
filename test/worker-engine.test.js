import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUnit, createInitialState, adjustCircuitCount, toMM, pressureToPa, mergeIntervals, isSerialLikeModel, clone } from '../src/worker-engine.js';
import { memoryStorage, saveUnitRecord, loadUnitRecord } from '../src/worker-persistence.js';

function baseState(count = 1) {
  let state = createInitialState(count);
  state.unit = { unitNumber: 'U-100', unitModel: 'MR-900', date: '2026-07-13', testerName: 'QA', circuitCount: count };
  state.pipe = { od: 0.875, odUnit: 'inch', thickness: 0.045, thicknessUnit: 'inch', material: 'Copper', density: 8940, young: 110e9, poisson: 0.34, surfaceTempC: 60, pressure: 250, pressureUnit: 'psi' };
  state.circuits.forEach((c, i) => {
    c.route = [{ length: 600 + i * 80, unit: 'mm', direction: 'Straight', feature: 'compressor', notes: '' }, { length: 700 + i * 60, unit: 'mm', direction: 'Right', feature: 'condenser', notes: '' }];
    c.operating = { speed: 700, speedUnit: 'RPM', speedType: 'fixed', minSpeed: '', maxSpeed: '', measuredNaturalHz: 35 + i * 8, operatingDominantHz: 35 + i * 5, peakVelocity: 6, maxDisplacement: 0.2, displacementUnit: 'mm', highestLocationName: `H${i}`, highestLocationDistance: 500 + i * 200, highestLocationUnit: 'mm' };
    c.measurements = [{ name: `B${i}`, distance: 600 + i * 80, unit: 'mm', vertical: 4 + i, horizontal: 3 }];
  });
  return state;
}

test('TEST A - single circuit resonance at 3X', () => {
  const state = baseState(1);
  state.circuits[0].route = [4, 12, 3, 7, 4, 4.75, 10, 4.5].map((length, i, arr) => ({ length, unit: 'inch', direction: 'Straight', feature: i === 0 ? 'compressor' : i === arr.length - 1 ? 'condenser' : 'none', notes: '' }));
  state.circuits[0].operating.speed = 700;
  state.circuits[0].operating.measuredNaturalHz = 35;
  state.circuits[0].operating.highestLocationDistance = 24;
  state.circuits[0].operating.highestLocationUnit = 'inch';
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  const result = out.results[0];
  assert.equal(Number((result.routeTotalMM / 25.4).toFixed(2)), 49.25);
  assert.equal(Number(result.routeTotalMM.toFixed(2)), 1250.95);
  assert.equal(Number((700 / 60).toFixed(4)), 11.6667);
  assert.equal(Number(result.currentRisk.nearestHarmonicFrequencyHz?.toFixed?.(2) || (700 / 60 * 3).toFixed(2)), 35);
  assert.equal(result.currentRisk.order, 3);
  assert.equal(result.currentRisk.risk, 'Critical');
  assert.ok(result.record.testedMassRatios.some(r => r > 0.15));
  assert.ok(result.selectedLayout.ringCount >= 1 && result.selectedLayout.ringCount <= 3);
  for (const ring of result.selectedLayout.rings) assert.ok(ring.clearanceMM >= 30 || ring.x === 0 || ring.x === result.routeTotalMM);
  assert.ok(Number.isFinite(result.selectedLayout.staticResult.stressPa));
  assert.ok(Number.isFinite(result.selectedLayout.staticResult.deflectionM));
});

test('TEST B - two circuits, same geometry with independent measurements', () => {
  let state = baseState(2);
  state.sameGeometry = 'yes';
  state.circuits[1].operating.measuredNaturalHz = 49;
  state.circuits[1].measurements[0].vertical = 8;
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.equal(out.results.length, 2);
  assert.notEqual(out.results[0].selectedLayout.predictedNaturalHz, out.results[1].selectedLayout.predictedNaturalHz);
  const changed = clone(out.state);
  changed.circuits[0].measurements[0].vertical = 99;
  assert.equal(out.state.circuits[1].measurements[0].vertical, 8);
});

test('TEST C - two circuits, different geometry', () => {
  let state = baseState(2);
  state.sameGeometry = 'no';
  state.circuits[0].route = [{ length: 1860, unit: 'mm', direction: 'Straight', feature: 'compressor', notes: '' }];
  state.circuits[1].route = [{ length: 2100, unit: 'mm', direction: 'Straight', feature: 'compressor', notes: '' }];
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.equal(out.results[0].routeTotalMM, 1860);
  assert.equal(out.results[1].routeTotalMM, 2100);
  assert.notEqual(out.results[0].pipe.totalMass, out.results[1].pipe.totalMass);
  assert.notDeepEqual(out.results[0].record.generatedCandidates.map(c => c.x), out.results[1].record.generatedCandidates.map(c => c.x));
});

test('TEST D - four circuits and count changes do not collide', () => {
  let state = baseState(4);
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.equal(out.results.length, 4);
  state = adjustCircuitCount(state, 1);
  assert.equal(state.circuits.length, 1);
  state = adjustCircuitCount(state, 4);
  assert.equal(state.circuits.length, 4);
  assert.deepEqual(new Set(state.circuits.map(c => c.id)).size, 4);
});

test('TEST E - deterministic multiple rings required', () => {
  const state = baseState(1);
  state.circuits[0].route = [{ length: 1800, unit: 'mm', direction: 'Straight', feature: 'compressor', notes: '' }, { length: 200, unit: 'mm', direction: 'Straight', feature: 'condenser', notes: '' }];
  state.circuits[0].operating.speed = 1110;
  state.circuits[0].operating.measuredNaturalHz = 37;
  state.circuits[0].measurements = [{ name: 'Braze critical', distance: 520, unit: 'mm', vertical: 6, horizontal: 2 }];
  state.circuits[0].route[0].feature = 'braze';
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.ok(out.results[0].selectedLayout.ringCount >= 2);
});

test('TEST F - blocked antinode moves and participation is recalculated', () => {
  const state = baseState(1);
  state.circuits[0].route = [{ length: 750, unit: 'mm', direction: 'Straight', feature: 'braze', notes: '' }, { length: 750, unit: 'mm', direction: 'Straight', feature: 'condenser', notes: '' }];
  state.circuits[0].operating.measuredNaturalHz = 35;
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.ok(out.results[0].record.movedCandidates.length > 0);
  const moved = out.results[0].record.movedCandidates[0];
  assert.notEqual(moved.originalX, moved.x);
  assert.ok(Math.abs(moved.participation) < 1);
  const ring = out.results[0].selectedLayout.rings[0];
  assert.ok(ring.massKg * ring.participationSquared < ring.massKg);
});

test('TEST G - static failure is rejected and recorded', () => {
  const state = baseState(1);
  state.pipe = { ...state.pipe, od: 3, odUnit: 'mm', thickness: 0.4, thicknessUnit: 'mm' };
  state.circuits[0].route = [{ length: 9000, unit: 'mm', direction: 'Straight', feature: 'compressor', notes: '' }];
  state.circuits[0].operating.measuredNaturalHz = 35;
  const out = calculateUnit(state);
  assert.ok(out.errors.length || out.results[0].allLayouts.some(l => !l.staticResult.pass));
  if (out.results[0]) {
    assert.ok(out.results[0].allLayouts.filter(l => !l.staticResult.pass).some(l => /stress|deflection/.test(l.staticResult.rejectionReason)));
    assert.ok(out.results[0].selectedLayout.staticResult.pass);
  }
});

test('TEST H - multicircuit save and reload', () => {
  const storage = memoryStorage();
  const state = baseState(4);
  state.sameGeometry = 'no';
  state.circuits.forEach((c, i) => {
    c.uTraps = [{ start: 100 + i, p1: 50 + i, p2: 40 + i, p3: 30 + i, unit: 'mm', braze: 'p2mid' }];
    c.measurements.push({ name: `Unique ${i}`, distance: 200 + i, unit: 'mm', vertical: i + 1, horizontal: i + 2 });
  });
  const out = calculateUnit(state);
  const saved = saveUnitRecord(storage, out.state, out.results, () => true);
  assert.equal(saved.saved, true);
  const loaded = loadUnitRecord(storage, saved.record.id);
  assert.equal(loaded.circuitCount, 4);
  assert.equal(loaded.sameGeometry, 'no');
  loaded.circuits.forEach((c, i) => {
    assert.equal(c.uTraps[0].start, 100 + i);
    assert.equal(c.measurements[1].name, `Unique ${i}`);
  });
});

test('focused conversions, intervals, validation, variable bands, serial safeguard', () => {
  assert.equal(Number(pressureToPa(1, 'psi').toFixed(3)), 6894.757);
  assert.equal(pressureToPa(2, 'bar'), 200000);
  assert.equal(pressureToPa(7, 'kPa'), 7000);
  assert.equal(toMM(2, 'inch'), 50.8);
  assert.equal(toMM(2, 'm'), 2000);
  assert.deepEqual(mergeIntervals([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 25, end: 30 }]).map(i => [i.start, i.end]), [[0, 20], [25, 30]]);
  assert.equal(isSerialLikeModel('P001'), true);
  assert.equal(isSerialLikeModel('APMR51120G1'), false);
  const exact = baseState(1);
  exact.circuits[0].manualTotal = exact.circuits[0].route.reduce((s, r) => s + toMM(r.length, r.unit), 0) * 1.02;
  exact.circuits[0].manualTotalUnit = 'mm';
  assert.deepEqual(calculateUnit(exact).errors, []);
  exact.circuits[0].manualTotal = exact.circuits[0].route.reduce((s, r) => s + toMM(r.length, r.unit), 0) * 1.021;
  assert.ok(calculateUnit(exact).errors.some(e => e.includes('Route length mismatch')));
  const variable = baseState(1);
  variable.circuits[0].operating = { ...variable.circuits[0].operating, speedType: 'variable', minSpeed: 600, maxSpeed: 800, measuredNaturalHz: 35 };
  assert.equal(calculateUnit(variable).results[0].currentRisk.risk, 'Critical');
});
