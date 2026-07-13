import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle' });

const buttons = await page.locator('.topbar button').allTextContents();
if (buttons.join('|') !== 'Reset Form|Calculate Recommendation|Save Unit') throw new Error(`Unexpected top buttons: ${buttons.join(', ')}`);
const duplicateIds = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
  return ids.filter((id, index) => ids.indexOf(id) !== index);
});
if (duplicateIds.length) throw new Error(`Duplicate DOM ids: ${duplicateIds.join(', ')}`);

await page.fill('#unitNumber', 'U-PLAY-1');
await page.fill('#unitModel', 'PLAY-900');
await page.fill('#testerName', 'Browser QA');
await page.fill('#pipe_od', '0.875');
await page.selectOption('#pipe_odUnit', 'inch');
await page.fill('#pipe_thickness', '0.045');
await page.selectOption('#pipe_thicknessUnit', 'inch');
await page.fill('#pipe_pressure', '250');
await page.selectOption('#pipe_pressureUnit', 'psi');

async function fillCircuitOne() {
  const rows = [4, 12, 3, 7, 4, 4.75, 10, 4.5];
  for (let i = 1; i < rows.length; i++) await page.click('button[data-action="add-route"][data-ci="0"]');
  for (let i = 0; i < rows.length; i++) {
    await page.fill(`input[data-ci="0"][data-ri="${i}"][data-field="length"]`, String(rows[i]));
    await page.selectOption(`select[data-ci="0"][data-ri="${i}"][data-field="unit"]`, 'inch');
    if (i === 0) await page.selectOption(`select[data-ci="0"][data-ri="${i}"][data-field="feature"]`, 'compressor');
    if (i === rows.length - 1) await page.selectOption(`select[data-ci="0"][data-ri="${i}"][data-field="feature"]`, 'condenser');
  }
  await page.fill('#op_0_speed', '700');
  await page.selectOption('#op_0_speedUnit', 'RPM');
  await page.fill('#op_0_measuredNaturalHz', '35');
  await page.fill('#op_0_operatingDominantHz', '35');
  await page.fill('#op_0_peakVelocity', '6');
  await page.fill('#op_0_highestLocationDistance', '24');
  await page.selectOption('#op_0_highestLocationUnit', 'inch');
  await page.click('button[data-action="add-measurement"][data-ci="0"]');
  await page.fill('input[data-ci="0"][data-mi="0"][data-m="name"]', 'Endpoint braze');
  await page.fill('input[data-ci="0"][data-mi="0"][data-m="distance"]', '49.25');
  await page.selectOption('select[data-ci="0"][data-mi="0"][data-m="unit"]', 'inch');
  await page.fill('input[data-ci="0"][data-mi="0"][data-m="vertical"]', '4.5');
  await page.fill('input[data-ci="0"][data-mi="0"][data-m="horizontal"]', '3.2');
}

await fillCircuitOne();
await page.click('#calculateBtn');
await page.waitForSelector('.result-card');
if (!await page.locator('text=Circuit 1 Recommendation').count()) throw new Error('Circuit 1 result not shown');
await page.click('#saveBtn');
await page.selectOption('#circuitCount', '4');
await page.selectOption('#sameGeometry', 'no');
await page.selectOption('#circuitCount', '1');
await page.selectOption('#circuitCount', '4');
await page.selectOption('#sameGeometry', 'yes');
await page.selectOption('#sameGeometry', 'no');
await page.setViewportSize({ width: 390, height: 820 });
await page.waitForTimeout(100);
await page.click('#resetBtn');

if (consoleErrors.length || pageErrors.length) {
  throw new Error(`Console/page errors: ${[...consoleErrors, ...pageErrors].join(' | ')}`);
}
await browser.close();
console.log('Browser verification passed.');
