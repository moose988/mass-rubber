export const SCHEMA_VERSION = 2;
export const BRAZE_TARGET_MM_S = 5;
export const ENGINEERING_CONFIG_VERSION = 'geometry-clearance-v3';
export const ENGINEERING_CONFIG = Object.freeze({
  version: ENGINEERING_CONFIG_VERSION,
  featureClearanceMM: 30,
  ringGapMM: 10,
  candidateGridMM: 5,
  manualTotalTolerancePercent: 2,
  resonanceBandsPercent: { critical: 5, high: 10, medium: 15 }
});
export const CLEARANCE_MM = ENGINEERING_CONFIG.featureClearanceMM;
const G = 9.80665;
const COPPER = { density: 8940, young: 110e9, poisson: 0.34 };
const LAMBDAS = [Math.PI, 2 * Math.PI, 3 * Math.PI];
const MASS_RATIOS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
export const DIRECTION_OPTIONS = ['Right', 'Left', 'Up', 'Down', 'Diagonal'];
export const RING_STOCK = Object.freeze([
  { massG: 130, widthMM: 38, outsideDimensions: '38 mm axial width field ring', pipeODRangeMM: [6, 35], rubberType: 'High-temperature rubber', temperatureRatingC: 120, inventoryStatus: 'active' },
  { massG: 215, widthMM: 48, outsideDimensions: '48 mm axial width field ring', pipeODRangeMM: [6, 35], rubberType: 'High-temperature rubber', temperatureRatingC: 120, inventoryStatus: 'active' },
  { massG: 330, widthMM: 58, outsideDimensions: '58 mm axial width field ring', pipeODRangeMM: [6, 35], rubberType: 'High-temperature rubber', temperatureRatingC: 120, inventoryStatus: 'active' }
]);
const FEATURES = {
  none: 'None',
  bend: 'Bend',
  braze: 'Brazed joint',
  condenser: 'Condenser/coil/header connection',
  compressor: 'Compressor connection',
  other: 'Other no-place point'
};

export function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toMM(value, unit = 'mm') {
  const n = finite(value, NaN);
  if (!Number.isFinite(n)) return NaN;
  if (unit === 'inch') return n * 25.4;
  if (unit === 'm') return n * 1000;
  if (unit === 'mm') return n;
  return NaN;
}

export function pressureToPa(value, unit = 'psi') {
  const n = finite(value, NaN);
  if (!Number.isFinite(n)) return NaN;
  if (unit === 'psi') return n * 6894.757293168;
  if (unit === 'bar') return n * 100000;
  if (unit === 'kPa') return n * 1000;
  return n;
}

export function speedToHz(value, unit = 'RPM') {
  const n = finite(value, NaN);
  if (!Number.isFinite(n)) return NaN;
  return unit === 'RPM' ? n / 60 : n;
}

export function isSerialLikeModel(value) {
  return /^P\d{3,}$/i.test(String(value || '').trim());
}

export function defaultCircuit(index = 0) {
  return {
    id: `circuit-${index + 1}`,
    route: [{ number: 1, length: '', unit: 'mm', direction: 'Right', feature: 'none', notes: '' }],
    manualTotal: '',
    manualTotalUnit: 'mm',
    uTraps: [],
    operating: {
      speed: '',
      speedUnit: 'RPM',
      speedType: 'fixed',
      minSpeed: '',
      maxSpeed: '',
      measuredNaturalHz: '',
      operatingDominantHz: '',
      peakVelocity: '',
      maxDisplacement: '',
      displacementUnit: 'mm',
      highestLocationName: '',
      highestLocationDistance: '',
      highestLocationUnit: 'mm'
    },
    measurements: [],
    result: null
  };
}

export function createInitialState(count = 1) {
  return {
    schemaVersion: SCHEMA_VERSION,
    unit: { unitNumber: '', unitModel: '', date: new Date().toISOString().slice(0, 10), testerName: '', circuitCount: count },
    sameGeometry: 'yes',
    pipe: {
      od: '',
      odUnit: 'inch',
      thickness: '',
      thicknessUnit: 'inch',
      material: 'Copper',
      density: COPPER.density,
      young: COPPER.young,
      poisson: COPPER.poisson,
      surfaceTempC: 60,
      pressure: '',
      pressureUnit: 'psi'
    },
    circuits: Array.from({ length: count }, (_, i) => defaultCircuit(i))
  };
}

