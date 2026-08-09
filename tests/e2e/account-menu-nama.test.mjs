// ==========================================================
// tests/e2e/account-menu-nama.test.mjs — Regresi untuk bug: menu akun
// (di halaman kasir) menampilkan teks "undefined" alih-alih nama user
// yang sedang login.
//
// Akar masalah: kasir-app.js membaca `currentUser.nama`, tapi
// `currentUser` diisi dari respons /api/auth/me yang mengembalikan kolom
// database mentah `nama_lengkap` (bukan `nama`) — jadi `.nama` selalu
// `undefined`, dan `element.innerText = undefined` dirender sebagai teks
// literal "undefined". Baru kelihatan setelah RELOAD halaman (checkAuth()
// jalan lewat /api/auth/me), tidak kelihatan tepat setelah login/setup
// (yang responsnya sendiri sudah benar pakai field `.nama`).
//
// Jalankan: node tests/e2e/account-menu-nama.test.mjs
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8796;

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
    console.log('1) Setup akun dengan nama lengkap yang jelas');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#setup-nama-toko', 'Toko Cek Nama');
    await page.fill('#setup-nama-lengkap', 'Budi Santoso');
    await page.fill('#setup-username', 'budi');
    await page.fill('#setup-password', 'budipass123');
    await page.fill('#setup-password-confirm', 'budipass123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    console.log('2) RELOAD halaman — ini yang memicu checkAuth() lewat /api/auth/me (jalur yang tadinya bug)');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    console.log('3) Buka menu akun, cek nama yang ditampilkan');
    await page.click('[onclick="toggleAccountMenu()"]');
    await page.waitForTimeout(500);
    const namaText = await page.locator('#account-nama').textContent();
    check('nama akun menampilkan "Budi Santoso" (BUKAN "undefined")', () =>
      assert.equal(namaText, 'Budi Santoso')
    );
    check('tidak ada page error', () => assert.deepEqual(pageErrors, []));
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
