import { createRequire } from 'module';
const require = createRequire('C:/Users/Gabera/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/package.json');
const { chromium } = require('playwright');

const BASE = 'http://localhost:8765/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.monaco && window.monaco.editor.getEditors().length > 0, null, { timeout: 30000 });

const ed = () => page.evaluate(() => window.monaco.editor.getEditors()[0]);

// 1) API-level edit works?
await page.evaluate(() => window.monaco.editor.getEditors()[0].executeEdits('t', [{ range: new window.monaco.Range(1,1,1,1), text: 'APITEST ' }]));
const v1 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('1) API edit registers:', v1.startsWith('APITEST'));

// 2) Programmatic focus + keyboard type
await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
await page.waitForTimeout(100);
const focused = await page.evaluate(() => {
  const ae = document.activeElement;
  return ae ? ae.tagName + (ae.className ? '.' + String(ae.className).slice(0,30) : '') : 'null';
});
console.log('2) activeElement after focus:', focused);
await page.keyboard.type('KEYTEST', { delay: 20 });
await page.waitForTimeout(150);
const v2 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('2) keyboard type registers:', v2.includes('KEYTEST'), '| head:', JSON.stringify(v2.slice(0,30)));

// 3) Move cursor to end, type a space + backspace (common p5-hijack keys)
await page.evaluate(() => window.monaco.editor.getEditors()[0].setPosition({ lineNumber: 1, column: 100 }));
await page.keyboard.press('End');
await page.waitForTimeout(80);
await page.keyboard.type(' ');
await page.waitForTimeout(100);
const v3 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('3) space registers (typed a space):', v3 !== v2);
await page.keyboard.press('Backspace');
await page.waitForTimeout(100);
const v4 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('3) backspace registers (removed):', v4 !== v3);

// 4) Now create a p5 instance (open sim) WITHOUT closing, and re-test keyboard
//    to detect p5 hijacking window key listeners.
await page.evaluate(() => {
  // simulate opening the sim modal by calling the same path: click ranking row won't work without tournament.
  // Instead create a throwaway p5 instance in the simCanvas container like MatchSim does.
  const c = document.getElementById('simCanvas');
  window.__p = new window.p5((p) => { p.setup = () => p.createCanvas(300,100); }, c);
});
await page.waitForTimeout(200);
await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
await page.waitForTimeout(100);
await page.keyboard.type('AFTERP5');
await page.waitForTimeout(200);
const v5 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('4) keyboard after p5 instance registers:', v5.includes('AFTERP5'), '| includes AFTERP5:', v5.includes('AFTERP5'));
// Check key listeners on window (can't enumerate directly) but test backspace/space after p5
await page.keyboard.type(' X Y');
await page.waitForTimeout(100);
const v6 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('4) space " " in "X Y" present:', v6.includes('X Y'));
await page.keyboard.press('Backspace');
await page.waitForTimeout(100);
const v7 = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());
console.log('4) backspace after p5 works:', !v7.endsWith(' ') && v7 !== v6);

await browser.close();
process.exit(0);