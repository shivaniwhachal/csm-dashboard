#!/usr/bin/env node
// Capture 3840×2160 TV wall PNGs for csm-dashboard.spyne.ai/api/v1/*-snapshot.png.
// The AWS container serves these as static files (no headless browser at runtime).
// This script mirrors the production wall layout: product Overview with Segment,
// Agent, and CSM-level views visible (a.k.a. "full CSM Views" on the TV).
//
// Output (repo root):
//   snapshots/vini-snapshot.png
//   snapshots/studio-snapshot.png
//
// Env: none required. Uses Playwright + a local static server (same pattern as
// supabase-snapshot.mjs / shoot-and-slack.mjs).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'snapshots');
const TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const VIEWPORT = { width: 3840, height: 2160 };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(
    () => typeof getStudio === 'function' && typeof getVini === 'function',
    { timeout: 30000 },
  );
  // Match supabase-snapshot: wait for async feeds so KPIs/tables aren't zeros.
  await page.evaluate(() => {
    try {
      if (typeof loadChurn === 'function' && typeof _churnState !== 'undefined' && _churnState === 'idle') {
        loadChurn();
      }
    } catch (e) {}
  });
  await page.waitForFunction(
    () => typeof _churnState === 'undefined' || _churnState === 'ready' || _churnState === 'error',
    { timeout: 25000 },
  ).catch(() => {});
  await page.waitForFunction(
    () =>
      (typeof ROOFTOP_ADOPTION === 'undefined' || Object.keys(ROOFTOP_ADOPTION).length > 0)
      && (typeof VINS_BUCKETS === 'undefined' || Object.keys(VINS_BUCKETS).length > 0),
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(2000);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [product, filename] of [
    ['vini', 'vini-snapshot.png'],
    ['studio', 'studio-snapshot.png'],
  ]) {
    await page.click(`.top-tab[data-product="${product}"]`);
    await page.waitForTimeout(500);
    await page.click('.sub-tab[data-view="overview"]');
    await page.waitForSelector('#block-csm-view', { timeout: 30000 });
    await page.waitForSelector('#csm-table-wrap table', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const png = await page.screenshot({ type: 'png', fullPage: true });
    const out = path.join(OUT_DIR, filename);
    fs.writeFileSync(out, png);
    const metaName = filename.replace(/\.png$/, '.json');
    const generated = new Date().toISOString();
    fs.writeFileSync(
      path.join(OUT_DIR, metaName),
      JSON.stringify({ product, generated, bytes: png.length, width: VIEWPORT.width, height: VIEWPORT.height }, null, 2) + '\n',
    );
    console.log(`Wrote ${out} (${png.length} bytes, ${VIEWPORT.width}×${VIEWPORT.height})`);
  }
} finally {
  await browser.close();
  server.close();
}
