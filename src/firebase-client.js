import { firebaseConfig } from './firebase-config.js';

const SDK_VERSION = '10.12.5';
let apiPromise;
function configured() { return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId); }
async function api() {
  if (!configured()) throw new Error('Firebase is not configured in this deployment.');
  if (!apiPromise) apiPromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
  ]).then(([app, auth, firestore]) => ({ auth, firestore, app: app.initializeApp(firebaseConfig) }));
  return apiPromise;
}
async function services() { const a = await api(); return { ...a, authInstance: a.auth.getAuth(a.app), db: a.firestore.getFirestore(a.app) }; }
export async function signIn(email, password) { const s = await services(); return s.auth.signInWithEmailAndPassword(s.authInstance, email, password); }
export async function signOut() { const s = await services(); return s.auth.signOut(s.authInstance); }
export async function observeAuth(callback) { const s = await services(); return s.auth.onAuthStateChanged(s.authInstance, callback); }
export async function profile(uid) { const s = await services(); const snap = await s.firestore.getDoc(s.firestore.doc(s.db, 'users', uid)); if (!snap.exists()) throw new Error('Your authenticated user has no authorized profile. Ask an administrator to create users/{uid}.'); return { uid, ...snap.data() }; }
export async function approvedRecipes(scopeId) {
  if (!scopeId) throw new Error('No authorized scope is assigned to this user.');
  const s = await services();
  // Firestore rules evaluate a query as a whole.  The query must prove the same
  // scope predicate required by the rule, not merely filter it after reading.
  const q = s.firestore.query(s.firestore.collection(s.db, 'recipes'), s.firestore.where('approved', '==', true), s.firestore.where('scopeId', '==', scopeId));
  return (await s.firestore.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function saveTestRecord(record) { const s = await services(); return s.firestore.addDoc(s.firestore.collection(s.db, 'unit_records'), { ...record, savedAt: new Date().toISOString() }); }
