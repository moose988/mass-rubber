import { firebaseCollectionPrefix, firebaseConfig } from './firebase-config.js';
import {
  getModelPipeData as getLocalModelPipeData,
  listUnitRecords as listLocalUnitRecords,
  loadUnitRecord as loadLocalUnitRecord,
  UNIT_RECORDS_KEY,
  saveModelPipeData as saveLocalModelPipeData,
  saveUnitRecord as saveLocalUnitRecord
} from './worker-persistence.js';

const SDK_VERSION = '10.12.5';

let initPromise;
let cloudState = { enabled: false, reason: 'Firebase is not configured.' };

function hasFirebaseConfig() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function cleanId(id) {
  return String(id || '').replaceAll('/', '_').trim();
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) next[key] = stripUndefined(item);
  }
  return next;
}

async function initCloud() {
  if (!hasFirebaseConfig()) return null;
  if (!initPromise) {
    initPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
    ]).then(([app, firestore]) => {
      const firebaseApp = app.initializeApp(firebaseConfig);
      const db = firestore.getFirestore(firebaseApp);
      cloudState = { enabled: true, reason: '' };
      return { db, firestore };
    }).catch(error => {
      cloudState = { enabled: false, reason: `Firebase unavailable: ${error.message}` };
      return null;
    });
  }
  return initPromise;
}

function unitCollection(api) {
  return api.firestore.collection(api.db, `${firebaseCollectionPrefix}_unit_records`);
}

function modelCollection(api) {
  return api.firestore.collection(api.db, `${firebaseCollectionPrefix}_model_pipe_data`);
}

export function getCloudPersistenceStatus() {
  return { ...cloudState };
}

export async function warmCloudPersistence() {
  await initCloud();
  return getCloudPersistenceStatus();
}

export async function listUnitRecords(storage) {
  const api = await initCloud();
  if (!api) return listLocalUnitRecords(storage);

  try {
    const snapshot = await api.firestore.getDocs(api.firestore.query(unitCollection(api), api.firestore.orderBy('savedAt', 'desc')));
    const records = snapshot.docs.map(doc => doc.data()).filter(record => record && record.id);
    if (records.length) storage.setItem(UNIT_RECORDS_KEY, JSON.stringify(records));
    return records;
  } catch (error) {
    cloudState = { enabled: false, reason: `Firebase read failed: ${error.message}` };
    return listLocalUnitRecords(storage);
  }
}

export async function loadUnitRecord(storage, id) {
  const api = await initCloud();
  if (!api) return loadLocalUnitRecord(storage, id);

  try {
    const ref = api.firestore.doc(unitCollection(api), cleanId(id));
    const snapshot = await api.firestore.getDoc(ref);
    return snapshot.exists() ? snapshot.data() : loadLocalUnitRecord(storage, id);
  } catch (error) {
    cloudState = { enabled: false, reason: `Firebase read failed: ${error.message}` };
    return loadLocalUnitRecord(storage, id);
  }
}

export async function saveUnitRecord(storage, state, results, confirmReplace = () => true) {
  const saved = saveLocalUnitRecord(storage, state, results, confirmReplace);
  if (!saved.saved) return saved;

  const api = await initCloud();
  if (!api) return { ...saved, cloudSaved: false, cloudReason: cloudState.reason };

  try {
    await api.firestore.setDoc(api.firestore.doc(unitCollection(api), cleanId(saved.record.id)), stripUndefined(saved.record));
    await saveModelPipeData(storage, saved.record.unitModel, saved.record.modelPipeData, () => true);
    return { ...saved, cloudSaved: true };
  } catch (error) {
    cloudState = { enabled: false, reason: `Firebase save failed: ${error.message}` };
    return { ...saved, cloudSaved: false, cloudReason: cloudState.reason };
  }
}

export async function getModelPipeData(storage, unitModel) {
  const model = String(unitModel || '').trim();
  const api = await initCloud();
  if (!api) return getLocalModelPipeData(storage, model);

  try {
    const snapshot = await api.firestore.getDoc(api.firestore.doc(modelCollection(api), cleanId(model)));
    return snapshot.exists() ? snapshot.data().pipe : getLocalModelPipeData(storage, model);
  } catch (error) {
    cloudState = { enabled: false, reason: `Firebase read failed: ${error.message}` };
    return getLocalModelPipeData(storage, model);
  }
}

export async function saveModelPipeData(storage, unitModel, pipe, confirmReplace = () => true) {
  const saved = saveLocalModelPipeData(storage, unitModel, pipe, confirmReplace);
  if (!saved.saved) return saved;

  const api = await initCloud();
  if (!api) return { ...saved, cloudSaved: false, cloudReason: cloudState.reason };

  try {
    await api.firestore.setDoc(api.firestore.doc(modelCollection(api), cleanId(saved.record.model)), stripUndefined(saved.record));
    return { ...saved, cloudSaved: true };
  } catch (error) {
    cloudState = { enabled: false, reason: `Firebase save failed: ${error.message}` };
    return { ...saved, cloudSaved: false, cloudReason: cloudState.reason };
  }
}