export function clone(value) {
  return structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function adjustCircuitCount(state, count) {
  const next = clone(state);
  const safeCount = Math.max(1, Math.min(4, Number(count) || 1));
  next.unit.circuitCount = safeCount;
  while (next.circuits.length < safeCount) next.circuits.push(defaultCircuit(next.circuits.length));
  next.circuits = next.circuits.slice(0, safeCount);
  next.circuits.forEach((c, i) => { c.id = `circuit-${i + 1}`; });
  return next;
}

export function syncSameGeometry(state) {
  const next = clone(state);
  if (next.sameGeometry === 'yes' && next.circuits.length > 1) {
    const route = clone(next.circuits[0].route);
    const uTraps = clone(next.circuits[0].uTraps);
    const manualTotal = next.circuits[0].manualTotal;
    const manualTotalUnit = next.circuits[0].manualTotalUnit;
    next.circuits.forEach((c, i) => {
      if (i > 0) {
        c.route = clone(route);
        c.uTraps = clone(uTraps);
        c.manualTotal = manualTotal;
        c.manualTotalUnit = manualTotalUnit;
      }
    });
  }
  return next;
}

function routeLengthMM(route) {
  return route.reduce((sum, row) => sum + toMM(row.length, row.unit), 0);
}

export function calculateRouteTotalMM(route) {
  return routeLengthMM(route || []);
}

function routeSections(route) {
  let pos = 0;
  return (route || []).map((row, i) => {
    const lengthMM = toMM(row.length, row.unit);
    const startMM = pos;
    const endMM = pos + lengthMM;
    pos = endMM;
    return { segment: i + 1, number: Number(row.number || i + 1), direction: row.direction, feature: row.feature || 'none', notes: row.notes || '', startMM, endMM, lengthMM };
  });
}

function dedupePoints(points) {
  const out = [];
  for (const p of points.filter(p => Number.isFinite(p.x))) {
    const x = Math.round(p.x * 1000) / 1000;
    const existing = out.find(item => Math.round(item.x * 1000) / 1000 === x && (item.type === p.type || ['bend', 'utrap-bend'].includes(item.type) && ['bend', 'utrap-bend'].includes(p.type)));
    if (!existing) out.push(p);
  }
  return out.sort((a, b) => a.x - b.x);
}

function pipeCalculations(pipe, lengthMM) {
  const errors = [];
  const Do = toMM(pipe.od, pipe.odUnit) / 1000;
  const t = toMM(pipe.thickness, pipe.thicknessUnit) / 1000;
  if (!(Do > 0)) errors.push('Pipe OD must be greater than 0.');
  if (!(t > 0)) errors.push('Wall thickness must be greater than 0.');
  if (Do > 0 && t > 0 && 2 * t >= Do) errors.push('Wall thickness is invalid because 2t >= OD.');
  if (!(lengthMM > 0)) errors.push('Route length must be greater than 0.');
  const Di = Do - 2 * t;
  const area = Math.PI / 4 * (Do ** 2 - Di ** 2);
  const I = Math.PI / 64 * (Do ** 4 - Di ** 4);
  const density = finite(pipe.density, COPPER.density);
  const young = finite(pipe.young, COPPER.young);
  const mPrime = density * area;
  const L = lengthMM / 1000;
  return { errors, Do, t, Di, area, I, density, young, poisson: finite(pipe.poisson, COPPER.poisson), mPrime, totalMass: mPrime * L, modalMass: 0.5 * mPrime * L, L };
}

export function routeFeatures(route, totalMM) {
  const points = [{ x: 0, type: 'compressor', label: FEATURES.compressor, segment: 1 }];
  let pos = 0;
  route.forEach((row, i) => {
    pos += toMM(row.length, row.unit);
    const type = row.feature || 'none';
    if (type !== 'none' && type !== 'compressor') points.push({ x: Math.min(pos, totalMM), type, label: FEATURES[type] || FEATURES.other, segment: i + 1 });
  });
  return dedupePoints(points);
}

function segmentSelectedUTrapFeatures(trap, sections, totalMM) {
  const selected = (trap.segments || trap.segmentNumbers || []).map(Number).filter(Number.isFinite);
  if (selected.length !== 3) return null;
  const sorted = [...selected].sort((a, b) => a - b);
  if (sorted[1] !== sorted[0] + 1 || sorted[2] !== sorted[1] + 1) return null;
  const pieces = sorted.map(n => sections.find(s => s.number === n || s.segment === n));
  if (pieces.some(p => !p)) return null;
  const start = pieces[0].startMM;
  const p1 = pieces[0].lengthMM;
  const p2 = pieces[1].lengthMM;
  const p3 = pieces[2].lengthMM;
  return {
    start,
    p1,
    p2,
    p3,
    selectedSegments: sorted,
    points: [
      { x: start, type: 'utrap-start', label: 'U-trap start', segment: pieces[0].segment },
      { x: start + p1, type: 'utrap-bend', label: 'U-trap bend', segment: pieces[0].segment },
      { x: start + p1 + p2, type: 'utrap-bend', label: 'U-trap bend', segment: pieces[1].segment },
      { x: start + p1 + p2 + p3, type: 'utrap-bend', label: 'U-trap bend', segment: pieces[2].segment },
      { x: start + p1 / 2, type: 'braze', label: FEATURES.braze, segment: pieces[0].segment }
    ].filter(p => p.x >= 0 && p.x <= totalMM)
  };
}

export function uTrapFeatures(uTraps, totalMM, route = []) {
  const points = [];
  const sections = routeSections(route);
  for (const trap of uTraps || []) {
    const synced = segmentSelectedUTrapFeatures(trap, sections, totalMM);
    if (synced) {
      points.push(...synced.points);
      continue;
    }
    const start = toMM(trap.start, trap.unit);
    const p1 = toMM(trap.p1, trap.unit);
    const p2 = toMM(trap.p2, trap.unit);
    const p3 = toMM(trap.p3, trap.unit);
    const bends = [start + p1, start + p1 + p2, start + p1 + p2 + p3].filter(x => x >= 0 && x <= totalMM);
    bends.forEach(x => points.push({ x, type: 'utrap-bend', label: 'U-trap bend' }));
    let braze = null;
    if (trap.braze === 'p1mid') braze = start + p1 / 2;
    if (trap.braze === 'p2mid') braze = start + p1 + p2 / 2;
    if (trap.braze === 'p3mid') braze = start + p1 + p2 + p3 / 2;
    if (trap.braze === 'custom') braze = start + toMM(trap.customBrazeOffset, trap.unit);
    if (Number.isFinite(braze) && braze >= 0 && braze <= totalMM) points.push({ x: braze, type: 'braze', label: FEATURES.braze });
  }
  return dedupePoints(points);
}

export function mergeIntervals(intervals) {
  const sorted = intervals.filter(i => Number.isFinite(i.start) && Number.isFinite(i.end)).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of sorted) {
    if (!merged.length || item.start > merged[merged.length - 1].end) merged.push({ ...item, labels: [item.label].filter(Boolean) });
    else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, item.end);
      if (item.label) merged[merged.length - 1].labels.push(item.label);
    }
  }
  return merged;
}

export function blockedIntervals(points, totalMM, ringWidthMM = 0) {
  const halfWidth = ringWidthMM / 2;
  return mergeIntervals(points.map(p => ({
    start: Math.max(0, p.x - CLEARANCE_MM - halfWidth),
    end: Math.min(totalMM, p.x + CLEARANCE_MM + halfWidth),
    label: `${p.label} at ${round(p.x, 1)} mm`
  })));
}

export function safeIntervals(blocked, totalMM) {
  let cursor = 0;
  const safe = [];
  for (const b of blocked) {
    if (b.start > cursor) safe.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < totalMM) safe.push({ start: cursor, end: totalMM });
  return safe.filter(i => i.end - i.start > 0.001);
}

function inBlocked(x, blocked) {
  return blocked.some(b => x >= b.start && x <= b.end);
}

function nearestSafe(x, safe) {
  let best = null;
  for (const s of safe) {
    const candidate = Math.max(s.start, Math.min(s.end, x));
    const d = Math.abs(candidate - x);
    if (!best || d < best.distance) best = { x: candidate, distance: d, interval: s };
  }
  return best;
}

function featureClearanceAtBoundary(boundary, points) {
  return points.some(p => Math.abs(p.x - boundary) < 1e-6) ? CLEARANCE_MM : 0;
}

export function usableStraightIntervals(route, points, ringWidthMM) {
  if (!(ringWidthMM > 0)) return [];
  const halfWidth = ringWidthMM / 2;
  return routeSections(route).map(section => {
    const cStart = featureClearanceAtBoundary(section.startMM, points);
    const cEnd = featureClearanceAtBoundary(section.endMM, points);
    return {
      start: section.startMM + cStart + halfWidth,
      end: section.endMM - cEnd - halfWidth,
      segment: section.segment,
      direction: section.direction,
      section
    };
  }).filter(i => i.end >= i.start);
}

