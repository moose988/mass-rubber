import { SCHEMA_VERSION, clone, isSerialLikeModel, syncSameGeometry } from './worker-engine.js';

export const UNIT_RECORDS_KEY = 'daham_worker_unit_records_v2';
export const MODEL_PIPE_KEY = 'daham_worker_model_pipe_data_v2';

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function saveModelPipeData(storage, unitModel, pipe, confirmReplace = () => true) {
  const model = String(unitModel || '').trim();
  if (!model) return { saved: false, reason: 'Unit Model is required.' };
  if (isSerialLikeModel(model)) return { saved: false, reason: 'Unit Model looks like a serial identifier.' };
  const all = readJson(storage, MODEL_PIPE_KEY, {});
  if (all[model] && !confirmReplace(model)) return { saved: false, reason: 'Replacement cancelled.' };
  all[model] = { schemaVersion: SCHEMA_VERSION, model, pipe: clone(pipe), savedAt: new Date().toISOString() };
  writeJson(storage, MODEL_PIPE_KEY, all);
  return { saved: true, record: all[model] };
}

export function getModelPipeData(storage, unitModel) {
  const model = String(unitModel || '').trim();
  const all = readJson(storage, MODEL_PIPE_KEY, {});
  const record = all[model];
  if (!record || record.schemaVersion !== SCHEMA_VERSION) return null;
  return clone(record.pipe);
}

export function listUnitRecords(storage) {
  return readJson(storage, UNIT_RECORDS_KEY, []).filter(r => r.schemaVersion === SCHEMA_VERSION);
}

export function saveUnitRecord(storage, state, results, confirmReplace = () => true) {
  const unitNumber = String(state.unit.unitNumber || '').trim();
  const unitModel = String(state.unit.unitModel || '').trim();
  if (!unitNumber) return { saved: false, reason: 'Unit Number is required.' };
  if (!unitModel) return { saved: false, reason: 'Unit Model is required.' };
  if (isSerialLikeModel(unitModel)) return { saved: false, reason: 'Unit Model looks like a serial identifier.' };
  const records = listUnitRecords(storage);
  const id = `${unitNumber}__${unitModel}`;
  const existing = records.find(r => r.id === id);
  if (existing && !confirmReplace(id)) return { saved: false, reason: 'Replacement cancelled.' };
  const synced = syncSameGeometry(state);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id,
    unit: clone(synced.unit),
    unitNumber,
    unitModel,
    date: synced.unit.date,
    tester: synced.unit.testerName,
    circuitCount: synced.unit.circuitCount,
    sameGeometry: synced.sameGeometry,
    modelPipeData: clone(synced.pipe),
    circuits: synced.circuits.map(c => clone(c)),
    recommendations: compactRecommendations(results),
    savedAt: new Date().toISOString()
  };
  const next = records.filter(r => r.id !== id);
  next.push(record);
  writeJson(storage, UNIT_RECORDS_KEY, next);
  saveModelPipeData(storage, unitModel, synced.pipe, confirmReplace);
  return { saved: true, record };
}

function compactRecommendations(results) {
  return (results || []).map(result => ({
    circuitIndex: result.circuitIndex,
    title: result.title,
    routeTotalMM: result.routeTotalMM,
    measurements: clone(result.measurements),
    screeningFrequencies: clone(result.screeningFrequencies),
    measuredToScreeningMismatchPercent: result.measuredToScreeningMismatchPercent,
    mismatchWarning: result.mismatchWarning,
    currentRisk: clone(result.currentRisk),
    selectedLayout: clone(result.selectedLayout),
    worstBrazeVmax: result.worstBrazeVmax,
    brazeWarning: result.brazeWarning,
    requiredFinalText: result.requiredFinalText,
    pressureNotice: result.pressureNotice,
    engineeringRecord: {
      routeSumMM: result.record?.routeSumMM,
      blockedIntervals: clone(result.record?.blockedIntervals || []),
      safeIntervals: clone(result.record?.safeIntervals || []),
      generatedCandidates: clone(result.record?.generatedCandidates || []),
      movedCandidates: clone(result.record?.movedCandidates || []),
      testedMassRatios: clone(result.record?.testedMassRatios || []),
      iterativeMassSearchOutcome: result.record?.iterativeMassSearchOutcome,
      finalSelectionReason: clone(result.record?.finalSelectionReason || []),
      roundingVerification: result.record?.roundingVerification
    }
  }));
}

export function loadUnitRecord(storage, id) {
  const record = listUnitRecords(storage).find(r => r.id === id);
  return record ? clone(record) : null;
}

export function exportSavedData(storage) {
  const modelPipeData = readJson(storage, MODEL_PIPE_KEY, {});
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    unitRecords: listUnitRecords(storage),
    modelPipeData
  };
}

export function importSavedData(storage, payload, confirmReplace = () => true) {
  if (!payload || payload.schemaVersion !== SCHEMA_VERSION) return { imported: false, reason: 'Backup file is not compatible with this app version.' };
  const incomingRecords = Array.isArray(payload.unitRecords) ? payload.unitRecords.filter(r => r.schemaVersion === SCHEMA_VERSION && r.id) : [];
  const currentRecords = listUnitRecords(storage);
  const recordMap = new Map(currentRecords.map(r => [r.id, r]));
  let unitCount = 0;
  for (const record of incomingRecords) {
    if (recordMap.has(record.id) && !confirmReplace(`unit ${record.unitNumber} / ${record.unitModel}`)) continue;
    recordMap.set(record.id, clone(record));
    unitCount += 1;
  }

  const currentModels = readJson(storage, MODEL_PIPE_KEY, {});
  const incomingModels = payload.modelPipeData && typeof payload.modelPipeData === 'object' ? payload.modelPipeData : {};
  let modelCount = 0;
  for (const [model, record] of Object.entries(incomingModels)) {
    if (!record || record.schemaVersion !== SCHEMA_VERSION) continue;
    if (currentModels[model] && !confirmReplace(`model pipe data for ${model}`)) continue;
    currentModels[model] = clone(record);
    modelCount += 1;
  }

  writeJson(storage, UNIT_RECORDS_KEY, [...recordMap.values()]);
  writeJson(storage, MODEL_PIPE_KEY, currentModels);
  return { imported: true, unitCount, modelCount };
}

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    clear: () => data.clear()
  };
}
