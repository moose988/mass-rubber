import { accessSync, readFileSync } from 'node:fs';

accessSync('index.html');
accessSync('src/worker-engine.js');
accessSync('src/worker-persistence.js');
const html = readFileSync('index.html', 'utf8');
if (!html.includes('type="module"')) throw new Error('Production page must load module code.');
if (!html.includes('./src/worker-engine.js')) throw new Error('Production page does not import the worker engine.');
console.log('Static production build check passed. Output directory: repository root. Entry: index.html');
