// End-to-end smoke test in real Chromium. /detect is mocked (never wakes the live GPU service).
// Run: npm run test:e2e   (screenshots land in test-results/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'tests/fixtures');
const OUT = join(ROOT, 'test-results');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
                '.png': 'image/png', '.jpg': 'image/jpeg' };
let server, browser, base;

before(async () => {
  server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  await mkdir(OUT, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); });

async function openApp() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const maskPng = await readFile(join(FIX, 'mask_sample_1.png'));
  await page.route('**/detect', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: maskPng }));
  await page.goto(`${base}/app/index.html`);
  return { page, errors };
}
const dE = async (page) => {
  await page.waitForFunction(() => /ΔE/.test(document.getElementById('timings').textContent));
  return parseFloat((await page.textContent('#timings')).match(/ΔE ([\d.]+)/)[1]);
};

test('photo -> detect (mocked) -> stain -> brush -> download', async () => {
  const { page, errors } = await openApp();
  await page.setInputFiles('#file', join(FIX, 'fence_sample_1.jpg'));
  await page.waitForFunction(() => /Photo loaded/.test(document.getElementById('status').textContent));
  await page.click('#detect');
  assert.ok(await dE(page) <= 3, 'default swatch dE');

  await page.evaluate(() => { document.getElementById('timings').textContent = ''; });
  await page.click('.swatch[aria-label="Redwood"]');
  const d = await dE(page);
  assert.ok(d <= 3, `Redwood dE ${d}`);

  await page.click('[data-brush="add"]');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.12, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => /brush edit/.test(document.getElementById('status').textContent));

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  assert.match(dl.suggestedFilename(), /^fence-redwood\.jpg$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('synthetic weathered fence: renew + stain screenshots', async () => {
  const { page, errors } = await openApp();
  // Build the synthetic scene in the page and feed it through the real file inputs.
  await page.evaluate(async () => {
    const { makeScene } = await import('/tests/synthetic.js');
    const { rgba, mask, w, h } = makeScene(960, 640, 11);
    const toFile = async (data, name) => {
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
      return new File([await c.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' });
    };
    const m8 = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < mask.length; i++) { m8.fill(mask[i] * 255, i * 4, i * 4 + 3); m8[i * 4 + 3] = 255; }
    window.__files = { photo: await toFile(rgba, 'scene.png'), mask: await toFile(m8, 'mask.png') };
  });
  const setFile = (sel, key) => page.evaluate(([sel, key]) => {
    const dt = new DataTransfer(); dt.items.add(window.__files[key]);
    const input = document.querySelector(sel); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, key]);
  await setFile('#file', 'photo');
  await page.waitForFunction(() => /Photo loaded/.test(document.getElementById('status').textContent));
  await page.locator('#stage').screenshot({ path: join(OUT, 'synthetic-original.png') });
  await setFile('#maskFile', 'mask');
  assert.ok(await dE(page) <= 3);
  await page.locator('#stage').screenshot({ path: join(OUT, 'synthetic-natural-cedar.png') });

  await page.evaluate(() => { document.getElementById('timings').textContent = ''; });
  await page.click('.swatch[aria-label="Cape Cod Gray"]');
  assert.ok(await dE(page) <= 3);
  await page.locator('#stage').screenshot({ path: join(OUT, 'synthetic-cape-cod-gray.png') });

  // Colour change latency as the user feels it (worker round trip + draw).
  const ms = await page.evaluate(async () => {
    const t = document.getElementById('timings');
    t.textContent = '';
    const t0 = performance.now();
    document.querySelector('.swatch[aria-label="Walnut"]').click();
    while (!/ΔE/.test(t.textContent)) await new Promise((r) => setTimeout(r, 5));
    return performance.now() - t0;
  });
  console.log(`  colour change round trip: ${ms.toFixed(0)} ms (960x640)`);
  await page.screenshot({ path: join(OUT, 'app-full.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});
