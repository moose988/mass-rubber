import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('Firestore rules deny unauthenticated catch-all access and protect approvals',()=>{const r=readFileSync('firestore.rules','utf8');assert.match(r,/match \/\{document=\*\*\}/);assert.match(r,/allow read, write: if false/);assert.match(r,/function engineer/);assert.match(r,/resource.data.approved == true/);});
