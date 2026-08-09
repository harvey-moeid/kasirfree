// ==========================================================
// tests/e2e/gambar-produk-tampil.test.mjs — Regresi untuk bug: upload foto
// produk SUKSES (API 201), tapi gambarnya tidak tampil di mana pun
// (grid kasir, tabel admin, preview form) — baik di browser biasa
// MAUPUN saat dibungkus APK.
//
// Akar masalah: gambar_url berbentuk "/api/gambar/...". Path ini hanya
// bisa "diselesaikan" lewat window.fetch() yang di-patch fetch-shim.js.
// Tapi <img src="..."> TIDAK memanggil window.fetch() — itu request
// resource level-browser asli, dan service worker (sw.js) SENGAJA
// membiarkan semua /api/* request lewat apa adanya ke network asli
// (desain lama untuk versi cloud). Karena tidak ada server sungguhan di
// mode lokal, <img src="/api/gambar/...">  SELALU gagal (404) — cuma
// tidak ketahuan lewat test API-only karena API-nya sendiri memang benar.
//
// Test ini SENGAJA mengecek naturalWidth (bukan cuma nilai atribut src)
// supaya benar-benar memverifikasi gambar ke-decode oleh browser, bukan
// cuma string URL-nya ada.
//
// Jalankan: node tests/e2e/gambar-produk-tampil.test.mjs
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8794;

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

// PNG 1x1 piksel — kalau <img> BENAR-BENAR berhasil decode, naturalWidth
// harus PERSIS 1 (bukan 0, yang berarti gagal load/broken image).
const DUMMY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
    console.log('1) Setup akun & buat produk dengan foto');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#setup-nama-toko', 'Toko Gambar Test');
    await page.fill('#setup-nama-lengkap', 'Admin');
    await page.fill('#setup-username', 'admin');
    await page.fill('#setup-password', 'adminpass123');
    await page.fill('#setup-password-confirm', 'adminpass123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});

    const setupResult = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });
      const fd = new FormData();
      fd.append('file', blob, 'test.png');
      const upRes = await fetch('/api/upload/produk', { method: 'POST', body: fd });
      const upBody = await upRes.json();
      const prodRes = await fetch('/api/produk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode_produk: 'P001', nama: 'Kopi Test', kategori: 'Minuman', harga_jual: 18000, harga_beli: 8000, stok: 50, gambar_url: upBody.gambar_url }),
      });
      await window.LocalDB.flush();
      return { uploadOk: upRes.ok, prodStatus: prodRes.status };
    }, DUMMY_PNG_B64);
    check('upload foto sukses', () => assert.equal(setupResult.uploadOk, true));
    check('buat produk dengan foto sukses', () => assert.equal(setupResult.prodStatus, 201));

    console.log('2) Buka halaman KASIR — gambar produk harus BENAR-BENAR ter-render');
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500); // beri waktu resolveProductImagesAsync() jalan di background

    const kasirImg = await page.evaluate(() => {
      const img = document.querySelector('[data-product-img]');
      if (!img) return null;
      return { src: img.src, naturalWidth: img.naturalWidth, complete: img.complete };
    });
    check('img produk ditemukan di grid kasir', () => assert.ok(kasirImg));
    check('src pakai blob: URL (bukan /api/gambar/... langsung)', () =>
      assert.match(kasirImg.src, /^blob:/)
    );
    check('gambar BENAR-BENAR ter-decode (naturalWidth = 1, sama dengan gambar tes)', () =>
      assert.equal(kasirImg.naturalWidth, 1)
    );

    console.log('3) Buka halaman ADMIN → tab Kelola Produk — gambar di tabel juga harus tampil');
    await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.click('[data-tab="produk"]');
    await page.waitForTimeout(2000);

    const adminImg = await page.evaluate(() => {
      const img = document.querySelector('#tbl-produk img');
      if (!img) return null;
      return { src: img.src, naturalWidth: img.naturalWidth };
    });
    check('img produk ditemukan di tabel admin', () => assert.ok(adminImg));
    check('gambar di tabel admin BENAR-BENAR ter-decode', () => assert.equal(adminImg.naturalWidth, 1));

    console.log('4) Buka form edit produk — preview foto juga harus tampil');
    // PENTING: selector harus target tombol EDIT baris tabel (openProdukModal(<id>)),
    // BUKAN tombol "Tambah Produk" (openProdukModal() tanpa id) yang juga
    // cocok dengan selector longgar seperti `[onclick^="openProdukModal("]`.
    await page.click('#tbl-produk button[onclick^="openProdukModal("]');
    await page.waitForTimeout(1500);
    const previewImg = await page.evaluate(() => {
      const img = document.getElementById('produk-gambar-preview');
      if (!img || img.classList.contains('hidden')) return null;
      return { naturalWidth: img.naturalWidth };
    });
    check('preview foto di form edit BENAR-BENAR ter-decode', () => {
      assert.ok(previewImg);
      assert.equal(previewImg.naturalWidth, 1);
    });

    check('tidak ada page error sepanjang skenario', () => assert.deepEqual(pageErrors, []));
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
