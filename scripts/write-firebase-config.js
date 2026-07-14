import { writeFileSync } from 'node:fs';

function pick(name) {
  return process.env[`FIREBASE_${name}`]
    || process.env[`NEXT_PUBLIC_FIREBASE_${name}`]
    || process.env[`VITE_FIREBASE_${name}`]
    || '';
}

const config = {
  apiKey: pick('API_KEY'),
  authDomain: pick('AUTH_DOMAIN'),
  projectId: pick('PROJECT_ID'),
  storageBucket: pick('STORAGE_BUCKET'),
  messagingSenderId: pick('MESSAGING_SENDER_ID'),
  appId: pick('APP_ID')
};

const collectionPrefix = process.env.FIREBASE_COLLECTION_PREFIX || 'daham_worker';

const file = `export const firebaseConfig = ${JSON.stringify(config, null, 2)};

export const firebaseCollectionPrefix = ${JSON.stringify(collectionPrefix)};
`;

writeFileSync('src/firebase-config.js', file);
console.log(config.projectId ? `Firebase config generated for ${config.projectId}.` : 'Firebase config not set; cloud sync will stay disabled.');
