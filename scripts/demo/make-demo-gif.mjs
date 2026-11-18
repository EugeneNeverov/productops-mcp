#!/usr/bin/env node
// Renders docs/assets/demo.gif: a sprint audit on the bundled demo data.
// The tool result is the real output in examples/reports/jira-demo/assess_sprint_health.json
// (regenerate it with scripts/gen-demo-reports.mjs); the report text comes from the skill's example
// report. Needs Playwright with Chromium and ffmpeg, which are not project dependencies.
// Usage: node scripts/demo/make-demo-gif.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const result = JSON.parse(
  readFileSync(join(root, 'examples/reports/jira-demo/assess_sprint_health.json'), 'utf8'),
);
const html = readFileSync(new URL('./demo.html', import.meta.url), 'utf8').replace(
  '/*DATA*/null',
  JSON.stringify(result),
);

const FPS = 10;
const SECONDS = 15;
const frames = mkdtempSync(join(tmpdir(), 'demo-frames-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 880, height: 590 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  for (let i = 0; i < FPS * SECONDS; i++) {
    await page.evaluate((t) => globalThis.render(t), i / FPS);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
  }
} finally {
  await browser.close();
}

mkdirSync(join(root, 'docs/assets'), { recursive: true });
const out = join(root, 'docs/assets/demo.gif');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(frames, 'f%04d.png'),
    '-vf',
    'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop',
    '0',
    out,
  ],
  { stdio: 'inherit' },
);
rmSync(frames, { recursive: true, force: true });
console.log(`Wrote ${out}`);