function validCenterIntervals(route, points, totalMM, ringWidthMM) {
  const straight = usableStraightIntervals(route, points, ringWidthMM);
  const centerSafe = safeIntervals(blockedIntervals(points, totalMM, ringWidthMM), totalMM);
  const intervals = [];
  for (const s of straight) {
    for (const c of centerSafe) {
      const start = Math.max(s.start, c.start);
      const end = Math.min(s.end, c.end);
      if (end >= start) intervals.push({ ...s, start, end });
    }
  }
  return intervals;
}

function nearestUsableCenter(x, intervals) {
  let best = null;
  for (const interval of intervals) {
    const candidate = Math.max(interval.start, Math.min(interval.end, x));
    const distance = Math.abs(candidate - x);
    if (!best || distance < best.distance) best = { x: candidate, distance, interval };
  }
  return best;
}

function modeShape(mode, x, totalMM) {
  return Math.sin(mode * Math.PI * x / totalMM);
}

function screeningFrequencies(pipe) {
  return LAMBDAS.map((lambda, i) => ({ mode: i + 1, lambda, frequencyHz: (lambda ** 2 / (2 * Math.PI * pipe.L ** 2)) * Math.sqrt(pipe.young * pipe.I / pipe.mPrime) }));
}

function nearestScreeningMode(measured, freqs) {
  return freqs.reduce((best, f) => Math.abs(f.frequencyHz - measured) < Math.abs(best.frequencyHz - measured) ? f : best, freqs[0]);
}

function harmonicRisk(frequency, operating) {
  const speedType = operating.speedType || 'fixed';
  const base = speedToHz(speedType === 'variable' ? operating.minSpeed : operating.speed, operating.speedUnit);
  const max = speedToHz(speedType === 'variable' ? operating.maxSpeed : operating.speed, operating.speedUnit);
  const harmonics = [];
  let nearest = null;
  for (let order = 1; order <= 6; order++) {
    const lo = Math.min(base, max) * order;
    const hi = Math.max(base, max) * order;
    let separationPercent;
    if (speedType === 'variable' && frequency >= lo && frequency <= hi) separationPercent = 0;
    else {
      const ref = frequency < lo ? lo : hi;
      separationPercent = Math.abs(frequency - ref) / ref * 100;
    }
    const bands = ENGINEERING_CONFIG.resonanceBandsPercent;
    const risk = separationPercent < bands.critical ? 'Critical' : separationPercent < bands.high ? 'High' : separationPercent < bands.medium ? 'Medium' : 'Low';
    const h = { order, frequencyHz: speedType === 'variable' ? null : lo, bandHz: speedType === 'variable' ? [lo, hi] : null, separationPercent, risk };
    harmonics.push(h);
    if (!nearest || h.separationPercent < nearest.separationPercent) nearest = h;
  }
  return { harmonics, nearest };
}

function classifyLocation(x, points) {
  const priority = ['compressor', 'condenser', 'braze', 'utrap-bend', 'bend', 'other'];
  const near = points.filter(p => Math.abs(p.x - x) <= CLEARANCE_MM).sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))[0];
  if (!near) return 'Straight section';
  if (near.type === 'utrap-bend') return 'U-trap bend';
  return FEATURES[near.type] || 'Other no-place point';
}

function routeSection(x, route) {
  let pos = 0;
  for (let i = 0; i < route.length; i++) {
    const next = pos + toMM(route[i].length, route[i].unit);
    if (x <= next + 1e-6) return { segment: i + 1, direction: route[i].direction || 'Right', startMM: pos, endMM: next };
    pos = next;
  }
  return { segment: route.length, direction: 'Right', startMM: pos, endMM: pos };
}

function nearestFeatureClearance(x, points) {
  if (!points.length) return Infinity;
  return Math.min(...points.map(p => Math.abs(p.x - x)));
}

