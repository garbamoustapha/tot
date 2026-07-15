// test-arena-e2e.mjs — Test end-to-end (Playwright) de l'arène en ligne.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Gabera/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.js');

const BASE = 'http://localhost:5079';
const errors = [];
const logs = [];

const browser = await chromium.launch({
  executablePath: 'C:/Users/Gabera/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
});
const page = await browser.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

const result = { connText: null, iconCount: 0, top6: null, submitted: false, signalR: null, iconSelected: 0, banner: '' };
try {
  await page.goto(BASE + '/arena.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  result.signalR = await page.evaluate(() => typeof window.signalR);
  result.connText = await page.textContent('#connText');
  result.iconCount = await page.$$eval('#iconGrid .icon-cell', (e) => e.length);

  // Soumission (clic icône via locator = vrai événement, pas .click() JS)
  await page.fill('#playerName', 'Grace');
  await page.fill('#algoName', 'PavlovGrace');
  await page.locator('.icon-cell[data-id="gem"]').click();
  result.iconSelected = await page.locator('.icon-cell[aria-checked="true"]').count();
  await page.click('#submitBtn');
  await page.waitForTimeout(1800);
  result.banner = (await page.textContent('#statusBanner')) || '';
  result.submitted = /enregistrée|ok/i.test(result.banner);

  // Déclenche le tournoi
  await page.click('#triggerBtn');
  await page.waitForFunction(() => document.querySelectorAll('#arenaRanking tbody tr').length >= 5, { timeout: 25000 })
    .catch(() => {});
  result.top6 = await page.$$eval('#arenaRanking tbody tr', (trs) => trs.slice(0, 6).map((tr) => ({
    rank: tr.querySelector('.rank-cell')?.textContent.trim(),
    name: tr.querySelector('.strat-name')?.textContent.trim(),
    player: tr.querySelector('.player-name')?.textContent.trim() || '',
  }))).catch(() => null);
  await page.screenshot({ path: 'D:/tot/app/shot-arena.png' }).catch(() => {});
} catch (e) {
  errors.push('fatal: ' + e.message);
} finally {
  console.log('signalR =', result.signalR);
  console.log('connText =', JSON.stringify(result.connText));
  console.log('iconCount =', result.iconCount);
  console.log('iconSelected =', result.iconSelected);
  console.log('submitted =', result.submitted);
  console.log('banner =', JSON.stringify(result.banner));
  console.log('top6 =', JSON.stringify(result.top6, null, 2));
  console.log('errors =', JSON.stringify(errors, null, 2));
  console.log('--- logs (last 15) ---');
  console.log(logs.slice(-15).join('\n'));
  await browser.close();
}
process.exit(errors.length ? 1 : 0);