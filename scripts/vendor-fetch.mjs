#!/usr/bin/env node
// ==========================================================
// scripts/vendor-fetch.mjs — Download semua asset yang SEBELUMNYA dimuat
// dari CDN luar (Font Awesome, Google Fonts, xlsx.js, Chart.js,
// qrcode.js) dan simpan lokal di public/, supaya aplikasi 100% offline
// dari kali pertama dibuka — tidak gantung CDN sama sekali.
//
// BUTUH INTERNET saat dijalankan (jelas — namanya juga download).
// Jalankan SEKALI saat setup awal (atau tiap kali mau update versi
// library), lalu commit hasilnya ke repo:
//   npm run vendor:fetch
//
// Kalau tidak mau jalankan manual, ada workflow GitHub Actions yang
// otomatis menjalankan ini + commit hasilnya ke repo:
//   .github/workflows/vendor-assets.yml (trigger manual lewat tab Actions)
// ==========================================================

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const PUB = path.join(ROOT, 'public');

const UA_MODERN_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA_MODERN_BROWSER, ...extraHeaders } });
  if (!res.ok) throw new Error(`Gagal fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA_MODERN_BROWSER } });
  if (!res.ok) throw new Error(`Gagal fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

/**
 * Download 1 file JS/CSS tunggal (tanpa dependency lain di dalamnya)
 * langsung ke path tujuan.
 */
async function vendorSingleFile(url, destPath, label) {
  console.log(`→ ${label}: ${url}`);
  const buf = await fetchBinary(url);
  await ensureDir(path.dirname(destPath));
  await writeFile(destPath, buf);
  console.log(`  disimpan: ${path.relative(ROOT, destPath)} (${(buf.length / 1024).toFixed(1)} KB)`);
}

/**
 * Download CSS dari `cssUrl`, cari semua referensi `url(...)` di dalamnya,
 * download tiap file yang direferensikan itu, lalu tulis ulang CSS-nya
 * supaya menunjuk ke path lokal relatif. Dipakai untuk Font Awesome
 * (referensi webfont relatif: ../webfonts/xxx.woff2) dan Google Fonts
 * CSS2 API (referensi absolut ke fonts.gstatic.com).
 */
async function vendorCssWithAssets({ cssUrl, cssDestPath, assetsDestDir, assetsUrlPrefixInCss, label }) {
  console.log(`→ ${label} CSS: ${cssUrl}`);
  let css = await fetchText(cssUrl);

  const urlPattern = /url\((['"]?)([^'")]+)\1\)/g;
  const seen = new Map(); // originalRef -> localFileName
  let match;
  const matches = [];
  while ((match = urlPattern.exec(css)) !== null) {
    matches.push(match[2]);
  }
  const uniqueRefs = [...new Set(matches)];

  await ensureDir(assetsDestDir);

  for (const ref of uniqueRefs) {
    // Lewati data: URI (font subset kecil yang sudah inline base64) — tidak
    // perlu didownload, biarkan apa adanya di CSS.
    if (ref.startsWith('data:')) continue;

    const absoluteUrl = ref.startsWith('http') ? ref : new URL(ref, cssUrl).href;
    const fileName = absoluteUrl.split('/').pop().split('?')[0];
    const destFile = path.join(assetsDestDir, fileName);

    console.log(`  ↳ font/asset: ${fileName}`);
    const buf = await fetchBinary(absoluteUrl);
    await writeFile(destFile, buf);

    seen.set(ref, `${assetsUrlPrefixInCss}${fileName}`);
  }

  // Tulis ulang semua referensi di CSS ke path lokal.
  css = css.replace(urlPattern, (full, quote, ref) => {
    if (ref.startsWith('data:')) return full;
    const local = seen.get(ref);
    return local ? `url(${local})` : full;
  });

  await ensureDir(path.dirname(cssDestPath));
  await writeFile(cssDestPath, css, 'utf-8');
  const assetFileNames = [...seen.values()].map((p) => p.split('/').pop());
  console.log(`  disimpan: ${path.relative(ROOT, cssDestPath)} (+ ${seen.size} file font)`);
  return { assetFileNames };
}

async function main() {
  console.log('Vendor-fetch dimulai — mengunduh semua asset CDN untuk dipakai lokal...\n');

  const vendoredPaths = []; // dikumpulkan untuk ditulis ke vendor-manifest.json di akhir

  // ---- 1) Font Awesome 6.4.0 (Free, dipakai di admin/index/login.html) ----
  const faResult = await vendorCssWithAssets({
    cssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    cssDestPath: path.join(PUB, 'fonts/fontawesome/css/all.min.css'),
    assetsDestDir: path.join(PUB, 'fonts/fontawesome/webfonts'),
    assetsUrlPrefixInCss: '../webfonts/',
    label: 'Font Awesome 6.4.0',
  });
  vendoredPaths.push('/fonts/fontawesome/css/all.min.css');
  for (const f of faResult.assetFileNames) vendoredPaths.push(`/fonts/fontawesome/webfonts/${f}`);

  // ---- 2) Google Fonts: Sora + Plus Jakarta Sans + JetBrains Mono ----
  // Gabungan SEMUA weight yang dipakai di 3 halaman (union), supaya 1 file
  // CSS lokal ini bisa dipakai bertiga tanpa ada weight yang kurang.
  const googleFontsCssUrl =
    'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
  const gfResult = await vendorCssWithAssets({
    cssUrl: googleFontsCssUrl,
    cssDestPath: path.join(PUB, 'fonts/google/fonts.css'),
    assetsDestDir: path.join(PUB, 'fonts/google/files'),
    assetsUrlPrefixInCss: './files/',
    label: 'Google Fonts (Sora, Plus Jakarta Sans, JetBrains Mono)',
  });
  vendoredPaths.push('/fonts/google/fonts.css');
  for (const f of gfResult.assetFileNames) vendoredPaths.push(`/fonts/google/files/${f}`);

  // ---- 3) Library JS tunggal (tanpa asset tambahan) ----
  await vendorSingleFile(
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    path.join(PUB, 'js/vendor/xlsx.full.min.js'),
    'xlsx.js 0.18.5'
  );
  vendoredPaths.push('/js/vendor/xlsx.full.min.js');

  await vendorSingleFile(
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
    path.join(PUB, 'js/vendor/chart.umd.min.js'),
    'Chart.js 4.4.1'
  );
  vendoredPaths.push('/js/vendor/chart.umd.min.js');

  await vendorSingleFile(
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    path.join(PUB, 'js/vendor/qrcode.min.js'),
    'qrcodejs 1.0.0'
  );
  vendoredPaths.push('/js/vendor/qrcode.min.js');

  await vendorSingleFile(
    'https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js',
    path.join(PUB, 'js/vendor/zxing-browser.min.js'),
    '@zxing/browser 0.2.1 (fallback scan barcode untuk HP tanpa BarcodeDetector native)'
  );
  vendoredPaths.push('/js/vendor/zxing-browser.min.js');

  // ---- 4) Tulis manifest — dibaca oleh public/sw.js saat "install" supaya
  //         SEMUA file di atas (termasuk nama file font yang hash-nya baru
  //         diketahui SETELAH didownload) ikut di-precache untuk offline,
  //         tanpa sw.js perlu tahu nama file itu sebelumnya. ----
  const manifestPath = path.join(PUB, 'vendor-manifest.json');
  await writeFile(manifestPath, JSON.stringify(vendoredPaths, null, 2) + '\n', 'utf-8');
  console.log(`\nManifest ditulis: ${path.relative(ROOT, manifestPath)} (${vendoredPaths.length} file)`);

  console.log('\nSelesai. Semua asset CDN sudah disimpan lokal di public/fonts/ dan public/js/vendor/.');
  console.log('Langkah berikutnya (kalau dijalankan manual, bukan lewat GitHub Actions):');
  console.log('  git add public/fonts public/js/vendor public/vendor-manifest.json');
  console.log('  git commit -m "chore: vendor CDN assets locally"');
}

main().catch((err) => {
  console.error('\nGAGAL vendor-fetch:', err.message);
  console.error('Cek koneksi internet, atau apakah URL CDN di script ini masih valid.');
  process.exit(1);
});

