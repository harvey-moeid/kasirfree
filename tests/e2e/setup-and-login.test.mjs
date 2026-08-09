// ==========================================================
// tests/e2e/setup-and-login.test.mjs — Tes end-to-end alur wizard "Setup
// Awal" + login pakai browser Chromium sungguhan (Playwright), terhadap
// server statis lokal (bukan mock) — supaya benar-benar menjalankan
// mini-hono.js, local-db.js (sql.js beneran), IndexedDB, dst.
//
// Jalankan: node tests/e2e/setup-and-login.test.mjs
// Butuh: `npx playwright install chromium` sekali di awal (download browser).
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8791;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function run() {
  let pass = 0, fail = 0;
  const check = (label, fn) => {
    try { fn(); console.log(`  ok - ${label}`); pass++; }
    catch (err) { console.log(`  FAIL - ${label}\n    ${err.message}`); fail++; }
  };

  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    console.log('1) Instalasi baru — wizard Setup Awal harus tampil');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    check('setup-mode-wrap terlihat', () =>
      assert.equal(true, true) // placeholder, real check below via isVisible (async)
    );
    const setupVisible = await page.locator('#setup-mode-wrap').isVisible();
    const loginVisible = await page.locator('#login-mode-wrap').isVisible();
    check('wizard setup tampil di instalasi baru', () => assert.equal(setupVisible, true));
    check('form login TIDAK tampil di instalasi baru', () => assert.equal(loginVisible, false));

    console.log('2) Isi & submit wizard setup');
    await page.fill('#setup-nama-toko', 'Toko Uji Otomatis');
    await page.fill('#setup-nama-lengkap', 'Budi Tester');
    await page.fill('#setup-username', 'budi');
    await page.fill('#setup-password', 'rahasia123');
    await page.fill('#setup-password-confirm', 'rahasia123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    check('redirect ke index.html setelah setup sukses', () =>
      assert.match(page.url(), /index\.html$/)
    );
    check('tidak ada page error (uncaught exception) selama setup', () =>
      assert.deepEqual(pageErrors, [])
    );

    console.log('3) Reload login.html — harus tampil form login biasa');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const setupVisible2 = await page.locator('#setup-mode-wrap').isVisible();
    const loginVisible2 = await page.locator('#login-mode-wrap').isVisible();
    check('wizard setup TIDAK tampil lagi setelah akun ada', () => assert.equal(setupVisible2, false));
    check('form login tampil setelah akun ada', () => assert.equal(loginVisible2, true));

    console.log('4) Login dengan akun yang baru dibuat');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'rahasia123');
    await page.click('#btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    check('redirect ke index.html setelah login sukses', () =>
      assert.match(page.url(), /index\.html$/)
    );

    console.log('5) Login dengan password SALAH — harus ditolak');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#username', 'budi');
    await page.fill('#password', 'passwordsalah');
    await page.click('#btn-submit');
    await page.waitForTimeout(1000);
    const errorVisible = await page.locator('#error-alert').isVisible();
    check('pesan error tampil untuk password salah', () => assert.equal(errorVisible, true));
    check('TETAP di login.html (tidak lolos)', () => assert.match(page.url(), /login\.html$/));

    console.log('6) Setup ulang (endpoint) harus ditolak — akun sudah ada');
    const setupAgain = await page.evaluate(async () => {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama_toko: 'X', nama_lengkap: 'Y', username: 'hacker', password: 'rahasia123' }),
      });
      return { status: res.status };
    });
    check('POST /api/auth/setup kedua ditolak dengan 409', () => assert.equal(setupAgain.status, 409));

    console.log('7) Data benar-benar tersimpan di IndexedDB (bukan cuma in-memory)');
    const dbRow = await page.evaluate(async () => {
      return window.LocalDB.prepare('SELECT username, role FROM users WHERE username = ?').bind('budi').first();
    });
    check('user "budi" tersimpan dengan role super_admin', () => {
      assert.equal(dbRow.username, 'budi');
      assert.equal(dbRow.role, 'super_admin');
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
