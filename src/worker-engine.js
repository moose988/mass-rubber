export const SCHEMA_VERSION = 2;
export const BRAZE_TARGET_MM_S = 5;
export const CLEARANCE_MM = 30;
const G = 9.80665;
const COPPER = { density: 8940, young: 110e9, poisson: 0.34 };
const LAMBDAS = [Math.PI, 2 * Math.PI, 3 * Math.PI];
const MASS_RATIOS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
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
  return n;
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
    route: [{ length: '', unit: 'mm', direction: 'Straight', feature: index === 0 ? 'compressor' : 'none', notes: '' }],
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

function routeFeatures(route, totalMM) {
  const points = [{ x: 0, type: 'compressor', label: FEATURES.compressor, segment: 1 }];
  let pos = 0;
  route.forEach((row, i) => {
    pos += toMM(row.length, row.unit);
    const type = row.feature || 'none';
    if (type !== 'none') points.push({ x: Math.min(pos, totalMM), type, label: FEATURES[type] || FEATURES.other, segment: i + 1 });
  });
  return points;
}

function uTrapFeatures(uTraps, totalMM) {
  const points = [];
  for (const trap of uTraps || []) {
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
  return points;
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

function blockedIntervals(points, totalMM) {
  return mergeIntervals(points.map(p => ({
    start: Math.max(0, p.x - CLEARANCE_MM),
    end: Math.min(totalMM, p.x + CLEARANCE_MM),
    label: `${p.label} at ${round(p.x, 1)} mm`
  })));
}

function safeIntervals(blocked, totalMM) {
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
    const risk = separationPercent < 5 ? 'Critical' : separationPercent < 10 ? 'High' : separationPercent < 20 ? 'Medium' : 'Low';
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
    if (x <= next + 1e-6) return { segment: i + 1, direction: route[i].direction || 'Straight', startMM: pos, endMM: next };
    pos = next;
  }
  return { segment: route.length, direction: 'Straight', startMM: pos, endMM: pos };
}

function nearestFeatureClearance(x, points) {
  if (!points.length) return Infinity;
  return Math.min(...points.map(p => Math.abs(p.x - x)));
}

function candidateLocations(totalMM, mode, safe, points, circuit, record) {
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
  const candidates = [];
  for (const item of raw) {
    const ns = nearestSafe(Math.max(0, Math.min(totalMM, item.x)), safe);
    if (!ns) continue;
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

function buildRings(layoutName, candidates, ratio, modalMass) {
  const sorted = [...candidates].sort((a, b) => b.participationSquared - a.participationSquared);
  if (!sorted.length) return [];
  if (layoutName === 'A') return [{ ...sorted[0], massKg: modalMass * ratio }];
  if (layoutName === 'B') return sorted.slice(0, 2).map(c => ({ ...c, massKg: modalMass * ratio / 2 }));
  if (layoutName === 'C') {
    const main = sorted[0];
    const local = candidates.find(c => c.local) || sorted[1] || sorted[0];
    return [{ ...main, massKg: modalMass * ratio * 0.72 }, { ...local, massKg: modalMass * ratio * 0.28, localCorrective: true }];
  }
  if (layoutName === 'D') return sorted.slice(0, 3).map(c => ({ ...c, massKg: modalMass * ratio / Math.min(3, sorted.length) }));
  return sorted.slice(0, 3).map(c => ({ ...c, massKg: modalMass * ratio * 1.2 / Math.min(3, sorted.length) }));
}

function evaluateLayouts({ pipe, candidates, operating, measuredNaturalHz, currentRisk, pressure, pressureUnit, surfaceTempC, points, route, currentBrazeVmax, record }) {
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
      const effectiveKg = rings.reduce((sum, r) => sum + r.massKg * r.participationSquared, 0);
      const predictedHz = measuredNaturalHz * Math.sqrt(pipe.modalMass / (pipe.modalMass + effectiveKg));
      const afterRisk = harmonicRisk(predictedHz, operating).nearest;
      const staticResult = staticCheck(pipe, rings, surfaceTempC);
      const pressureResult = pressureScreening(pipe, pressure, pressureUnit, staticResult.stressPa);
      const criticalBrazeCoverage = rings.reduce((best, r) => Math.max(best, r.localCorrective ? 1 : 0.5 / Math.max(1, nearestFeatureClearance(r.x, points.filter(p => p.type === 'braze')) / CLEARANCE_MM)), 0);
      const concentratedLoadMetric = Math.max(...rings.map(r => r.massKg)) / Math.max(0.000001, rings.reduce((s, r) => s + r.massKg, 0));
      const rejectionReasons = [];
      if (!staticResult.pass) rejectionReasons.push(staticResult.rejectionReason);
      if (afterRisk.risk !== 'Low') rejectionReasons.push('after-layout resonance risk is not Low');
      const layout = {
        layout: name,
        label: layoutLabels[name],
        ratio,
        rings: rings.map((r, i) => ({ ring: i + 1, massKg: r.massKg, massG: r.massKg * 1000, x: r.x, participation: r.participation, participationSquared: r.participationSquared, localCorrective: !!r.localCorrective, section: routeSection(r.x, route), nearbyFeature: classifyLocation(r.x, points), clearanceMM: nearestFeatureClearance(r.x, points) })),
        ringCount: rings.length,
        totalPhysicalMassKg: rings.reduce((s, r) => s + r.massKg, 0),
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
      layouts.push(layout);
    }
  }
  MASS_RATIOS.forEach(pushForRatio);
  let valid = layouts.filter(l => l.staticResult.pass && l.resonanceRisk === 'Low');
  let iterativeOutcome = 'Not needed; at least one standard ratio reached Low risk.';
  if (!valid.length) {
    for (let pct = 1; pct <= 100; pct += 0.1) {
      const ratio = Number((pct / 100).toFixed(4));
      testedRatios.push(ratio);
      pushForRatio(ratio);
      valid = layouts.filter(l => l.staticResult.pass && l.resonanceRisk === 'Low');
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
  const roundedRings = layout.rings.map(r => ({ ...r, massG: Math.round(r.massG / 5) * 5, massKg: Math.round(r.massG / 5) * 5 / 1000 }));
  const effectiveKg = roundedRings.reduce((sum, r) => sum + r.massKg * r.participationSquared, 0);
  const predictedHz = measuredNaturalHz * Math.sqrt(pipe.modalMass / (pipe.modalMass + effectiveKg));
  const risk = harmonicRisk(predictedHz, operating).nearest;
  const staticResult = staticCheck(pipe, roundedRings, surfaceTempC);
  const pressureResult = pressureScreening(pipe, pressure, pressureUnit, staticResult.stressPa);
  return { ...layout, rings: roundedRings, effectiveModalMassKg: effectiveKg, predictedNaturalHz: predictedHz, nearestHarmonic: risk, resonanceRisk: risk.risk, staticResult, pressureResult, roundingVerification: staticResult.pass && risk.risk === 'Low' ? 'Displayed rounded masses pass final static and resonance checks.' : 'Displayed rounded masses require engineering review.' };
}

export function validateCircuitInputs(circuit, pipe, index) {
  const prefix = `Circuit ${index + 1}: `;
  const errors = [];
  for (const [i, row] of circuit.route.entries()) {
    const len = finite(row.length, NaN);
    if (!(len > 0)) errors.push(`${prefix}segment ${i + 1} length must be greater than 0.`);
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
    if (diff > 2) errors.push(`${prefix}Route length mismatch. Check all segment lengths.`);
  }
  for (const [i, m] of (circuit.measurements || []).entries()) {
    const x = toMM(m.distance, m.unit);
    if (x < 0) errors.push(`${prefix}measurement ${i + 1} position is below 0.`);
    if (x > totalMM) errors.push(`${prefix}measurement ${i + 1} position exceeds total route length.`);
  }
  for (const [i, trap] of (circuit.uTraps || []).entries()) {
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
  const points = [...routeFeatures(circuit.route, routeTotalMM), ...uTrapFeatures(circuit.uTraps, routeTotalMM)];
  const blocked = blockedIntervals(points, routeTotalMM);
  const safe = safeIntervals(blocked, routeTotalMM);
  record.blockedIntervals = blocked;
  record.safeIntervals = safe;
  if (!safe.length) return { circuitIndex: index, errors: [`Circuit ${index + 1}: no safe ring location exists.`], record };
  circuit.measurements = (circuit.measurements || []).map(row => ({ ...row, calculatedVmax: Math.max(finite(row.vertical), finite(row.horizontal)), classification: classifyLocation(toMM(row.distance, row.unit), points) }));
  const brazeRows = circuit.measurements.filter(m => m.classification === FEATURES.braze);
  const worstBrazeVmax = brazeRows.reduce((max, m) => Math.max(max, m.calculatedVmax), 0);
  const freqs = screeningFrequencies(pipe);
  const measured = finite(circuit.operating.measuredNaturalHz);
  const nearestMode = nearestScreeningMode(measured, freqs);
  const mismatchPercent = Math.abs(nearestMode.frequencyHz - measured) / measured * 100;
  const currentRisk = harmonicRisk(measured, circuit.operating).nearest;
  const candidates = candidateLocations(routeTotalMM, nearestMode.mode, safe, points, circuit, record);
  if (!candidates.length) return { circuitIndex: index, errors: [`Circuit ${index + 1}: no safe ring location exists.`], record };
  const { layouts, selected } = evaluateLayouts({ pipe, candidates, operating: circuit.operating, measuredNaturalHz: measured, currentRisk, pressure: pipeInput.pressure, pressureUnit: pipeInput.pressureUnit, surfaceTempC: pipeInput.surfaceTempC, points, route: circuit.route, currentBrazeVmax: worstBrazeVmax, record });
  if (!selected) return { circuitIndex: index, errors: [`Circuit ${index + 1}: every layout fails static screening.`], record: { ...record, pipe, screeningFrequencies: freqs, currentRisk } };
  const rounded = roundDisplayedLayout(selected, pipe, circuit.operating, measured, pipeInput.surfaceTempC, pipeInput.pressure, pipeInput.pressureUnit);
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
  return !/\b(NaN|Infinity|undefined|null)\b/.test(String(text));
}
