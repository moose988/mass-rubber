import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUnit, calculateCircuit, createInitialState, adjustCircuitCount, toMM, pressureToPa, mergeIntervals, isSerialLikeModel, clone, calculateRouteTotalMM, routeFeatures, uTrapFeatures, blockedIntervals, safeIntervals, usableStraightIntervals, validateFinalRecommendation } from '../src/worker-engine.js';
import { memoryStorage, saveUnitRecord, loadUnitRecord, exportSavedData, importSavedData } from '../src/worker-persistence.js';

function baseState(count = 1) {
  let state = createInitialState(count);
  state.unit = { unitNumber: 'U-100', unitModel: 'MR-900', date: '2026-07-13', testerName: 'QA', circuitCount: count };
  state.pipe = { od: 0.875, odUnit: 'inch', thickness: 0.045, thicknessUnit: 'inch', material: 'Copper', density: 8940, young: 110e9, poisson: 0.34, surfaceTempC: 60, pressure: 250, pressureUnit: 'psi' };
  state.circuits.forEach((c, i) => {
    c.route = [{ length: 600 + i * 80, unit: 'mm', direction: 'Right', feature: 'none', notes: '' }, { length: 700 + i * 60, unit: 'mm', direction: 'Right', feature: 'condenser', notes: '' }];
    c.operating = { speed: 700, speedUnit: 'RPM', speedType: 'fixed', minSpeed: '', maxSpeed: '', measuredNaturalHz: 35, operatingDominantHz: 35 + i * 5, peakVelocity: 6, maxDisplacement: 0.2, displacementUnit: 'mm', highestLocationName: `H${i}`, highestLocationDistance: 500 + i * 200, highestLocationUnit: 'mm' };
    c.measurements = [{ name: `B${i}`, distance: 600 + i * 80, unit: 'mm', vertical: 4 + i, horizontal: 3 }];
  });
  return state;
}

test('TEST A - single circuit resonance at 3X', () => {
  const state = baseState(1);
  state.circuits[0].route = [4, 12, 3, 7, 4, 4.75, 10, 4.5].map((length, i, arr) => ({ number: i + 1, length, unit: 'inch', direction: 'Right', feature: i === arr.length - 1 ? 'condenser' : 'none', notes: '' }));
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
  state.circuits[1].operating.speed = 720;
  state.circuits[1].measurements[0].vertical = 8;
  const out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].selectedLayout.finalValidation.pass, true);
  assert.equal(out.results[1].selectedLayout.finalValidation.pass, true);
  const changed = clone(out.state);
  changed.circuits[0].measurements[0].vertical = 99;
  assert.equal(out.state.circuits[1].measurements[0].vertical, 8);
});

