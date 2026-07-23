/** Safety-critical qualification engine.  This module deliberately fails closed. */
export const SCHEMA_VERSION = 3;
export const PROJECT_DEFAULT_ABSOLUTE_LIMIT_MM_S = 6;
export const DEVICE_CLASSIFICATION = 'Mass-loaded vibration-control ring (mass detuner)';
export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_QUALIFIED: 'NOT QUALIFIED', SCREENING_ONLY: 'SCREENING ONLY' });
export const DIRECTION_OPTIONS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z', 'Vector'];
export const RING_STOCK = Object.freeze([130, 215, 330]); // inventory options, never safety limits

export const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function toMM(value, unit = 'mm') { const n = finite(value, NaN); return unit === 'inch' ? n * 25.4 : unit === 'm' ? n * 1000 : unit === 'mm' ? n : NaN; }
export function pressureToPa(value, unit = 'psi') { const n = finite(value, NaN); return unit === 'psi' ? n * 6894.757293168 : unit === 'bar' ? n * 100000 : unit === 'kPa' ? n * 1000 : n; }
export const speedToHz = (value, unit = 'RPM') => unit === 'RPM' ? finite(value, NaN) / 60 : finite(value, NaN);
export const isSerialLikeModel = value => /^P\d{3,}$/i.test(String(value || '').trim());
export const clone = value => structuredClone(value);

export function defaultCircuit(index = 0) {
  return { id: `circuit-${index + 1}`, geometryRevision: '', route: [], brazes: [], candidates: [], operating: { rpm: '', pressure: '', pressureUnit: 'psi', temperatureC: '', measuredDominantHz: '', measuredNaturalHz: '' }, testRecords: [], result: null };
}
export function createInitialState(count = 1) {
  return { schemaVersion: SCHEMA_VERSION, mode: 'worker', unit: { unitNumber: '', unitModel: '', serialNumber: '', circuitCount: count }, circuits: Array.from({ length: count }, (_, i) => defaultCircuit(i)), recipes: [], engineeringBasisVersion: '2026-07-qualification-gate', auditLog: [] };
}
export function adjustCircuitCount(state, count) { const next = clone(state); const n = Math.max(1, Math.min(4, finite(count, 1))); next.unit.circuitCount = n; while (next.circuits.length < n) next.circuits.push(defaultCircuit(next.circuits.length)); next.circuits = next.circuits.slice(0, n); next.circuits.forEach((c, i) => c.id = `circuit-${i + 1}`); return next; }
export function migrateRecord(record) {
  const next = clone(record || createInitialState());
  next.schemaVersion = SCHEMA_VERSION; next.mode ||= 'worker'; next.unit ||= {};
  if (isSerialLikeModel(next.unit.unitModel) && !next.unit.serialNumber) { next.unit.serialNumber = next.unit.unitModel; next.unit.unitModel = ''; }
  next.circuits ||= []; next.recipes ||= []; next.auditLog ||= [];
  next.circuits.forEach((c, i) => { const existing = clone(c); Object.assign(c, defaultCircuit(i), existing); c.route ||= []; c.brazes ||= []; c.candidates ||= []; c.testRecords ||= []; });
  return next;
}

function vector(row) {
  const l = toMM(row.length, row.unit || 'mm');
  if (!(l >= 0)) return null;
  const named = { '+X':[1,0,0], '-X':[-1,0,0], '+Y':[0,1,0], '-Y':[0,-1,0], '+Z':[0,0,1], '-Z':[0,0,-1] }[row.direction];
  if (named) return named.map(v => v * l);
  const d = [finite(row.dx, NaN), finite(row.dy, NaN), finite(row.dz, NaN)]; const mag = Math.hypot(...d);
  return mag > 0 ? d.map(v => v / mag * l) : null;
}
/** Canonical geometry function: every displayed distance and coordinate comes from here. */
export function calculateGeometry(route = []) {
  let distanceMM = 0, point = [0,0,0]; const segments = [], errors = [];
  route.forEach((row, index) => { const v = vector(row); if (!v) { errors.push(`Segment ${index + 1} needs a positive length and real 3D direction.`); return; } const start = [...point]; point = point.map((p, a) => p + v[a]); const lengthMM = Math.hypot(...v); segments.push({ id: row.id || `segment-${index + 1}`, index: index + 1, startMM: distanceMM, endMM: distanceMM + lengthMM, start, end: [...point], lengthMM }); distanceMM += lengthMM; });
  return { distanceMM, end: point, segments, errors };
}
export const calculateRouteTotalMM = route => calculateGeometry(route).distanceMM;
export function pointOnRoute(geometry, distanceMM) { const s = geometry.segments.find(x => distanceMM >= x.startMM - 1e-6 && distanceMM <= x.endMM + 1e-6); if (!s) return null; const t = s.lengthMM ? (distanceMM - s.startMM) / s.lengthMM : 0; return { segmentId: s.id, distanceMM, xyz: s.start.map((v, i) => v + (s.end[i] - v) * t) }; }

