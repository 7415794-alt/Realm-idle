// icon.svg → PNG 아이콘 생성 (Playwright 사용)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../www/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../www/icons/icon-${size}.png`, import.meta.url).pathname });
  await page.close();
}
await browser.close();
console.log('icons done');
