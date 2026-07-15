import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['index.html', 'src'];
const forbiddenVisible = [
  'Load Current Unit Case',
  'Download Saved CSV',
  'Clear Saved Data',
  'Load Trial Data',
  'Load Example',
  'Load New Circuit Example',
  'Load Two-Circuit Example',
  'Save Pipe Data for This Model',
  'Load Saved Pipe Data for This Model',
  'pipe-size preset',
  'single-ring-only',
  'before/after validation'
];

function files(path) {
  const s = statSync(path);
  if (s.isFile()) return [path];
  return readdirSync(path).flatMap(name => files(join(path, name)));
}

let failed = false;
for (const file of roots.flatMap(files)) {
  const text = readFileSync(file, 'utf8');
  for (const needle of forbiddenVisible) {
    if (text.toLowerCase().includes(needle.toLowerCase())) {
      console.error(`${file}: forbidden legacy string "${needle}"`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('Source check passed.');