export function reductionPercent(support, after) { return (1 - after / support) * 100; }
export function evaluateMeasurements({ baseline = [], after = [], absoluteLimit = PROJECT_DEFAULT_ABSOLUTE_LIMIT_MM_S, tolerances = {} }) {
  const failures = [], rows = [];
  for (const base of baseline) {
    const match = after.find(a => a.pointId === base.pointId && a.axis === base.axis && compatible(base, a, tolerances));
    if (!match) { failures.push(`No comparable post-installation reading for ${base.pointId} — ${base.axis}.`); continue; }
    const b = finite(base.velocityMMs, NaN), a = finite(match.velocityMMs, NaN);
    if (!(b > 0) || !(a >= 0)) { failures.push(`Invalid vibration reading for ${base.pointId} — ${base.axis}.`); continue; }
    const reduction = reductionPercent(b, a), target = Math.min(.5 * b, absoluteLimit);
    const pass = a <= .5 * b && a <= absoluteLimit;
    rows.push({ pointId: base.pointId, axis: base.axis, supportMMs: b, afterMMs: a, reductionPercent: reduction, targetMMs: target, pass, deterioration: reduction < 0 });
    if (!pass) failures.push(`${base.pointId} — ${base.axis}: ${reduction.toFixed(2)}% reduction; after ${a} mm/s exceeds required criterion.`);
  }
  return { rows, failures, pass: rows.length > 0 && failures.length === 0 };
}
function compatible(a, b, t) {
  const same = ['unitModel','circuitId','pointId','axis','operatingCondition','instrument','velocityUnit'].every(k => !a[k] || !b[k] || a[k] === b[k]);
  const within = (x, y, tolerance) => !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || Math.abs(x-y) <= (tolerance ?? 0);
  return same && within(a.rpm,b.rpm,t.rpm) && within(a.pressure,b.pressure,t.pressure) && within(a.temperatureC,b.temperatureC,t.temperatureC);
}
export function evaluateFRFUpdate({ frequencies, real, imag, massKg, dof, coherence = [] }) {
  if (!Array.isArray(frequencies) || !Array.isArray(real) || !Array.isArray(imag) || !Number.isInteger(dof)) return { valid: false, reason: 'Complex receptance matrix and selected DOF are required.' };
  if (real.length !== frequencies.length || imag.length !== frequencies.length || frequencies.some((f, i) => !(f > 0) || !Number.isFinite(real[i]) || !Number.isFinite(imag[i]) || (coherence[i] != null && coherence[i] < .9))) return { valid: false, reason: 'FRF quality check failed: aligned frequency, real, imaginary, and acceptable coherence are required.' };
  // Scalar point receptance Sherman-Morrison form: Hnew = H/(1 - omega² m H). Full matrices belong in validated back-end tooling.
  return { valid: true, updated: frequencies.map((f,i) => { const h = { re: real[i], im: imag[i] }, q = (2*Math.PI*f)**2 * massKg; const denRe = 1-q*h.re, denIm = -q*h.im, d = denRe**2+denIm**2; return { frequencyHz:f, real:(h.re*denRe+h.im*denIm)/d, imag:(h.im*denRe-h.re*denIm)/d }; }) };
}

