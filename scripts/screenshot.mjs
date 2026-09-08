/**
 * Regenerate the screenshots in docs/.
 *
 *     npm run build && node scripts/screenshot.mjs
 *
 * Builds nothing itself: it serves whatever is in dist/ and drives it, so the
 * pictures in the README are of the site as it would be deployed rather than of
 * a development server with different code in it.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const PORT = 4321;
const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: 'ignore' },
);
const wait = async (url) => {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no server');
};
await wait(`http://127.0.0.1:${PORT}`);
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Scramble' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshot-play.png' });
await page.getByRole('tab', { name: 'Learn' }).click();
await page.locator('.ladder li').nth(4).click();
await page.getByRole('button', { name: 'What now?' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/screenshot-learn.png' });
await browser.close();
server.kill();
console.log('shots written');
