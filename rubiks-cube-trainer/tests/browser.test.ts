/**
 * The page, in a real browser.
 *
 * Everything else in this suite tests the cube. This tests the thing people
 * actually open, because a renderer can be wrong in ways no unit test notices:
 * a canvas that never gets a size, a module that throws on load, a button wired
 * to nothing. It builds the site, serves it, drives it with a real Chromium,
 * and fails on any console error.
 */

import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

/**
 * Use a Chromium that is already on the machine when there is one.
 *
 * CI runners for this project install their own; a sandbox often has one at a
 * fixed path under a version Playwright does not expect. Pointing at it beats
 * downloading a hundred and seventy megabytes to run fifteen assertions.
 */
function launchOptions(): { executablePath?: string } {
  for (const candidate of [
    process.env['PLAYWRIGHT_CHROMIUM_PATH'],
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ]) {
    if (candidate && existsSync(candidate)) return { executablePath: candidate };
  }
  return {};
}

/** Poll an element until it says what it should, or give up with a useful message. */
async function waitForText(
  target: Page,
  selector: string,
  matcher: string | RegExp,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen = (await target.locator(selector).first().textContent()) ?? '';
    const hit = typeof matcher === 'string' ? seen.includes(matcher) : matcher.test(seen);
    if (hit) return seen;
    await target.waitForTimeout(120);
  }
  throw new Error(`${selector} never matched ${String(matcher)}; last saw ${JSON.stringify(seen)}`);
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`nothing answered on ${url}`);
}

beforeAll(async () => {
  server = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { stdio: 'ignore' },
  );
  await waitForServer(BASE);

  browser = await chromium.launch(launchOptions());
  page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

describe('the page', () => {
  it('loads without a console error', () => {
    expect(consoleErrors).toEqual([]);
  });

  it('draws something on the canvas', async () => {
    // WebGL will not report through the DOM, so the check is that the canvas
    // has a real size and that the page is not showing a blank frame.
    const size = await page.locator('#cube').evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    expect(size.width).toBeGreaterThan(200);
    expect(size.height).toBeGreaterThan(200);

    const shot = await page.locator('#cube').screenshot();
    expect(shot.byteLength).toBeGreaterThan(3000);
  });

  it('scrambles when asked', async () => {
    await page.getByRole('button', { name: 'Scramble' }).click();
    await waitForText(page, '#status', 'Scrambled:');
  });

  it('turns a face from the keyboard and records it', async () => {
    await page.getByRole('button', { name: 'Solved' }).click();
    await page.locator('body').press('r');
    // Shift has to be named explicitly: sending 'U' alone gives an uppercase
    // character with no modifier, which the page reads as a plain U turn.
    await page.locator('body').press('Shift+u');
    await waitForText(page, '#history', "R U'");
  });

  it('undoes a move', async () => {
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await waitForText(page, '#history', /^R$/)).trim()).toBe('R');
  });

  it('rejects a scramble it cannot read, and says why', async () => {
    await page.locator('#scramble-input').fill('R U X');
    await page.getByRole('button', { name: 'Apply' }).click();
    await waitForText(page, '#scramble-error', 'not a move');
  });

  it('applies a scramble it can read', async () => {
    await page.locator('#scramble-input').fill("R U R' U'");
    await page.getByRole('button', { name: 'Apply' }).click();
    await waitForText(page, '#status', 'Applied 4 moves');
  });

  it('solves the cube the way you would learn, with explanations', async () => {
    await page.getByRole('button', { name: 'Scramble' }).click();
    await page.getByRole('button', { name: "The way you'd learn" }).click();
    expect(await page.locator('#playback').isVisible()).toBe(true);
    await waitForText(page, '#solution-moves', /[URFDLB]/);
    await waitForText(page, '#step-detail', /\S/);

    await page.getByRole('button', { name: 'To the end' }).click();
    const finished = await waitForText(page, '#playback-progress', /Move \d+ of \d+/, 30_000);
    const [, done, total] = /Move (\d+) of (\d+)/.exec(finished) ?? [];
    expect(done).toBe(total);
  });

  it('solves the cube efficiently once the tables are built', async () => {
    await page.getByRole('button', { name: 'Scramble' }).click();
    await page.getByRole('button', { name: 'Efficiently' }).click();
    const moves = await waitForText(page, '#solution-moves', /[URFDLB]/, 120_000);
    // Two-phase should be far shorter than the beginner method.
    expect(moves.trim().split(/\s+/).length).toBeLessThan(32);
  }, 120_000);

  it('shows a lesson with its algorithms', async () => {
    await page.getByRole('tab', { name: 'Learn' }).click();
    await waitForText(page, '#lesson-title', '1. The cross');
    await page.locator('.ladder li').nth(3).click();
    await waitForText(page, '#lesson-title', '4. The top cross');
    await waitForText(page, '.algorithm .notation', "F R U R' U' F'");
  });

  it('gives a hint that names the stage and the moves', async () => {
    await page.getByRole('tab', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Scramble' }).click();
    await page.getByRole('tab', { name: 'Learn' }).click();
    await page.getByRole('button', { name: 'What now?' }).click();
    await waitForText(page, '#hint-detail', 'steps to go');
  });

  it('sets up a drill for a chosen stage', async () => {
    await page.locator('.ladder li').nth(2).click();
    await page.getByRole('button', { name: 'Practise this stage' }).click();
    await waitForText(page, '#status', 'Set up for: Middle layer');
  });

  it('applies a pattern', async () => {
    await page.getByRole('tab', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Checkerboard' }).click();
    await waitForText(page, '#pattern-note', 'chequered');
  });

  it('shows the timer tab with an empty session', async () => {
    await page.getByRole('tab', { name: 'Time' }).click();
    expect(await page.locator('#timer').isVisible()).toBe(true);
    await waitForText(page, '#stats', 'Solves');
  });

  it('still has no console errors after all of that', () => {
    expect(consoleErrors).toEqual([]);
  });
});