function envelopeContains(recipe, operating) { const e = recipe.qualifiedEnvelope || {}; const between = (v, range) => !range || (finite(v, NaN) >= range.min && finite(v, NaN) <= range.max); return between(operating.rpm,e.rpm) && between(operating.pressure,e.pressure) && between(operating.temperatureC,e.temperatureC); }
function exactRecipe(state, circuit) { return (state.recipes || []).find(r => r.approved && r.unitModel === state.unit.unitModel && r.circuitId === circuit.id && r.geometryRevision === circuit.geometryRevision); }
export function calculateCircuit(state, circuit, index = 0) {
  const geometry = calculateGeometry(circuit.route); const reasons = [...geometry.errors];
  if (!circuit.geometryRevision) reasons.push('Geometry revision is required.');
  for (const p of [...circuit.brazes, ...circuit.candidates]) { const point = pointOnRoute(geometry, finite(p.distanceMM, NaN)); if (!point) reasons.push(`${p.kind || 'Point'} ${p.id || ''} is not on a route segment.`); else p.canonicalLocation = point; }
  const recipe = exactRecipe(state, circuit);
  const classification = recipe?.rubber?.dynamicQualified ? 'Viscoelastic mass damper (qualified material data)' : DEVICE_CLASSIFICATION;
  if (!recipe) return { circuitIndex:index, status: STATUS.NOT_QUALIFIED, classification, geometry, reasons:[...reasons, 'No exact approved empirical recipe matches this model, circuit, and geometry revision.'], workerInstruction:'Do not install a mass. Contact an engineer.' };
  if (!envelopeContains(recipe, circuit.operating)) reasons.push('Operating condition is outside the qualified envelope.');
  const baseline = circuit.testRecords.filter(r => r.role === 'support-baseline'); const after = circuit.testRecords.filter(r => r.role === 'post-installation');
  if (recipe.level === 'validated-model' && !recipe.empiricallyQualified) return { circuitIndex:index, status: STATUS.NOT_QUALIFIED, classification, geometry, recipe, reasons:[...reasons, 'Engineering candidate — physical verification required. It is not a worker recipe.'], workerInstruction:'Do not install a mass. Contact an engineer.' };
  if (recipe.level !== 'empirical' || !recipe.empiricallyQualified) reasons.push('Recipe lacks approved empirical qualification.');
  const measure = evaluateMeasurements({ baseline, after, absoluteLimit: finite(recipe.absoluteLimitMMs, PROJECT_DEFAULT_ABSOLUTE_LIMIT_MM_S), tolerances: recipe.comparisonTolerances });
  if (!baseline.length || !after.length) return { circuitIndex:index, status: STATUS.NOT_QUALIFIED, classification, geometry, recipe, reasons:[...reasons, 'Support-baseline and post-installation measurements are required for final approval.'], workerInstruction:'Enter required readings and verify result.' };
  if (reasons.length) return { circuitIndex:index, status: STATUS.NOT_QUALIFIED, classification, geometry, recipe, measurement:measure, reasons, workerInstruction:'Do not install a mass. Contact an engineer.' };
  return { circuitIndex:index, status: measure.pass ? STATUS.PASS : STATUS.FAIL, classification, geometry, recipe, measurement:measure, reasons:measure.failures, workerInstruction: measure.pass ? `Install only recipe mass ${recipe.massG} g at ${recipe.location.distanceMM} mm from ${recipe.location.reference}.` : 'Do not release this configuration. Contact an engineer.' };
}
export function calculateUnit(state) { const migrated = migrateRecord(state); const errors = []; if (!migrated.unit.unitModel || isSerialLikeModel(migrated.unit.unitModel)) errors.push('A valid model number is required; serial number is stored separately.'); const results = migrated.circuits.map((c,i) => calculateCircuit(migrated,c,i)); return { state:migrated, results, errors }; }
export function preliminaryScreening(circuit) { const f1x = speedToHz(circuit.operating?.rpm, 'RPM'); return { status: STATUS.SCREENING_ONLY, label:'Preliminary idealized screening only — not valid for final approval, safe-mass determination, antinode confirmation, or prediction of brazed-joint vibration.', measuredDominantHz:finite(circuit.operating?.measuredDominantHz,NaN), oneXHz:f1x }; }
export function buildEngineeringRecordText(result) { return JSON.stringify({ status:result.status, classification:result.classification, geometry:result.geometry, reasons:result.reasons, measurement:result.measurement, recipeRevision:result.recipe?.revision, warning:'Predicted frequency separation alone does not prove vibration reduction.' }, null, 2); }
export const assertNoBadVisibleValues = text => !/(NaN|Infinity|undefined)/.test(String(text));
export const round = (n, d=2) => Number(finite(n).toFixed(d));
