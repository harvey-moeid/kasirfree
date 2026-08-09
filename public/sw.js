const CACHE_NAME = "muidsoft-kasir-shell-v8-export-fix";

const APP_SHELL = [
  "/login.html",
  "/index.html",
  "/admin.html",
  "/styles.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  // Mesin database & API lokal (wajib ada supaya aplikasi bisa dibuka
  // sepenuhnya offline, termasuk transaksi/kasir — bukan cuma app-shell).
  "/js/vendor/sql-wasm.js",
  "/js/vendor/sql-wasm.wasm",
  "/js/idb-helper.js",
  "/js/lib/base64.js",
  "/js/lib/file-saver.js",
  "/js/local-images.js",
  "/js/local-db.js",
  "/js/local-auth.js",
  "/js/local-backup.js",
  "/js/fetch-shim.js",
  "/js/mini-hono.js",
  "/js/crypto.js",
  "/js/local-auth-middleware.js",
  "/js/local-app.js",
  "/js/register-sw.js",
  // Router per-domain (hasil pecah dari local-app.js — wajib dicache
  // semua, local-app.js meng-import-nya saat start).
  "/js/lib/helpers.js",
  "/js/routes/auth.js",
  "/js/routes/produk.js",
  "/js/routes/bahan-baku.js",
  "/js/routes/upload.js",
  "/js/routes/toko.js",
  "/js/routes/settings.js",
  "/js/routes/shift.js",
  "/js/routes/transaksi.js",
  "/js/routes/laporan.js",
  "/js/routes/preorder.js",
  "/js/routes/users.js",
  "/js/routes/log-aktivitas.js",
  // Logika tiap halaman (hasil pecah dari inline <script> di masing-masing
  // .html — wajib dicache semua supaya admin.html/index.html/login.html
  // tetap jalan penuh walau dibuka pertama kali dalam keadaan offline).
  "/js/pages/admin-app.js",
  "/js/pages/kasir-app.js",
  "/js/pages/login-app.js",
  "/migrations/0001_init.sql",
  "/migrations/0002_split_payment.sql",
  "/migrations/0003_shift_kasir.sql",
  "/migrations/0004_log_aktivitas.sql",
  "/migrations/0005_pengaturan.sql",
  "/migrations/0006_martabak.sql",
  "/migrations/0007_fitur_lanjutan.sql",
  "/migrations/0008_kustomisasi_struk.sql",
  "/migrations/0009_toggle_antrian_struk.sql",
  "/migrations/0010_alasan_batal.sql",
  "/migrations/0011_batal_per_item.sql",
  "/migrations/0012_status_bayar_preorder.sql",
  "/migrations/0013_kasir_toko.sql",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Font Awesome/Google Fonts/xlsx.js/Chart.js/qrcode.js sekarang
      // di-self-host (bukan CDN lagi — lihat scripts/vendor-fetch.mjs),
      // tapi nama file font-nya hash-based, baru diketahui SETELAH
      // benar-benar didownload. Makanya daftarnya dibaca dari
      // vendor-manifest.json (dibuat otomatis oleh vendor-fetch.mjs),
      // bukan ditulis manual di sini.
      let vendorPaths = [];
      try {
        const res = await fetch("/vendor-manifest.json");
        if (res.ok) vendorPaths = await res.json();
      } catch {
        // Belum pernah dijalankan `npm run vendor:fetch` / workflow
        // "Vendor CDN Assets" — app-shell inti tetap ke-precache di bawah,
        // cuma font/xlsx/Chart/QR belum offline-ready sampai itu dijalankan.
      }

      await cache.addAll(APP_SHELL);
      if (vendorPaths.length > 0) {
        await cache.addAll(vendorPaths);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Strategi:
// - /api/*        → selalu network tidak pernah dicache. Kegagalan network
//                    dibiarkan lempar error, ditangkap oleh logic offline-queue
//                    di halaman (fallback ke IndexedDB), BUKAN oleh SW ini.
// - Aset lain (HTML/CSS/JS/font/CDN) → cache-first, lalu update cache di
//                    background ("stale-while-revalidate") supaya app shell
//                    tetap bisa dibuka instan walau offline, tapi tetap
//                    ter-update
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return; // POST/PUT/DELETE (mis. /api/transaksi) tidak disentuh SW
  if (url.pathname.startsWith("/api/")) return; // biarkan lewat langsung ke network

  event.respondWith(
    caches.match(req).then((cached) => {
      // Jaga-jaga: entri cache lama/rusak yang ternyata hasil redirect tidak
      // pernah dipakai untuk menjawab request navigasi (Chrome akan menolaknya
      // dengan error "a redirected response was used..."). Anggap sebagai
      // cache-miss saja, biar jatuh ke fetch() normal di bawah.
      if (cached && cached.redirected && req.mode === "navigate") {
        cached = undefined;
      }

      const network = fetch(req)
        .then((res) => {
          // Hanya cache response yang valid & BUKAN hasil redirect(hindari
          // menyimpan Response yang tidak boleh dipakai menjawab navigasi).
          if (res && res.status === 200 && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // offline sungguhan & tidak ada di cache → biarkan gagal

      return cached || network;
    })
  );
});
