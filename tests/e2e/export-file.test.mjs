// ==========================================================
// tests/e2e/export-file.test.mjs — Regresi untuk bug: export Excel &
// backup data tidak bisa diunduh saat dibungkus APK. Akar masalah:
// XLSX.writeFile()/<a download> classic mengandalkan download manager
// browser, yang TIDAK otomatis ada di WebView Capacitor. Diperbaiki
// dengan window.FileSaver (public/js/lib/file-saver.js) — pakai Web
// Share API kalau window.Capacitor terdeteksi, fallback ke <a download>
// classic di browser biasa.
//
// Jalankan: node tests/e2e/export-file.test.mjs
// ==========================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '../../public');
const PORT = 8795;

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
    console.log('1) Setup akun');
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('#setup-nama-toko', 'Toko Export Test');
    await page.fill('#setup-nama-lengkap', 'Admin');
    await page.fill('#setup-username', 'admin');
    await page.fill('#setup-password', 'adminpass123');
    await page.fill('#setup-password-confirm', 'adminpass123');
    await page.click('#setup-btn-submit');
    await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});

    await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    console.log('2) window.FileSaver dipakai di browser BIASA (tanpa Capacitor) → jalur classic download');
    const hasCapacitor = await page.evaluate(() => !!window.Capacitor);
    check('window.Capacitor tidak ada di test ini (browser biasa)', () => assert.equal(hasCapacitor, false));

    const [download1, saveResult] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.evaluate(async () => window.FileSaver.save('isi file tes', 'contoh.txt', 'text/plain')),
    ]);
    check('FileSaver.save() di browser biasa memicu download sungguhan', () =>
      assert.equal(download1.suggestedFilename(), 'contoh.txt')
    );
    check('method yang dilaporkan adalah "download" (bukan "share")', () =>
      assert.equal(saveResult.method, 'download')
    );

    console.log('3) Simulasikan lingkungan APK (window.Capacitor + Web Share API) → harus pakai jalur share, BUKAN <a download>');
    const shareTest = await page.evaluate(async () => {
      window.Capacitor = { isNativePlatform: () => true };
      let shareCalledWith = null;
      navigator.share = async (data) => { shareCalledWith = { name: data.files[0].name, type: data.files[0].type }; };
      navigator.canShare = () => true;
      const result = await window.FileSaver.save('isi file APK', 'contoh-apk.txt', 'text/plain');
      return { result, shareCalledWith };
    });
    check('di lingkungan APK, navigator.share DIPANGGIL (bukan <a download>)', () =>
      assert.ok(shareTest.shareCalledWith)
    );
    check('file yang dibagikan nama & tipenya benar', () => {
      assert.equal(shareTest.shareCalledWith.name, 'contoh-apk.txt');
      assert.equal(shareTest.shareCalledWith.type, 'text/plain');
    });
    check('method yang dilaporkan adalah "share"', () => assert.equal(shareTest.result.method, 'share'));

    // Reset mock sebelum lanjut — kalau tidak, window.Capacitor & navigator.share
    // yang di-mock di atas masih nempel di halaman, bikin test berikutnya
    // (export backup sungguhan) SALAH ikut lewat jalur share juga.
    await page.evaluate(() => {
      delete window.Capacitor;
      delete navigator.share;
      delete navigator.canShare;
    });

    console.log('4) Export BACKUP sungguhan (tombol asli) — harus menghasilkan file JSON valid');
    await page.click('#tab-btn-toko');
    await page.waitForTimeout(1000);
    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await page.click('#btn-backup');
    const download2 = await downloadPromise;
    check('nama file backup sesuai pola backup-muidsoft-*.json', () =>
      assert.match(download2.suggestedFilename(), /^backup-muidsoft-.*\.json$/)
    );
    const savePath = '/tmp/_test-backup-export.json';
    await download2.saveAs(savePath);
    const parsed = JSON.parse(readFileSync(savePath, 'utf-8'));
    check('isi backup JSON valid & lengkap (app, dbBase64)', () => {
      assert.equal(parsed.app, 'kasir-harvey-local-backup'); // marker internal, SENGAJA tidak berubah — lihat local-backup.js
      assert.ok(typeof parsed.dbBase64 === 'string' && parsed.dbBase64.length > 0);
    });

    check('tidak ada page error sepanjang skenario export', () => assert.deepEqual(pageErrors, []));
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
