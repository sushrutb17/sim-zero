// Cold-start measurement of a PRODUCTION build under network throttling (Task 16).
//
// Usage (from app/, after `npm run build`):
//   node tools/measure-cold-start.mjs [--runs 3] [--label before] [--url https://localhost:8087/]
// It starts `vite preview --port 8087 --strictPort` itself (detached) and stops exactly that process group at the end;
// pass --no-serve to use a server you already run at --url.
//
// Per run: fresh browser context, HTTP cache disabled, CDP network throttling (profiles below). Measured in page via
// an init script (PerformanceObserver + MutationObserver), times in ms from navigation start:
//   fcp      first-contentful-paint (if the browser reports one)
//   bundle   responseEnd of the main entry script (resource timing)
//   canvas   the IWSDK canvas is attached under #scene-container
//   loaded   the #loading screen is released (class .done = fade starts, or removed) (n/a for a build that has none)
// EMULATOR / headless desktop Chromium on localhost with simulated network: relative before/after evidence only,
// not a Quest Browser number.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const RUNS = Number(arg('runs', '3'));
const LABEL = arg('label', 'run');
const URL_ = arg('url', 'https://localhost:8087/');
const SERVE = !process.argv.includes('--no-serve');
const PORT = new URL(URL_).port || '8087';

const PROFILES = {
  wifi: { downMbps: 30, rttMs: 20 },
  slow: { downMbps: 5, rttMs: 80 },
};

const INIT = () => {
  const t = (window.__cold = { fcp: null, canvas: null, loaded: null, hadLoading: false });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint' && t.fcp === null) t.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch (_) { /* no paint timing */ }
  const check = () => {
    const root = document.documentElement;
    if (!root) return;
    if (t.canvas === null && document.querySelector('#scene-container canvas')) t.canvas = performance.now();
    const loading = document.getElementById('loading');
    if (loading) t.hadLoading = true;
    // the app marks it .done (fade starts) at the ready moment and removes it ~250 ms later; take the earlier
    if (t.hadLoading && t.loaded === null && (!loading || loading.classList.contains('done'))) t.loaded = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
};

function median(xs) {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

async function once(browser, profile) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 900, height: 900 } });
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`  pageerror: ${e.message}`));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.rttMs,
      downloadThroughput: (profile.downMbps * 1e6) / 8,
      uploadThroughput: (profile.downMbps * 1e6) / 8,
    });
    await page.addInitScript(INIT);
    await page.goto(URL_, { waitUntil: 'commit', timeout: 120_000 });
    await page.waitForFunction(() => window.__cold?.canvas !== null && window.__cold?.canvas !== undefined, null, { timeout: 120_000, polling: 100 });
    // After the canvas appears the loading screen (if the build has one) goes when the welcome screen is drawn.
    await page.waitForFunction(() => !window.__cold.hadLoading || window.__cold.loaded !== null, null, { timeout: 60_000, polling: 100 }).catch(() => {});
    return await page.evaluate(() => {
      const main = performance.getEntriesByType('resource').find((r) => /\/assets\/index-[^/]*\.js(\?|$)/.test(r.name));
      const c = window.__cold;
      return { fcp: c.fcp, bundle: main ? main.responseEnd : null, canvas: c.canvas, loaded: c.hadLoading ? c.loaded : null };
    });
  } finally {
    await ctx.close();
  }
}

let server;
if (SERVE) {
  server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort', '--host', 'localhost'], { detached: true, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 4000));
}
const stop = () => {
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch (_) { /* already gone */ }
  }
};
process.on('SIGINT', () => { stop(); process.exit(130); });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const rows = [];
try {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await once(browser, profile);
      runs.push(r);
      console.log(`  ${name} run ${i + 1}: ${JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : Math.round(v)])))}`);
    }
    rows.push({ name, fcp: median(runs.map((r) => r.fcp)), bundle: median(runs.map((r) => r.bundle)), canvas: median(runs.map((r) => r.canvas)), loaded: median(runs.map((r) => r.loaded)) });
  }
} finally {
  await browser.close();
  stop();
}
const f = (v) => (v === null ? 'n/a' : `${Math.round(v)}`.padStart(6));
console.log(`\n${LABEL}: median of ${RUNS} runs, ms from navigation start (headless Chromium, simulated network)`);
console.log('profile  | fcp    | bundle | canvas | loading removed');
for (const r of rows) console.log(`${r.name.padEnd(8)} | ${f(r.fcp)} | ${f(r.bundle)} | ${f(r.canvas)} | ${f(r.loaded)}`);