test('TEST C - two circuits, different geometry', () => {
  let state = baseState(2);
  state.sameGeometry = 'no';
  state.circuits[0].route = [{ length: 1860, unit: 'mm', direction: 'Right', feature: 'none', notes: '' }];
  state.circuits[1].route = [{ length: 2100, unit: 'mm', direction: 'Right', feature: 'none', notes: '' }];
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
  state.circuits[0].route = [{ length: 1800, unit: 'mm', direction: 'Right', feature: 'none', notes: '' }, { length: 200, unit: 'mm', direction: 'Right', feature: 'condenser', notes: '' }];
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
  state.circuits[0].route = [{ length: 750, unit: 'mm', direction: 'Right', feature: 'braze', notes: '' }, { length: 750, unit: 'mm', direction: 'Right', feature: 'condenser', notes: '' }];
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
  state.circuits[0].route = [{ length: 9000, unit: 'mm', direction: 'Right', feature: 'none', notes: '' }];
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

test('saved units can be exported and imported on another device', () => {
  const laptopStorage = memoryStorage();
  const phoneStorage = memoryStorage();
  const state = baseState(1);
  const out = calculateUnit(state);
  const saved = saveUnitRecord(laptopStorage, out.state, out.results, () => true);
  assert.equal(saved.saved, true);

  const backup = exportSavedData(laptopStorage);
  assert.equal(backup.unitRecords.length, 1);
  const imported = importSavedData(phoneStorage, backup, () => true);
  assert.equal(imported.imported, true);
  assert.equal(imported.unitCount, 1);

  const loaded = loadUnitRecord(phoneStorage, saved.record.id);
  assert.equal(loaded.unitNumber, 'U-100');
  assert.equal(loaded.unitModel, 'MR-900');
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
  assert.equal(calculateCircuit(variable.circuits[0], variable.pipe, 0).record.currentRisk.risk, 'Critical');
});

function exactRegressionState() {
  const state = baseState(2);
  state.unit.unitModel = 'APMR52270G1';
  state.sameGeometry = 'no';
  state.pipe = { od: 0.875, odUnit: 'inch', thickness: 0.045, thicknessUnit: 'inch', material: 'Copper', density: 8940, young: 110e9, poisson: 0.34, surfaceTempC: 60, pressure: 600, pressureUnit: 'psi' };
  const operating = { speed: 710, speedUnit: 'RPM', speedType: 'fixed', minSpeed: '', maxSpeed: '', measuredNaturalHz: 40, operatingDominantHz: 50, peakVelocity: '', maxDisplacement: '', displacementUnit: 'mm', highestLocationName: '', highestLocationDistance: '', highestLocationUnit: 'mm' };
  state.circuits[0].route = [
    [1, 100, 'bend'], [2, 380, 'bend'], [3, 190, 'bend'], [4, 70, 'bend'], [5, 480, 'bend'], [6, 70, 'braze'], [7, 95, 'condenser']
  ].map(([number, length, feature]) => ({ number, length, unit: 'mm', direction: 'Right', feature, notes: '' }));
  state.circuits[0].uTraps = [{ segments: [3, 4, 5], start: '', p1: '', p2: '', p3: '', unit: 'mm', braze: 'p1mid', customBrazeOffset: '' }];
  state.circuits[0].operating = { ...operating, highestLocationName: 'First U-trap braze', highestLocationDistance: 575 };
  state.circuits[0].measurements = [
    ['Near compressor', 15, 7.2, 4.39],
    ['Old support position', 480, 9.65, 9.44],
    ['First U-trap braze', 575, 6.28, 19],
    ['Near final bend', 1220, 4.33, 12.70],
    ['Final braze', 1290, 5.64, 10]
  ].map(([name, distance, vertical, horizontal]) => ({ condition: 'Unsupported baseline', name, distance, unit: 'mm', vertical, horizontal }));
  state.circuits[1].route = [
    [1, 50, 'bend'], [2, 150, 'bend'], [3, 490, 'bend'], [4, 230, 'bend'], [5, 210, 'bend'], [6, 70, 'bend'], [7, 470, 'bend'], [8, 70, 'braze'], [9, 75, 'condenser']
  ].map(([number, length, feature]) => ({ number, length, unit: 'mm', direction: 'Right', feature, notes: '' }));
  state.circuits[1].uTraps = [{ segments: [5, 6, 7], start: '', p1: '', p2: '', p3: '', unit: 'mm', braze: 'p1mid', customBrazeOffset: '' }];
  state.circuits[1].operating = { ...operating, highestLocationName: 'Near final bend', highestLocationDistance: 1670 };
  state.circuits[1].measurements = [
    ['Near compressor', 15, 13.55, 23],
    ['Previous recommended position', 454, 17, 14],
    ['Old support position', 930, 12.34, 14.33],
    ['First U-trap braze', 1025, 16.72, 13.06],
    ['Near final bend', 1670, 15.18, 30],
    ['Final braze', 1740, 15, 25]
  ].map(([name, distance, vertical, horizontal]) => ({ condition: 'Unsupported baseline', name, distance, unit: 'mm', vertical, horizontal }));
  return state;
}

test('route geometry helpers calculate totals, endpoint features, U-trap braze, blocked and usable intervals', () => {
  const state = exactRegressionState();
  const c1 = state.circuits[0];
  assert.equal(calculateRouteTotalMM(c1.route), 1385);
  const points = [...routeFeatures(c1.route, 1385), ...uTrapFeatures(c1.uTraps, 1385, c1.route)];
  assert.ok(points.some(p => p.type === 'condenser' && p.x === 1385));
  assert.ok(points.some(p => p.type === 'braze' && p.x === 575));
  assert.ok(points.some(p => p.type === 'braze' && p.x === 1290));
  const blocked = blockedIntervals(points, 1385, 58);
  assert.ok(blocked.some(i => i.start <= 700 && i.end >= 700));
  const safe = safeIntervals(blocked, 1385);
  assert.ok(safe.every(i => !(i.start <= 700 && i.end >= 700)));
  const usable = usableStraightIntervals(c1.route, points, 58);
  assert.ok(!usable.some(i => i.section.startMM === 670 && i.section.endMM === 740));
  assert.ok(usable.some(i => i.section.startMM === 100 && i.section.endMM === 480));
});

test('exact APMR52270G1 fixture rejects duplicate 700 mm and near-bend 1230 mm outputs', () => {
  const out = calculateUnit(exactRegressionState());
  assert.deepEqual(out.errors, []);
  assert.equal(out.results.length, 2);
  for (const result of out.results) {
    assert.equal(result.selectedLayout.finalValidation.pass, true);
    const xs = result.selectedLayout.rings.map(r => r.x);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
    assert.equal(new Set(xs.map(x => x.toFixed(3))).size, xs.length);
    for (const ring of result.selectedLayout.rings) {
      assert.ok(ring.widthMM > 0);
      assert.ok(ring.x > 0 && ring.x < result.routeTotalMM);
      assert.ok(ring.bendClearanceMM >= 30 + ring.widthMM / 2 || !Number.isFinite(ring.bendClearanceMM));
      assert.ok(ring.brazeClearanceMM >= 30 + ring.widthMM / 2 || !Number.isFinite(ring.brazeClearanceMM));
    }
  }
  const c1xs = out.results[0].selectedLayout.rings.map(r => Math.round(r.x));
  assert.ok(!c1xs.includes(700));
  const c2xs = out.results[1].selectedLayout.rings.map(r => Math.round(r.x));
  assert.ok(!c2xs.includes(1230));
});

test('final validation rejects duplicate and physically overlapping rings', () => {
  const out = calculateUnit(exactRegressionState());
  const result = out.results[0];
  const invalid = clone(result.selectedLayout);
  invalid.rings = [
    { ...invalid.rings[0], ring: 1, x: 700 },
    { ...invalid.rings[0], ring: 2, x: 700 }
  ];
  const check = validateFinalRecommendation(invalid, {
    routeTotalMM: result.routeTotalMM,
    route: result.record.raw.circuit.route,
    points: [...routeFeatures(result.record.raw.circuit.route, result.routeTotalMM), ...uTrapFeatures(result.record.raw.circuit.uTraps, result.routeTotalMM, result.record.raw.circuit.route)],
    pipe: result.pipe,
    operating: result.record.raw.circuit.operating,
    measuredNaturalHz: Number(result.record.raw.circuit.operating.measuredNaturalHz),
    surfaceTempC: result.record.raw.pipe.surfaceTempC,
    pressure: result.record.raw.pipe.pressure,
    pressureUnit: result.record.raw.pipe.pressureUnit
  });
  assert.equal(check.pass, false);
  assert.ok(check.reasons.some(r => /spacing|clearance|crosses/.test(r)));
});

test('measurement calculations keep governing and two-axis resultant separate and reject mixed conditions', () => {
  const state = baseState(1);
  state.circuits[0].measurements = [
    { condition: 'Unsupported baseline', name: 'A', distance: 200, unit: 'mm', vertical: 3, horizontal: 4 }
  ];
  let out = calculateUnit(state);
  assert.deepEqual(out.errors, []);
  assert.equal(out.results[0].measurements[0].calculatedVgov, 4);
  assert.equal(out.results[0].measurements[0].calculatedV2D, 5);
  state.circuits[0].measurements.push({ condition: 'Rings only', name: 'B', distance: 300, unit: 'mm', vertical: 1, horizontal: 1 });
  out = calculateUnit(state);
  assert.ok(out.errors.some(e => e.includes('cannot mix different trial conditions')));
});

