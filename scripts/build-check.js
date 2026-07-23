import { accessSync, readFileSync } from 'node:fs';

accessSync('index.html');
accessSync('src/worker-engine.js');
accessSync('src/worker-persistence.js');
accessSync('src/cloud-persistence.js');
accessSync('src/firebase-config.js');
accessSync('src/firebase-client.js');
accessSync('src/app.js');
const html = readFileSync('index.html', 'utf8');
if (!html.includes('type="module"')) throw new Error('Production page must load module code.');
if (!html.includes('./src/app.js')) throw new Error('Production page does not import application code.');
console.log('Static production build check passed. Output directory: repository root. Entry: index.html');
