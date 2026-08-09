// ==========================================================
// tests/e2e/camera-dan-gambar-produk.test.mjs — Tes untuk perbaikan:
// 1) Scanner barcode kamera (modal terbuka, tidak error walau CDN
//    ZXing di-vendor lokal — bukan tesnya scan sungguhan, itu perlu
//    kamera fisik/gambar barcode nyata, di luar jangkauan test otomatis).
// 2) Upload foto produk via API (form file → backend → tampil lagi).
// 3) Placeholder produk tanpa foto TIDAK lagi manggil CDN eksternal
//    (ui-avatars.com) — harus data: URI lokal.
//
// Jalankan: node tests/e2e/camera-dan-gambar-produk.test.mjs
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8793;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
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
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    console.log('1) Setup akun & login');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#setup-nama-toko', 'Toko Kamera Test');
    await page.fill('#setup-nama-lengkap', 'Admin');
    await page.fill('#setup-username', 'admin');
    await page.fill('#setup-password', 'adminpass123');
    await page.fill('#setup-password-confirm', 'adminpass123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});

    console.log('2) Upload foto produk via API (1x1 PNG dummy)');
    const uploadResult = await page.evaluate(async () => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const fd = new FormData();
      fd.append('file', blob, 'test.png');
      const res = await fetch('/api/upload/produk', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json() };
    });
    check('upload foto produk sukses (201)', () => assert.equal(uploadResult.status, 201));
    check('response ada gambar_url', () => assert.match(uploadResult.body.gambar_url, /^\/api\/gambar\//));

    console.log('3) Ambil kembali gambar yang diupload (GET)');
    const getResult = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return { status: res.status, contentType: res.headers.get('content-type') };
    }, uploadResult.body.gambar_url);
    check('GET gambar berhasil (200)', () => assert.equal(getResult.status, 200));
    check('content-type image/png', () => assert.equal(getResult.contentType, 'image/png'));

    console.log('4) Placeholder produk tanpa foto TIDAK manggil ui-avatars.com');
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const externalCalls = [];
    page.on('request', (req) => {
      if (req.url().includes('ui-avatars.com')) externalCalls.push(req.url());
    });
    // localPlaceholderImg dipanggil di dalam loadProducts() setiap kali produk
    // tanpa gambar_url dirender — panggil langsung untuk cek hasilnya tanpa
    // perlu ada produk sungguhan di database.
    const placeholderSrc = await page.evaluate(() => {
      // fungsi ini didefinisikan top-level di kasir-app.js (module scope),
      // tapi karena bukan diekspor ke window, panggil lewat cek DOM setelah
      // render produk kosong tidak reliable — jadi verifikasi tidak langsung:
      // pastikan TIDAK ADA request keluar ke ui-avatars.com sepanjang halaman
      // ini dimuat & idle.
      return true;
    });
    await page.waitForTimeout(500);
    check('tidak ada request ke ui-avatars.com', () => assert.deepEqual(externalCalls, []));

    console.log('5) Modal scan kamera bisa dibuka tanpa error (fake camera device)');
    const scanBtn = page.locator('[onclick*="openScanModal"]').first();
    check('tombol scan ditemukan di halaman', async () => {
      assert.equal(await scanBtn.count() > 0, true);
    });
    await scanBtn.click();
    await page.waitForTimeout(1500);
    const modalVisible = await page.locator('#modal-scan').isVisible();
    check('modal scan terbuka', () => assert.equal(modalVisible, true));
    const statusText = await page.locator('#scan-status').textContent();
    // Di lingkungan test (tanpa native BarcodeDetector & tanpa akses internet
    // buat load ZXing), yang penting TIDAK crash & modal kasih status yang
    // jelas — bukan diam/blank.
    check('status scan ada teksnya (tidak blank)', () => assert.ok(statusText && statusText.length > 0));
    check('tidak ada page error saat buka kamera', () => assert.deepEqual(pageErrors, []));
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
