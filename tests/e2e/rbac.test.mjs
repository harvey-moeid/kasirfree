// ==========================================================
// tests/e2e/rbac.test.mjs — Tes end-to-end kontrol akses berbasis role
// (super_admin vs kasir): kasir tidak boleh akses endpoint admin-only,
// dan diusir dari admin.html.
//
// Jalankan: node tests/e2e/rbac.test.mjs
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8792;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
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
    console.log('1) Setup akun super_admin (owner)');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#setup-nama-toko', 'Toko RBAC');
    await page.fill('#setup-nama-lengkap', 'Owner');
    await page.fill('#setup-username', 'owner');
    await page.fill('#setup-password', 'ownerpass123');
    await page.fill('#setup-password-confirm', 'ownerpass123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});

    console.log('2) Owner bikin akun kasir lewat API');
    const createResult = await page.evaluate(async () => {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'kasir1', password: 'kasirpass123', nama_lengkap: 'Kasir Satu', role: 'kasir' }),
      });
      return { status: res.status, body: await res.json() };
    });
    check('POST /api/users sukses (201)', () => assert.equal(createResult.status, 201));

    // local-db.js men-debounce simpan ke IndexedDB (400ms) — tunggu flush
    // beneran sebelum reload, sama seperti pemakaian nyata.
    await page.evaluate(async () => { await window.LocalDB.flush(); });

    console.log('3) Logout, login sebagai kasir1');
    await page.evaluate(() => window.LocalAuth.lock());
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#username', 'kasir1');
    await page.fill('#password', 'kasirpass123');
    await page.click('#btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    check('login kasir1 berhasil, redirect ke index.html', () =>
      assert.match(page.url(), /index\.html$/)
    );

    console.log('4) Kasir akses endpoint ADMIN-ONLY (GET /api/users) — harus 403');
    const kasirUsers = await page.evaluate(async () => {
      const res = await fetch('/api/users');
      return { status: res.status };
    });
    check('kasir ditolak akses /api/users (403)', () => assert.equal(kasirUsers.status, 403));

    console.log('5) Kasir akses endpoint yang MEMANG boleh (GET /api/produk) — harus 200');
    const kasirProduk = await page.evaluate(async () => {
      const res = await fetch('/api/produk');
      return { status: res.status };
    });
    check('kasir bisa akses /api/produk (200)', () => assert.equal(kasirProduk.status, 200));

    console.log('6) Kasir coba buka admin.html langsung — harus diusir');
    await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check('kasir tidak bisa tetap di admin.html', () =>
      assert.doesNotMatch(page.url(), /admin\.html$/)
    );

    console.log('7) Sanity: super_admin (owner) TETAP bisa buka admin.html');
    await page.evaluate(() => window.LocalAuth.lock());
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#username', 'owner');
    await page.fill('#password', 'ownerpass123');
    await page.click('#btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    check('owner (super_admin) tetap di admin.html', () =>
      assert.match(page.url(), /admin\.html$/)
    );
    check('tidak ada page error sepanjang skenario RBAC', () =>
      assert.deepEqual(pageErrors, [])
    );
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