function candidateLocations(totalMM, mode, safe, points, circuit, route, record) {
  const raw = [];
  if (mode === 1) raw.push({ label: 'Mode 1 antinode', x: totalMM / 2, local: false });
  if (mode === 2) raw.push({ label: 'Mode 2 antinode A', x: totalMM / 4, local: false }, { label: 'Mode 2 antinode B', x: totalMM * 3 / 4, local: false });
  if (mode === 3) raw.push({ label: 'Mode 3 antinode A', x: totalMM / 6, local: false }, { label: 'Mode 3 antinode B', x: totalMM / 2, local: false }, { label: 'Mode 3 antinode C', x: totalMM * 5 / 6, local: false });
  const hv = toMM(circuit.operating.highestLocationDistance, circuit.operating.highestLocationUnit);
  if (Number.isFinite(hv)) raw.push({ label: 'Highest-vibration location', x: hv, local: false });
  const brazeMeasurements = (circuit.measurements || []).map(m => ({ ...m, vmax: Math.max(finite(m.vertical), finite(m.horizontal)) })).filter(m => m.classification === FEATURES.braze || m.classification === 'Brazed joint').sort((a, b) => b.vmax - a.vmax);
  if (brazeMeasurements[0]) {
    const bx = toMM(brazeMeasurements[0].distance, brazeMeasurements[0].unit);
    raw.push({ label: 'Before most critical braze', x: bx - CLEARANCE_MM, local: true }, { label: 'After most critical braze', x: bx + CLEARANCE_MM, local: true });
  }
  raw.push({ label: 'Condenser-side safe straight region', x: totalMM * 0.88, local: false });
  for (const trapPoint of points.filter(p => p.type === 'utrap-bend')) raw.push({ label: 'Safe straight U-trap leg', x: trapPoint.x + CLEARANCE_MM, local: true });
  const maxRingWidth = Math.max(...RING_STOCK.map(r => r.widthMM));
  const usableForLargestRing = validCenterIntervals(route, points, totalMM, maxRingWidth);
  for (const interval of usableForLargestRing) {
    raw.push({ label: `Centre of usable segment ${interval.segment}`, x: (interval.start + interval.end) / 2, local: false });
    for (let x = Math.ceil(interval.start / ENGINEERING_CONFIG.candidateGridMM) * ENGINEERING_CONFIG.candidateGridMM; x <= interval.end + 1e-6; x += ENGINEERING_CONFIG.candidateGridMM) {
      raw.push({ label: `Grid segment ${interval.segment}`, x, local: false, grid: true });
    }
  }
  const candidates = [];
  const seen = new Set();
  for (const item of raw) {
    const ns = nearestUsableCenter(Math.max(0, Math.min(totalMM, item.x)), usableForLargestRing) || nearestSafe(Math.max(0, Math.min(totalMM, item.x)), safe);
    if (!ns) continue;
    const roundedX = Math.round(ns.x * 1000) / 1000;
    const key = `${roundedX}:${item.local ? 'local' : 'global'}:${item.grid ? 'grid' : 'ref'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const phi = modeShape(mode, ns.x, totalMM);
    const moved = Math.abs(ns.x - item.x);
    const c = { ...item, originalX: item.x, x: ns.x, moved, participation: phi, participationSquared: phi ** 2, rejected: false, reason: '' };
    if (!item.local && Math.abs(phi) < 0.35) {
      c.rejected = true;
      c.reason = 'Mode-shape participation below 0.35 after safe-location movement.';
    }
    candidates.push(c);
    if (moved > 0.001) record.movedCandidates.push(c);
  }
  record.generatedCandidates = candidates;
  return candidates.filter(c => !c.rejected);
}

function allowableStress(surfaceTempC) {
  const t = finite(surfaceTempC, 20);
  if (t <= 60) return { value: 40e6, warning: '' };
  if (t <= 100) return { value: 35e6, warning: '' };
  if (t <= 125) return { value: 30e6, warning: '' };
  return { value: 25e6, warning: 'Surface temperature above 125 C; reduced copper allowable bending stress applied.' };
}

function staticCheck(pipe, rings, surfaceTempC) {
  const allow = allowableStress(surfaceTempC);
  const w = pipe.mPrime * G;
  const Mw = w * pipe.L ** 2 / 8;
  const pointMoments = rings.map(r => (r.massKg * G) * (r.x / 1000) * (pipe.L - r.x / 1000) / pipe.L);
  const M = Mw + pointMoments.reduce((a, b) => a + b, 0);
  const stress = M * (pipe.Do / 2) / pipe.I;
  const defW = 5 * w * pipe.L ** 4 / (384 * pipe.young * pipe.I);
  const defPoints = rings.map(r => (r.massKg * G) * pipe.L ** 3 / (48 * pipe.young * pipe.I));
  const deflection = defW + defPoints.reduce((a, b) => a + b, 0);
  const limit = Math.min(pipe.L / 360, 0.005);
  const pass = stress <= allow.value && deflection <= limit;
  const reasons = [];
  if (stress > allow.value) reasons.push('static stress exceeds allowable stress');
  if (deflection > limit) reasons.push('static deflection exceeds limit');
  return { pass, stressPa: stress, allowablePa: allow.value, deflectionM: deflection, limitM: limit, warning: allow.warning, rejectionReason: reasons.join(' and ') };
}

function pressureScreening(pipe, pressure, unit, bendingStress) {
  const p = pressureToPa(pressure, unit);
  if (!Number.isFinite(p) || p <= 0) return { status: 'Pressure screening not completed', completed: false };
  const hoop = p * pipe.Di / (2 * pipe.t);
  const longitudinal = p * pipe.Di / (4 * pipe.t);
  const vonMises = Math.sqrt(hoop ** 2 + (longitudinal + bendingStress) ** 2 - hoop * (longitudinal + bendingStress));
  return {
    status: 'Pressure and bending screening completed',
    completed: true,
    pressurePa: p,
    hoopPa: hoop,
    longitudinalPa: longitudinal,
    vonMisesPa: vonMises,
    note: 'Pressure and bending result is a screening check only. Final pressure-code compliance depends on the approved tube grade, temper, design pressure, joining method, and applicable refrigeration piping requirements.'
  };
}

function dynamicStatus(currentBrazeVmax, currentRisk, afterRisk, staticResult, pressureResult, measuredNaturalHz) {
  if (!(measuredNaturalHz > 0)) return 'Critical field verification required';
  if (!staticResult.pass) return 'Critical field verification required';
  if (currentBrazeVmax >= BRAZE_TARGET_MM_S) return 'Critical field verification required';
  if (['Medium', 'High', 'Critical'].includes(afterRisk.risk)) return 'Engineering review required';
  if (currentRisk.risk === 'Critical' && !pressureResult.completed) return 'Engineering review required';
  return 'Low screening concern';
}

function stockRingForMass(massG) {
  const active = RING_STOCK.filter(r => r.inventoryStatus === 'active').sort((a, b) => a.massG - b.massG);
  return active.find(r => r.massG >= massG - 1e-6) || active[active.length - 1] || null;
}

function spacingForLargestRings() {
  const maxWidth = Math.max(...RING_STOCK.map(r => r.widthMM));
  return maxWidth + ENGINEERING_CONFIG.ringGapMM;
}

function selectSpacedCandidates(candidates, count, preferred = []) {
  const selected = [];
  const minSpacing = spacingForLargestRings();
  const ordered = [...preferred, ...candidates].filter(Boolean);
  const seen = new Set();
  for (const candidate of ordered) {
    const key = Math.round(candidate.x * 1000) / 1000;
    if (seen.has(key)) continue;
    seen.add(key);
    if (selected.every(s => Math.abs(s.x - candidate.x) >= minSpacing)) selected.push(candidate);
    if (selected.length === count) break;
  }
  return selected;
}

function fitRingInStraightSection(ring, route, points) {
  if (!(ring.widthMM > 0)) return { pass: false, reason: 'RING GEOMETRY INCOMPLETE - PHYSICAL INSTALLATION CANNOT BE VERIFIED.' };
  const section = routeSection(ring.x, route);
  const half = ring.widthMM / 2;
  const cStart = featureClearanceAtBoundary(section.startMM, points);
  const cEnd = featureClearanceAtBoundary(section.endMM, points);
  if (ring.x - half < section.startMM + cStart - 1e-6) return { pass: false, reason: `ring crosses start clearance of segment ${section.segment}` };
  if (ring.x + half > section.endMM - cEnd + 1e-6) return { pass: false, reason: `ring crosses end clearance of segment ${section.segment}` };
  return { pass: true, section };
}

function nearestTypedClearance(x, points, types) {
  const selected = points.filter(p => types.includes(p.type));
  if (!selected.length) return Infinity;
  return Math.min(...selected.map(p => Math.abs(p.x - x)));
}

export function validateFinalRecommendation(layout, { routeTotalMM, route, points, pipe, operating, measuredNaturalHz, surfaceTempC, pressure, pressureUnit }) {
  const reasons = [];
  if (!layout || !Array.isArray(layout.rings) || !layout.rings.length) reasons.push('no rings in recommendation');
  const rings = [...(layout?.rings || [])].sort((a, b) => a.x - b.x);
  const activeMasses = new Set(RING_STOCK.filter(r => r.inventoryStatus === 'active').map(r => r.massG));
  for (const ring of rings) {
    if (!activeMasses.has(ring.massG)) reasons.push(`ring ${ring.ring} mass is not active stock`);
    if (!(ring.widthMM > 0)) reasons.push('RING GEOMETRY INCOMPLETE - PHYSICAL INSTALLATION CANNOT BE VERIFIED.');
    if (!(Number.isFinite(ring.x) && ring.x > 0 && ring.x < routeTotalMM)) reasons.push(`ring ${ring.ring} location is outside route`);
    const fit = fitRingInStraightSection(ring, route, points);
    if (!fit.pass) reasons.push(`ring ${ring.ring}: ${fit.reason}`);
    for (const p of points) {
      const required = CLEARANCE_MM + ring.widthMM / 2;
      if (Math.abs(ring.x - p.x) < required - 1e-6) reasons.push(`ring ${ring.ring} violates ${p.label} clearance at ${round(p.x, 1)} mm`);
    }
  }
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const required = rings[i].widthMM / 2 + rings[j].widthMM / 2 + ENGINEERING_CONFIG.ringGapMM;
      const actual = Math.abs(rings[i].x - rings[j].x);
      if (actual < required - 1e-6) reasons.push(`rings ${rings[i].ring} and ${rings[j].ring} violate minimum spacing`);
    }
  }
  const effectiveKg = rings.reduce((sum, r) => sum + r.massKg * modeShape(layout.mode || 1, r.x, routeTotalMM) ** 2, 0);
  const predictedHz = measuredNaturalHz * Math.sqrt(pipe.modalMass / (pipe.modalMass + effectiveKg));
  const risk = harmonicRisk(predictedHz, operating).nearest;
  const staticResult = staticCheck(pipe, rings, surfaceTempC);
  const pressureResult = pressureScreening(pipe, pressure, pressureUnit, staticResult.stressPa);
  if (!staticResult.pass) reasons.push(staticResult.rejectionReason || 'static screening failed');
  if (risk.risk !== 'Low') reasons.push('resonance risk is not Low after final masses and locations');
  return { pass: reasons.length === 0, reasons, rings, effectiveKg, predictedHz, risk, staticResult, pressureResult };
}

function buildRings(layoutName, candidates, ratio, modalMass) {
  const sorted = [...candidates].sort((a, b) => b.participationSquared - a.participationSquared);
  if (!sorted.length) return [];
  if (layoutName === 'A') return [{ ...sorted[0], massKg: modalMass * ratio }];
  if (layoutName === 'B') return selectSpacedCandidates(candidates, 2, sorted).map(c => ({ ...c, massKg: modalMass * ratio / 2 }));
  if (layoutName === 'C') {
    const main = sorted[0];
    const local = selectSpacedCandidates(candidates, 2, [main, ...candidates.filter(c => c.local), ...sorted])[1];
    if (!local) return [{ ...main, massKg: modalMass * ratio }];
    return [{ ...main, massKg: modalMass * ratio * 0.72 }, { ...local, massKg: modalMass * ratio * 0.28, localCorrective: true }];
  }
  if (layoutName === 'D') {
    const selected = selectSpacedCandidates(candidates, 3, sorted);
    return selected.map(c => ({ ...c, massKg: modalMass * ratio / Math.min(3, selected.length) }));
  }
  const selected = selectSpacedCandidates(candidates, 3, sorted);
  return selected.map(c => ({ ...c, massKg: modalMass * ratio * 1.2 / Math.min(3, selected.length) }));
}

function evaluateLayouts({ pipe, candidates, operating, measuredNaturalHz, currentRisk, pressure, pressureUnit, surfaceTempC, points, route, routeTotalMM, mode, currentBrazeVmax, record }) {
  const testedRatios = [...MASS_RATIOS];
  const layouts = [];
  const names = ['A', 'B', 'C', 'D', 'E'];
  const layoutLabels = {
    A: 'Layout A - One main ring',
    B: 'Layout B - Two antinode rings',
    C: 'Layout C - Main antinode ring plus critical-braze-side corrective ring',
    D: 'Layout D - Three distributed rings',
    E: 'Layout E - Heavy distributed low-resonance-risk layout'
  };
  function pushForRatio(ratio) {
    for (const name of names) {
      const rings = buildRings(name, candidates, ratio, pipe.modalMass);
      if (!rings.length) continue;
      const stockMapped = rings.map((r, i) => {
        const stock = stockRingForMass(r.massKg * 1000);
        return {
          ...r,
          ring: i + 1,
          massKg: stock.massG / 1000,
          massG: stock.massG,
          widthMM: stock.widthMM,
          stock,
          participation: modeShape(mode, r.x, routeTotalMM),
          participationSquared: modeShape(mode, r.x, routeTotalMM) ** 2
        };
      });
      const effectiveKg = stockMapped.reduce((sum, r) => sum + r.massKg * r.participationSquared, 0);
      const predictedHz = measuredNaturalHz * Math.sqrt(pipe.modalMass / (pipe.modalMass + effectiveKg));
      const afterRisk = harmonicRisk(predictedHz, operating).nearest;
      const staticResult = staticCheck(pipe, stockMapped, surfaceTempC);
      const pressureResult = pressureScreening(pipe, pressure, pressureUnit, staticResult.stressPa);
      const criticalBrazeCoverage = stockMapped.reduce((best, r) => Math.max(best, r.localCorrective ? 1 : 0.5 / Math.max(1, nearestFeatureClearance(r.x, points.filter(p => p.type === 'braze')) / CLEARANCE_MM)), 0);
      const concentratedLoadMetric = Math.max(...stockMapped.map(r => r.massKg)) / Math.max(0.000001, stockMapped.reduce((s, r) => s + r.massKg, 0));
      const rejectionReasons = [];
      if (!staticResult.pass) rejectionReasons.push(staticResult.rejectionReason);
      if (afterRisk.risk !== 'Low') rejectionReasons.push('after-layout resonance risk is not Low');
      const layout = {
        layout: name,
        label: layoutLabels[name],
        ratio,
        mode,
        rings: stockMapped.map((r, i) => ({ ring: i + 1, massKg: r.massKg, massG: r.massG, widthMM: r.widthMM, x: r.x, participation: r.participation, participationSquared: r.participationSquared, localCorrective: !!r.localCorrective, section: routeSection(r.x, route), nearbyFeature: classifyLocation(r.x, points), clearanceMM: nearestFeatureClearance(r.x, points), bendClearanceMM: nearestTypedClearance(r.x, points, ['bend', 'utrap-bend']), brazeClearanceMM: nearestTypedClearance(r.x, points, ['braze']) })),
        ringCount: stockMapped.length,
        totalPhysicalMassKg: stockMapped.reduce((s, r) => s + r.massKg, 0),
        effectiveModalMassKg: effectiveKg,
        predictedNaturalHz: predictedHz,
        nearestHarmonic: afterRisk,
        resonanceRisk: afterRisk.risk,
        staticResult,
        pressureResult,
        dynamicStatus: dynamicStatus(currentBrazeVmax, currentRisk, afterRisk, staticResult, pressureResult, measuredNaturalHz),
        criticalBrazeCoverage,
        concentratedLoadMetric,
        rejectionReasons,
        rankingReasons: []
      };
      const finalCheck = validateFinalRecommendation(layout, { routeTotalMM, route, points, pipe, operating, measuredNaturalHz, surfaceTempC, pressure, pressureUnit });
      layout.finalValidation = finalCheck;
      if (!finalCheck.pass) rejectionReasons.push(...finalCheck.reasons);
      layouts.push(layout);
    }
  }
  MASS_RATIOS.forEach(pushForRatio);
  let valid = layouts.filter(l => l.finalValidation?.pass);
  let iterativeOutcome = 'Not needed; at least one standard ratio reached Low risk.';
  if (!valid.length) {
    for (let pct = 1; pct <= 100; pct += 0.1) {
      const ratio = Number((pct / 100).toFixed(4));
      testedRatios.push(ratio);
      pushForRatio(ratio);
      valid = layouts.filter(l => l.finalValidation?.pass);
      if (valid.length) {
        iterativeOutcome = `Found Low-risk layout at ${round(pct, 1)}% of modal mass.`;
        break;
      }
    }
  }
  record.testedMassRatios = testedRatios;
  record.iterativeMassSearchOutcome = iterativeOutcome;
  record.candidateLayouts = layouts;
  const staticPassing = layouts.filter(l => l.staticResult.pass);
  const selected = valid.sort(compareLayouts)[0] || staticPassing.sort(compareFallbackLayouts)[0] || null;
  if (selected) {
    selected.rankingReasons = selected.resonanceRisk === 'Low'
      ? ['Static PASS', 'After-layout resonance risk = Low', 'Selected by deterministic priority comparison: participation, braze coverage, load distribution, mass, then ring count.']
      : ['Static PASS', 'No Low-risk layout found within the required 1% to 100% modal-mass search.', 'Selected best screening layout by resonance separation, participation, braze coverage, load distribution, and mass; engineering review required.'];
  }
  return { layouts, selected };
}

function compareLayouts(a, b) {
  if (a.staticResult.pass !== b.staticResult.pass) return a.staticResult.pass ? -1 : 1;
  if ((a.resonanceRisk === 'Low') !== (b.resonanceRisk === 'Low')) return a.resonanceRisk === 'Low' ? -1 : 1;
  if (Math.abs(b.effectiveModalMassKg - a.effectiveModalMassKg) > 1e-9) return b.effectiveModalMassKg - a.effectiveModalMassKg;
  if (Math.abs(b.criticalBrazeCoverage - a.criticalBrazeCoverage) > 1e-9) return b.criticalBrazeCoverage - a.criticalBrazeCoverage;
  if (Math.abs(a.concentratedLoadMetric - b.concentratedLoadMetric) > 1e-9) return a.concentratedLoadMetric - b.concentratedLoadMetric;
  if (Math.abs(a.totalPhysicalMassKg - b.totalPhysicalMassKg) > 1e-9) return a.totalPhysicalMassKg - b.totalPhysicalMassKg;
  return a.ringCount - b.ringCount;
}

function compareFallbackLayouts(a, b) {
  if (a.staticResult.pass !== b.staticResult.pass) return a.staticResult.pass ? -1 : 1;
  const riskRank = { Low: 0, Medium: 1, High: 2, Critical: 3 };
  if (riskRank[a.resonanceRisk] !== riskRank[b.resonanceRisk]) return riskRank[a.resonanceRisk] - riskRank[b.resonanceRisk];
  if (Math.abs(b.nearestHarmonic.separationPercent - a.nearestHarmonic.separationPercent) > 1e-9) return b.nearestHarmonic.separationPercent - a.nearestHarmonic.separationPercent;
  if (Math.abs(b.effectiveModalMassKg - a.effectiveModalMassKg) > 1e-9) return b.effectiveModalMassKg - a.effectiveModalMassKg;
  if (Math.abs(b.criticalBrazeCoverage - a.criticalBrazeCoverage) > 1e-9) return b.criticalBrazeCoverage - a.criticalBrazeCoverage;
  if (Math.abs(a.concentratedLoadMetric - b.concentratedLoadMetric) > 1e-9) return a.concentratedLoadMetric - b.concentratedLoadMetric;
  return a.totalPhysicalMassKg - b.totalPhysicalMassKg;
}

function roundDisplayedLayout(layout, pipe, operating, measuredNaturalHz, surfaceTempC, pressure, pressureUnit) {
  const roundedRings = layout.rings.map(r => {
    const stock = stockRingForMass(Math.round(r.massG / 5) * 5);
    return { ...r, massG: stock.massG, massKg: stock.massG / 1000, widthMM: stock.widthMM };
  }).sort((a, b) => a.x - b.x).map((r, i) => ({ ...r, ring: i + 1 }));
  const effectiveKg = roundedRings.reduce((sum, r) => sum + r.massKg * r.participationSquared, 0);
  const predictedHz = measuredNaturalHz * Math.sqrt(pipe.modalMass / (pipe.modalMass + effectiveKg));
  const risk = harmonicRisk(predictedHz, operating).nearest;
  const staticResult = staticCheck(pipe, roundedRings, surfaceTempC);
  const pressureResult = pressureScreening(pipe, pressure, pressureUnit, staticResult.stressPa);
  return { ...layout, rings: roundedRings, ringCount: roundedRings.length, totalPhysicalMassKg: roundedRings.reduce((s, r) => s + r.massKg, 0), effectiveModalMassKg: effectiveKg, predictedNaturalHz: predictedHz, nearestHarmonic: risk, resonanceRisk: risk.risk, staticResult, pressureResult, roundingVerification: staticResult.pass && risk.risk === 'Low' ? 'Displayed stock masses pass final static and resonance checks.' : 'Displayed stock masses require engineering review.' };
}

export function validateCircuitInputs(circuit, pipe, index) {
  const prefix = `Circuit ${index + 1}: `;
  const errors = [];
  const segmentNumbers = new Set();
  for (const [i, row] of circuit.route.entries()) {
    const len = toMM(row.length, row.unit);
    if (!(len > 0)) errors.push(`${prefix}segment ${i + 1} length must be greater than 0.`);
    if (!Number.isFinite(len)) errors.push(`${prefix}segment ${i + 1} length or unit is invalid.`);
    if (!DIRECTION_OPTIONS.includes(row.direction)) errors.push(`${prefix}segment ${i + 1} direction must be Right, Left, Up, Down, or Diagonal.`);
    const number = Number(row.number || i + 1);
    if (!Number.isInteger(number) || number <= 0) errors.push(`${prefix}segment ${i + 1} number is invalid.`);
    if (segmentNumbers.has(number)) errors.push(`${prefix}duplicate segment number ${number}.`);
    segmentNumbers.add(number);
    if (i === 0 && row.feature === 'compressor') errors.push(`${prefix}compressor connection is fixed at 0 mm and cannot be the first segment end feature.`);
  }
  const totalMM = routeLengthMM(circuit.route);
  if (!(totalMM > 0)) errors.push(`${prefix}total route length must be greater than 0.`);
  const measured = finite(circuit.operating.measuredNaturalHz, NaN);
  if (!(measured > 0)) errors.push(`${prefix}measured natural frequency is required.`);
  if (circuit.operating.speedType === 'variable') {
    const min = speedToHz(circuit.operating.minSpeed, circuit.operating.speedUnit);
    const max = speedToHz(circuit.operating.maxSpeed, circuit.operating.speedUnit);
    if (!(min > 0)) errors.push(`${prefix}variable-speed minimum is required.`);
    if (!(max > 0)) errors.push(`${prefix}variable-speed maximum is required.`);
    if (max < min) errors.push(`${prefix}variable-speed maximum is below minimum.`);
  } else if (!(speedToHz(circuit.operating.speed, circuit.operating.speedUnit) > 0)) errors.push(`${prefix}speed is required.`);
  const pc = pipeCalculations(pipe, totalMM);
  errors.push(...pc.errors.map(e => prefix + e));
  const manual = toMM(circuit.manualTotal, circuit.manualTotalUnit);
  if (Number.isFinite(manual) && manual > 0) {
    const diff = Math.abs(manual - totalMM) / totalMM * 100;
    if (diff > ENGINEERING_CONFIG.manualTotalTolerancePercent) errors.push(`${prefix}Route length mismatch. Check all segment lengths.`);
  }
  const trialConditions = new Set((circuit.measurements || []).map(m => String(m.condition || '').trim()).filter(Boolean));
  if (trialConditions.size > 1) errors.push(`${prefix}measurement rows cannot mix different trial conditions.`);
  for (const [i, m] of (circuit.measurements || []).entries()) {
    const x = toMM(m.distance, m.unit);
    if (x < 0) errors.push(`${prefix}measurement ${i + 1} position is below 0.`);
    if (x > totalMM) errors.push(`${prefix}measurement ${i + 1} position exceeds total route length.`);
  }
  for (const [i, trap] of (circuit.uTraps || []).entries()) {
    const sections = routeSections(circuit.route);
    const synced = segmentSelectedUTrapFeatures(trap, sections, totalMM);
    const selected = (trap.segments || trap.segmentNumbers || []).map(Number).filter(Number.isFinite);
    if (selected.length) {
      if (!synced) errors.push(`${prefix}U-trap ${i + 1} must select three consecutive route segments.`);
      continue;
    }
    const start = toMM(trap.start, trap.unit);
    const end = start + toMM(trap.p1, trap.unit) + toMM(trap.p2, trap.unit) + toMM(trap.p3, trap.unit);
    if (start < 0) errors.push(`${prefix}U-trap ${i + 1} start is below 0.`);
    if (end > totalMM) errors.push(`${prefix}U-trap ${i + 1} end exceeds total route length.`);
    if (trap.braze === 'custom') {
      const off = toMM(trap.customBrazeOffset, trap.unit);
      if (off < 0 || off > end - start) errors.push(`${prefix}custom U-trap braze offset is outside the U-trap.`);
    }
  }
  return errors;
}

export function calculateCircuit(circuitInput, pipeInput, index = 0) {
  const circuit = clone(circuitInput);
  const routeTotalMM = routeLengthMM(circuit.route);
  const errors = validateCircuitInputs(circuit, pipeInput, index);
  const record = { raw: { circuit, pipe: pipeInput }, errors, routeSumMM: routeTotalMM, generatedCandidates: [], movedCandidates: [], blockedIntervals: [], safeIntervals: [], candidateLayouts: [] };
  if (errors.length) return { circuitIndex: index, errors, record };
  const pipe = pipeCalculations(pipeInput, routeTotalMM);
  const points = dedupePoints([...routeFeatures(circuit.route, routeTotalMM), ...uTrapFeatures(circuit.uTraps, routeTotalMM, circuit.route)]);
  const maxRingWidth = Math.max(...RING_STOCK.map(r => r.widthMM));
  const blocked = blockedIntervals(points, routeTotalMM, maxRingWidth);
  const safe = safeIntervals(blocked, routeTotalMM);
  record.blockedIntervals = blocked;
  record.safeIntervals = safe;
  if (!safe.length) return { circuitIndex: index, errors: [`Circuit ${index + 1}: no safe ring location exists.`], record };
  circuit.measurements = (circuit.measurements || []).map(row => {
    const calculatedVgov = Math.max(finite(row.vertical), finite(row.horizontal));
    const calculatedV2D = Math.sqrt(finite(row.vertical) ** 2 + finite(row.horizontal) ** 2);
    return { ...row, featureDistanceMM: Number.isFinite(toMM(row.featureDistance ?? row.distance, row.unit)) ? toMM(row.featureDistance ?? row.distance, row.unit) : '', actualSensorDistanceMM: toMM(row.distance, row.unit), calculatedVgov, calculatedV2D, calculatedVmax: calculatedVgov, classification: classifyLocation(toMM(row.distance, row.unit), points) };
  });
  const brazeRows = circuit.measurements.filter(m => m.classification === FEATURES.braze);
  const worstBrazeVmax = brazeRows.reduce((max, m) => Math.max(max, m.calculatedVmax), 0);
  const freqs = screeningFrequencies(pipe);
  const measured = finite(circuit.operating.measuredNaturalHz);
  const nearestMode = nearestScreeningMode(measured, freqs);
  const mismatchPercent = Math.abs(nearestMode.frequencyHz - measured) / measured * 100;
  const currentRisk = harmonicRisk(measured, circuit.operating).nearest;
  const candidates = candidateLocations(routeTotalMM, nearestMode.mode, safe, points, circuit, circuit.route, record);
  if (!candidates.length) return { circuitIndex: index, errors: [`Circuit ${index + 1}: no safe ring location exists.`], record };
  const { layouts, selected } = evaluateLayouts({ pipe, candidates, operating: circuit.operating, measuredNaturalHz: measured, currentRisk, pressure: pipeInput.pressure, pressureUnit: pipeInput.pressureUnit, surfaceTempC: pipeInput.surfaceTempC, points, route: circuit.route, routeTotalMM, mode: nearestMode.mode, currentBrazeVmax: worstBrazeVmax, record });
  if (!selected) return { circuitIndex: index, errors: [`Circuit ${index + 1}: every layout fails static screening.`], record: { ...record, pipe, screeningFrequencies: freqs, currentRisk } };
  const rounded = roundDisplayedLayout(selected, pipe, circuit.operating, measured, pipeInput.surfaceTempC, pipeInput.pressure, pipeInput.pressureUnit);
  const finalValidation = validateFinalRecommendation(rounded, { routeTotalMM, route: circuit.route, points, pipe, operating: circuit.operating, measuredNaturalHz: measured, surfaceTempC: pipeInput.surfaceTempC, pressure: pipeInput.pressure, pressureUnit: pipeInput.pressureUnit });
  rounded.finalValidation = finalValidation;
  if (!finalValidation.pass) return { circuitIndex: index, errors: [`Circuit ${index + 1}: NO PHYSICALLY VALID SAFE CONFIGURATION FOUND.`], record: { ...record, pipe, screeningFrequencies: freqs, currentRisk, finalValidation } };
  const warning = mismatchPercent > 20 ? 'Measured and screening frequencies differ significantly. Measured frequency is used for design; candidate locations require field confirmation.' : '';
  const brazeWarning = worstBrazeVmax >= BRAZE_TARGET_MM_S ? 'Braze vibration exceeds the 5 mm/s target. The calculated layout requires field verification after installation.' : '';
  const result = {
    circuitIndex: index,
    title: `Circuit ${index + 1} Recommendation`,
    routeTotalMM,
    pipe,
    measurements: circuit.measurements,
    screeningFrequencies: freqs,
    nearestScreeningMode: nearestMode,
    measuredToScreeningMismatchPercent: mismatchPercent,
    mismatchWarning: warning,
    currentRisk,
    selectedLayout: rounded,
    allLayouts: layouts,
    worstBrazeVmax,
    brazeWarning,
    requiredFinalText: 'Calculated recommendation. Confirm braze-joint vibration after installation. Target: below 5 mm/s RMS.',
    pressureNotice: rounded.pressureResult.note || 'Pressure screening not completed',
    record: { ...record, pipe, screeningFrequencies: freqs, measuredToScreeningMismatchPercent: mismatchPercent, harmonics: harmonicRisk(measured, circuit.operating).harmonics, currentRisk, finalSelectionReason: rounded.rankingReasons, roundingVerification: rounded.roundingVerification }
  };
  return { circuitIndex: index, errors: [], result, record: result.record };
}

export function calculateUnit(state) {
  if (isSerialLikeModel(state.unit.unitModel)) return { errors: ['Unit Model looks like a serial identifier. Enter the actual model number before saving or calculating.'], results: [] };
  const synced = syncSameGeometry(state);
  const results = [];
  const errors = [];
  synced.circuits.forEach((c, i) => {
    const out = calculateCircuit(c, synced.pipe, i);
    if (out.errors.length) errors.push(...out.errors);
    if (out.result) results.push(out.result);
  });
  return { errors, results, state: synced };
}

export function buildEngineeringRecordText(result) {
  const r = result.record;
  const lines = [];
  lines.push('Full Engineering Record');
  lines.push(`Route sum: ${round(result.routeTotalMM, 3)} mm`);
  lines.push(`Pipe area: ${round(result.pipe.area, 10)} m^2`);
  lines.push(`Second moment of area: ${round(result.pipe.I, 14)} m^4`);
  lines.push(`Mass per unit length: ${round(result.pipe.mPrime, 6)} kg/m`);
  lines.push(`Total pipe mass: ${round(result.pipe.totalMass, 6)} kg`);
  lines.push(`Screening modal mass approximation: ${round(result.pipe.modalMass, 6)} kg`);
  lines.push(`Screening frequencies: ${result.screeningFrequencies.map(f => `Mode ${f.mode}=${round(f.frequencyHz, 4)} Hz`).join(', ')}`);
  lines.push(`Measured-to-screening mismatch: ${round(result.measuredToScreeningMismatchPercent, 3)}%`);
  lines.push(`Harmonics: ${r.harmonics.map(h => `${h.order}X ${h.bandHz ? round(h.bandHz[0], 4) + '-' + round(h.bandHz[1], 4) : round(h.frequencyHz, 4)} Hz sep ${round(h.separationPercent, 3)}% ${h.risk}`).join('; ')}`);
  lines.push(`Current risk: ${r.currentRisk.risk}, ${round(r.currentRisk.separationPercent, 3)}%`);
  lines.push(`Blocked intervals: ${JSON.stringify(r.blockedIntervals)}`);
  lines.push(`Safe intervals: ${JSON.stringify(r.safeIntervals)}`);
  lines.push(`Generated candidate locations: ${JSON.stringify(r.generatedCandidates)}`);
  lines.push(`Moved candidate locations: ${JSON.stringify(r.movedCandidates)}`);
  lines.push(`Tested mass ratios: ${r.testedMassRatios.map(x => round(x * 100, 1) + '%').join(', ')}`);
  lines.push(`Iterative mass-search outcome: ${r.iterativeMassSearchOutcome}`);
  lines.push(`Every candidate layout: ${JSON.stringify(r.candidateLayouts.map(l => ({ layout: l.label, rings: l.rings, totalPhysicalMassKg: l.totalPhysicalMassKg, effectiveModalMassKg: l.effectiveModalMassKg, predictedNaturalHz: l.predictedNaturalHz, risk: l.resonanceRisk, static: l.staticResult, pressure: l.pressureResult.status, dynamic: l.dynamicStatus, rejectionReasons: l.rejectionReasons })))}`);
  lines.push(`Final selection reason: ${result.selectedLayout.rankingReasons.join(' ')}`);
  lines.push(`Rounding verification: ${result.selectedLayout.roundingVerification}`);
  return lines.join('\n');
}

export function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : NaN;
}

export function assertNoBadVisibleValues(text) {
  return !/\b(NaN|Infinity|undefined)\b/.test(String(text));
}
