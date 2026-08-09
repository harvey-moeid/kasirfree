# Proses Refactor — kasoffline

Rangkuman kerja di sandbox ini. Update tiap ada progres baru.

## Konteks penting
- `wrangler.toml` menunjukkan app SEKARANG jalan **100% lokal di browser**
  (sql.js + IndexedDB), Cloudflare cuma serve static assets.
- `src/index.ts` (Hono Worker + D1) = **versi cloud LAMA, sudah tidak aktif**,
  disimpan sebagai referensi (`wrangler.toml.bak.old-cloud-version`).
- Kode yang BENAR-BENAR jalan: `public/js/local-app.js` (mirror struktur
  `src/index.ts`, tapi query ke sql.js lokal lewat `c.env.DB`) + helper lain
  di `public/js/local-*.js`.
- `local-app.js` dimuat sebagai `<script type="module">` di index.html,
  login.html, admin.html → bisa displit jadi banyak file pakai ES import/export
  asli, tanpa perlu bundler.

## Progres

### 1. `src/index.ts` (2535 baris) → dipecah per domain [SELESAI]
Sebelumnya satu file monolitik berisi ~50 route + helper. Sekarang:
- `src/lib/helpers.ts` — helper murni (kodeTransaksi, hitungSplitPayment,
  hitungPembayaranSebagian, wibDateExpr/wibHourExpr/todayWIB,
  getProdukAtauTolak, catatLog).
- `src/routes/*.ts` (12 file): auth, produk, bahan-baku, upload, toko,
  settings, shift, transaksi, laporan, preorder, users, log-aktivitas.
  Tiap file = sub-router Hono (`new Hono<AppEnv>()`), path route tetap
  absolut (`/api/produk/...`), semua di-mount di `index.ts` via
  `app.route('/', xRoutes)`.
- `src/index.ts` sekarang cuma ~89 baris: middleware global (CORS,
  geo-restriction), redirect `/`, mounting semua router, fallback 404/error.
- Verifikasi: diff daftar `method+path` sebelum/sesudah → identik (selisih
  cuma `GET /` yang memang tinggal di index.ts). Semua kurung kurawal balance
  per file. Tidak ada import yang tidak dipakai (sudah di-prune).
- Catatan: file ini legacy/referensi, tidak mempengaruhi app yang live, tapi
  tetap dirapikan karena masih bagian dari repo dan mungkin dipakai lagi.

### 2. `public/js/local-app.js` (2183 baris) → dipecah per domain [SELESAI]
Ini kode yang AKTIF dipakai (bukan `src/index.ts`). Strukturnya paralel 1:1
dengan `src/index.ts` versi lama (route sama persis, tapi `c.env.DB` di sini
wrapper sql.js lokal, bukan D1), jadi dipecah dengan pola yang sama:
- `public/js/lib/helpers.js` — helper murni, sama isinya dengan
  `src/lib/helpers.ts` versi TS-nya (kodeTransaksi, hitungSplitPayment,
  hitungPembayaranSebagian, wibDateExpr/wibHourExpr/todayWIB,
  getProdukAtauTolak, catatLog), tiap fungsi diberi `export`.
- `public/js/routes/*.js` (12 file, ES module native — dimuat browser tanpa
  bundler karena `local-app.js` sudah `<script type="module">`): auth,
  produk, bahan-baku, upload, toko, settings, shift, transaksi, laporan,
  preorder, users, log-aktivitas. Helper lokal yang cuma dipakai 1 domain
  (`validasiHargaStok`, `GAMBAR_MIME_VALID`, `r2KeyDariGambarUrl`,
  `STRUK_SETTING_DEFAULTS`) ikut pindah ke file domainnya masing-masing,
  tidak ditaruh di helpers.js bersama (scope-nya memang lokal).
- `public/js/local-app.js` sekarang cuma ~55 baris: import 12 router, mount
  semua via `app.route('/', xRoutes)`, fallback 404/error, lalu
  `window.LocalApp = app` + dispatch event `local-app-loaded` (sama seperti
  aslinya, dipakai HTML untuk tahu kapan router siap).

**Verifikasi yang dijalankan sebelum dianggap selesai:**
- Diff daftar `method+path` seluruh route sebelum vs sesudah split → **identik
  (50/50)**.
- Cek tidak ada sisa referensi `app.` yang lolos ganti nama di file routes/.
- Kurung kurawal `{`/`}` balance per file (termasu `local-app.js` & helpers.js).
- `node --check` per file (semua route file + composer) → lolos sebagai ES
  module valid, tidak ada syntax error.
- Import yang tidak dipakai di-prune otomatis per file (helper yang di-import
  tapi tidak dipanggil di domain itu dihapus dari daftar import).

**Temuan sampingan (dicatat, tidak diubah karena di luar scope "refactor
struktur"):** ada 6 baris komentar basi bekas copy-paste dari versi cloud,
tentang `GET /` + `app.notFound()`, nyempil di tengah blok helper
(sekitar baris 154-159 file asli) padahal `local-app.js` versi lokal memang
tidak punya route `GET /` (redirect ke login.html ditangani beda di mode
lokal, lewat `html_handling: auto-trailing-slash`). Komentar basi ini
DIBUANG saat pemindahan ke helpers.js karena tidak relevan lagi & bisa
membingungkan. Juga komentar di section upload masih menyebut "Cloudflare
R2" padahal implementasi lokal sekarang pakai IndexedDB — dibiarkan apa
adanya (bukan scope refactor struktur, tapi worth diberitahu ke user).

### 3. File pendukung kecil (`public/js/*.js`) [SELESAI]
Direview semua: `idb-helper.js`, `local-auth.js`, `local-auth-middleware.js`,
`local-backup.js`, `local-images.js`, `local-db.js`, `mini-hono.js`,
`crypto.js`, `fetch-shim.js`. Sebagian besar sudah rapi (single-purpose,
IIFE/global pattern konsisten) — tidak perlu dipecah lagi. Yang diperbaiki:

- **Dedup kode duplikat**: `toBase64`/`fromBase64` (versi ArrayBuffer,
  chunked) ada persis sama di `local-backup.js` DAN `local-images.js`.
  Ditarik ke `public/js/lib/base64.js` (classic script baru, expose lewat
  `window.Base64Util`, konsisten dengan pola `idb-helper.js`). Kedua file
  asal sekarang tinggal `const { toBase64, fromBase64 } = window.Base64Util;`.
  **Konsekuensi:** harus tambah `<script src="/js/lib/base64.js"></script>`
  tepat setelah `idb-helper.js` di `admin.html`, `index.html`, `login.html`
  (3 file HTML disentuh, urutan load sudah dicek benar).
  Catatan: `crypto.js` juga punya `toBase64`/`fromBase64` sendiri, TAPI
  signature beda (Uint8Array kecil untuk hash password, tanpa chunking) —
  sengaja TIDAK digabung ke base64.js karena beda keperluan/skala.
- **Hapus dead code** di `crypto.js`: `signToken`, `verifyToken`,
  `base64url`, `base64urlDecode` — sisa JWT dari versi cloud lama, dicek
  dengan grep di seluruh `public/` dan **tidak dipanggil sama sekali** di
  mode lokal (sesi lokal cuma flag sessionStorage, lihat `local-auth.js`).
  Komentar header `crypto.js` juga diperbaiki (sebelumnya masih bilang
  "crypto.ts" / "Dipakai oleh Worker", padahal ini file browser).
- Komentar header `local-auth-middleware.js` yang masih nyebut nama file
  lama `.ts` diperbaiki jadi `.js`.

**Verifikasi:** `node --check` semua file lolos, kurung kurawal balance,
grep konfirmasi tidak ada sisa definisi `toBase64`/`fromBase64` duplikat,
grep konfirmasi `signToken`/`verifyToken` sudah tidak dipanggil di mana pun.

### 4. `public/admin.html`, `index.html`, `login.html` — pisah inline `<script>` [SELESAI]
Ketiga halaman punya blok `<script>...</script>` inline raksasa langsung di
tengah HTML (bukan file `.js` terpisah), plus 1 blok kecil registrasi
Service Worker yang **triplikat identik** di ketiganya. Sekarang:
- `public/js/pages/admin-app.js` (1761 baris) — logika halaman Admin.
- `public/js/pages/kasir-app.js` (2516 baris) — logika halaman Kasir/POS
  (dari `index.html`, dinamai `kasir-app.js` karena `index.html` adalah
  layar kasir, bukan landing page).
- `public/js/pages/login-app.js` (136 baris) — logika halaman Login.
- `public/js/register-sw.js` — 1 file registrasi Service Worker, dipakai
  bertiga (sebelumnya diduplikasi identik di 3 tempat).
- Ketiga HTML sekarang cuma punya `<script src="...">`, tanpa kode inline.
  admin.html: 2616 → 846 baris. index.html: 3425 → 900 baris. login.html:
  302 → 157 baris.

**Insiden selama pengerjaan (dicatat karena penting):** percobaan pertama
salah hitung baris pemotongan (off-by-one) — baris pertama tiap skrip
inline (komentar section header) sempat tidak ikut terpotong ke file
tujuan. **Ketahuan sebelum di-commit ke HTML** lewat verifikasi diff
baris-per-baris terhadap file asli, lalu SEMUA hasil ekstraksi & edit HTML
DIULANG dari file pristine (bukan ditambal di atas hasil yang salah) untuk
menghindari akumulasi error.

**Verifikasi final yang dijalankan:**
- `diff` baris-per-baris tiap file hasil ekstraksi vs rentang baris asli
  (setelah header komentar dibuang) → **identik persis**, bukan cuma cek
  jumlah baris.
- Baris pertama/terakhir tiap potongan dipastikan BUKAN tag `<script>`
  (memverifikasi batas potong tepat, tidak nyangkut tag atau kepotong).
- Jumlah tag `<script>` vs `</script>` di tiap HTML seimbang.
- Konten HTML persis sebelum titik potong (div/markup terakhir sebelum
  `<script src>`) diperiksa manual → utuh, tidak ada markup yang hilang.
- `node --check` pada 3 file `.js` hasil ekstraksi → lolos semua.

### 5. Review profesionalitas + perbaikan bug regresi [SELESAI]
Diminta user untuk cek profesionalitas kode secara umum (security, dst).
Hasil audit:
- **Bug ditemukan & diperbaiki**: `public/sw.js` (app-shell offline cache)
  belum memuat daftar file baru hasil refactor bagian 2 & 4 di atas
  (`/js/lib/*`, `/js/pages/*`, `/js/routes/*`, `/js/register-sw.js`).
  Kalau tidak ditambal, PWA bisa gagal load penuh saat dibuka offline
  pertama kali di halaman yang belum pernah dikunjungi online — regresi
  langsung dari refactor sebelumnya. Sudah ditambal: cache list dilengkapi,
  `CACHE_NAME` di-bump ke `v3-lokal-modular` supaya browser tahu ada versi
  baru yang perlu di-precache ulang.
- Query SQL: 100% parameterized (`.bind()`, dicek 84 pemanggilan), tidak
  ada string-concat input user ke SQL — aman dari SQL injection.
- XSS: `escapeHtml()` dipakai konsisten di titik yang inject data user ke
  `innerHTML` (nama produk, nama pemesan preorder). Titik yang dicurigai
  (struk thermal printer, `receipt-preorder-pemesan`) ternyata pakai
  `.innerText`/plain-text builder, bukan `innerHTML` — aman.
  Kesimpulan: TIDAK ditemukan celah XSS di jalur yang diperiksa.
  Verifikasi sudah dicek langsung ke isi variabel di kode, bukan diasumsikan.
- Password hashing pakai PBKDF2 100rb iterasi + `timingSafeEqual` (bukan
  perbandingan string `===` biasa yang rawan timing attack) — sudah benar.
- PWA setup (viewport mobile-first, manifest.json, service worker) lengkap
  dan strateginya (cache-first + stale-while-revalidate untuk asset,
  network-only untuk `/api/*`) masuk akal untuk use-case offline-first.
- Tidak ada `console.log` debug tersisa di kode produksi.
- **Catatan risiko bawaan (bukan bug, tapi worth diketahui user)**:
  password default `admin123` publik di dokumentasi, tidak ada proteksi
  brute-force di layar login, dan **tidak ada automated test** sama sekali
  di repo — jadi setiap refactor besar wajib diverifikasi manual
  seperti yang dilakukan sepanjang proses ini.

### 6. Setup build APK via Capacitor + GitHub Actions [SELESAI]
User mau APK Android. Karena sandbox ini tidak ada akses internet/Android
SDK (tidak bisa `npx cap add android` atau run Gradle di sini), pendekatan
yang dipakai: siapkan konfigurasi + workflow CI yang build APK otomatis di
server GitHub (ada SDK Android lengkap di sana, gratis).

File baru:
- `capacitor.config.json` — `webDir: "public"` (pakai folder statis yang
  sudah ada apa adanya, tidak perlu ubah struktur), `androidScheme: "https"`
  (PENTING — supaya WebView Android jalan di "secure context", dibutuhkan
  `crypto.subtle` di `crypto.js` dan Service Worker tetap berfungsi persis
  sama di dalam APK).
- `package.json` — ditambah dependency `@capacitor/core`, `@capacitor/android`,
  `@capacitor/cli`, `@capacitor/assets`, + script `cap:sync`/`cap:open`/`cap:icons`.
- `.github/workflows/build-apk.yml` — jalan otomatis tiap push ke
  main/master (atau manual lewat tombol "Run workflow"): install deps →
  build CSS → `npx cap add android` (generate proyek native fresh, TIDAK
  disimpan di git — lihat `.gitignore`) → generate ikon dari
  `public/icons/icon-512.png` → `cap sync` → `gradlew assembleDebug` →
  upload APK sebagai artifact yang bisa diunduh dari tab Actions.
- `PANDUAN-APK.md` — panduan lengkap end-to-end: cara push ke GitHub,
  cara trigger & unduh APK, kenapa "debug" APK (bukan release/Play-Store-
  ready) sudah cukup untuk pemakaian sendiri, cara ganti ikon/nama app,
  dan catatan kalau nanti mau upgrade ke release APK bertanda tangan.
- `.gitignore` ditambah `android/` (proyek native di-generate fresh tiap
  build CI, tidak perlu ikut di-commit).
- README.md ditambah link ke `PANDUAN-APK.md` di tabel dokumentasi.

**Verifikasi yang dijalankan:**
- `package.json` & `capacitor.config.json` dicek valid JSON (`json.load`).
- `.github/workflows/build-apk.yml` dicek valid YAML (`yaml.safe_load`) dan
  jumlah step (11) sesuai yang ditulis.
- **BELUM bisa diverifikasi end-to-end** (build APK sungguhan) karena
  sandbox ini tidak ada akses internet/Android SDK — verifikasi sesungguhnya
  baru terjadi saat user push ke GitHub dan workflow-nya jalan. Kalau ada
  error di step `gradlew assembleDebug` (versi dependency Capacitor yang
  saling tidak cocok, dsb), user perlu paste log error-nya untuk dibantu
  perbaiki — sudah dicatat di bagian Troubleshooting `PANDUAN-APK.md`.

### 7. Aktifkan multi-role login (akun Admin & Kasir terpisah) [SELESAI]
User minta 2 akses terpisah: admin sendiri, kasir sendiri. Ternyata sistem
role-nya (3 role: `super_admin`/`admin_toko`/`kasir`, tabel `users` dengan
kolom `role`, endpoint `/api/users` full CRUD, UI Kelola User di admin.html,
UI hide-menu-admin untuk kasir di kasir-app.js) **sudah lengkap ada di
kode** — cuma sengaja "dimatikan" saat versi lokal disederhanakan jadi 1
password. Jadi ini bukan bikin fitur baru dari nol, tapi **mengaktifkan
kembali** yang sudah ada, dengan hati-hati supaya tidak merusak yang lain.

Perubahan:
- `public/js/local-auth-middleware.js`: `requireRole()` sebelumnya no-op
  (selalu lolos apa pun rolenya) — sekarang benar-benar mengecek
  `session.role` ada di daftar role yang diizinkan, tolak dengan 403 kalau
  tidak. Berlaku otomatis ke **23 endpoint di 10 modul route** yang memang
  sudah lama memanggil `requireRole(...)` (kodenya sudah ada, cuma "tidur").
- `public/js/routes/auth.js`: query login sebelumnya `SELECT * FROM users
  LIMIT 1` (selalu ambil baris pertama, `username` dikirim tapi diabaikan)
  — sekarang `WHERE username = ? AND is_active = 1`, jadi tiap akun login
  dengan usernamenya sendiri. Pesan error diseragamkan jadi "Username atau
  password salah" (tidak bocorkan mana yang salah), dan tetap jalankan
  `verifyPassword` dengan hash dummy walau user tidak ketemu (timing-safe,
  pola yang sama persis dengan versi cloud `src/index.ts`, cuma
  dikembalikan ke local build).
- `public/login.html` + `public/js/pages/login-app.js`: form login
  ditambah field **Username** (sebelumnya cuma Password), dikirim bareng ke
  `/api/auth/login`. Hint password default diupdate jadi "admin / admin123"
  (sebelumnya cuma nyebut password, bukan username).
- `public/js/local-auth.js`: cuma perbaikan komentar header (sebelumnya
  bilang "cuma 1 password", sekarang jelaskan multi-akun + cara tambah akun
  kasir lewat Admin → Kelola User). **Tidak ada perubahan logika** — sesi
  di local-auth.js sudah lama menyimpan `role`/`uid`/`toko_id` per akun,
  cuma belum ada yang membacanya secara ketat sampai `requireRole` diaktifkan.
- `PANDUAN-MODE-LOKAL.md`: tabel perbandingan & bagian "Pertama kali pakai"
  diperbarui (sebelumnya bilang "1 password untuk seluruh HP", sekarang
  jelaskan cara bikin akun kasir terpisah).

**Cara pakai (untuk user):** akun awal `admin`/`admin123` (role Super
Admin, akses penuh). Untuk akun kasir terpisah: Admin → Kelola User →
Tambah User → pilih role **Kasir**. Akun kasir otomatis tidak bisa buka
menu Admin/Laporan/Pengaturan (baik di UI maupun ditolak di level API kalau
dicoba akses langsung).

**Verifikasi yang dijalankan:**
- Ditelusuri dulu apakah UI role-based sudah ada (hide menu admin untuk
  kasir, redirect kasir yang coba buka admin.html) — SUDAH ADA & benar,
  tidak perlu ditulis ulang.
- Ditelusuri endpoint `/api/users` (create/update user) — sudah lengkap &
  sudah ada proteksi keamanan bawaan (admin_toko tidak bisa
  ubah/nonaktifkan akun di luar tokonya, minimal 1 super_admin aktif harus
  tersisa) — tidak disentuh, sudah benar.
- `node --check` di semua file `.js` yang disentuh + full sweep ulang
  seluruh proyek → lolos semua.
- Kurung tag `<script>`/`</script>` di `login.html` tetap seimbang setelah
  nambah field username.
- Dicek `crypto.js` (dipakai dynamic `import()` dari `local-auth.js`) TIDAK
  pernah dimuat sebagai classic `<script src>` di HTML manapun — jadi
  `export function` di dalamnya aman (kalau sampai ada yang muat dia lewat
  classic script tag, itu akan jadi SyntaxError; dipastikan tidak terjadi).

### 8. Wizard "Setup Awal" — ganti password bawaan dengan setup mandiri [SELESAI]
Tindak lanjut dari saran review profesionalitas: password default
`admin123` yang sama di semua instalasi (tertulis terbuka di dokumentasi)
diganti jadi wizard setup — pemilik toko WAJIB bikin username & password
sendiri saat pertama kali buka aplikasi, sebelum aplikasi bisa dipakai
sama sekali.

Perubahan:
- `public/js/local-auth.js`: `ensureDefaultAccount()` (yang diam-diam bikin
  akun `admin`/`admin123`) **dihapus**, diganti `needsSetup()` — cuma
  mengecek apakah tabel `users` kosong, TIDAK membuat apa pun.
- `public/js/fetch-shim.js`: dry-run bootstrap `LocalAppReady` sekarang
  manggil `needsSetup()`, event `localapp-ready` membawa
  `{ needsSetup: true/false }` (sebelumnya `{ created, username, password }`).
- `public/js/routes/auth.js`: endpoint baru **`POST /api/auth/setup`**
  (tanpa `requireAuth` — memang belum ada akun sama sekali saat dipanggil).
  Pengecekan "cuma boleh sekali" dilakukan **di server** (query
  `SELECT id FROM users LIMIT 1`, bukan percaya flag dari client) — kalau
  sudah ada user, ditolak 409. Validasi: semua kolom wajib, password
  minimal 6 karakter, username 3-32 karakter (huruf/angka/titik/underscore
  saja). Setelah berhasil: insert user role `super_admin`, update
  `toko.nama`, upsert `pengaturan.app_title`, langsung `markUnlocked()`
  (auto-login, tidak perlu login manual lagi setelah setup).
- `public/login.html`: form login lama dibungkus `#login-mode-wrap`,
  ditambah `#setup-mode-wrap` (wizard baru: Nama Toko, Nama Lengkap,
  Username, Password, Ulangi Password) — disembunyikan/ditampilkan lewat JS
  tergantung `needsSetup`. Banner lama yang menyebut "admin/admin123" di
  hapus.
- `public/js/pages/login-app.js`: listener `localapp-ready` diganti dari
  "tampilkan hint password default" jadi "toggle ke mode wizard kalau
  `needsSetup`". Fungsi baru `handleSetup()` — validasi password==konfirmasi
  di client (selain divalidasi lagi di server), POST ke
  `/api/auth/setup`, auto-redirect ke `index.html` setelah sukses (pola
  sama dengan `handleLogin()` yang sudah ada).
- `public/sw.js`: `CACHE_NAME` di-bump ke `v4-setup-wizard` (isi file yang
  sudah di-precache berubah signifikan — login.html, local-auth.js,
  fetch-shim.js, routes/auth.js, pages/login-app.js — perlu dipastikan
  pengguna lama dapat update-nya, bukan cuma andalkan
  stale-while-revalidate pasif).
- `PANDUAN-MODE-LOKAL.md`: bagian "Pertama kali pakai" diperbarui, tidak
  lagi menyebut password bawaan.

**Verifikasi yang dijalankan:**
- Ditelusuri dulu skema `toko`/`pengaturan` (nama kolom, id toko default=1
  dari migration) sebelum nulis query UPDATE/INSERT, supaya tidak menebak.
- Pola `result.meta.last_row_id` dicek dulu konsisten dipakai di route lain
  sebelum dipakai di endpoint setup baru.
- `node --check` di semua file `.js` yang disentuh + full sweep ulang
  seluruh proyek → lolos semua.
- Tag `<div>`/`<form>`/`<input>`/`<button>` di `login.html` dihitung
  seimbang setelah restrukturisasi jadi 2 mode (login vs setup).
- Sweep ulang seluruh repo (`grep -rl "admin123"`) memastikan tidak ada
  sisa referensi password bawaan yang masih aktif secara fungsional (yang
  tersisa cuma di `proses.md` ini sebagai catatan riwayat, dan 1 komentar
  penjelas di `login.html` yang menjelaskan perilaku LAMA, bukan kode aktif).
- **Catatan sampingan yang ditemukan (bukan bug baru, pre-existing)**:
  `public/index.html` punya selisih 1 tag `<div>`/`</div>` yang tidak
  seimbang — dicek dan **sudah ada sejak file ASLI sebelum disentuh sama
  sekali** (191 vs 190 di file original), bukan regresi dari refactor
  manapun di sesi ini. Tidak diperbaiki (di luar scope, dan browser
  toleran terhadap ini — aplikasi aslinya sudah jalan normal dengan kondisi
  ini).

### 9. Self-host semua asset CDN (Font Awesome, Google Fonts, xlsx.js, Chart.js, qrcodejs) [SELESAI — tapi lihat catatan penting]
User minta supaya semua file/gambar yang tadinya dimuat dari CDN luar
didownload total saat instal awal, supaya buka berikutnya lebih cepat &
bisa full offline dari awal (relevan juga buat APK). Didiskusikan dulu
sebelum eksekusi (sesuai arahan user) — dipilih opsi **self-host**
(bukan cuma andalkan cache-after-first-visit yang sudah otomatis jalan
lewat `sw.js`), karena lebih kokoh & konsisten dengan filosofi "semua
lokal" yang sudah dipakai project ini (`sql-wasm.js` sudah divendor
duluan, bukan dari CDN).

**Kendala jujur yang dihadapi**: sandbox ini **tidak ada akses internet**
(dites langsung dengan `curl`, hasilnya diblokir egress proxy —
`x-deny-reason: host_not_allowed`), jadi TIDAK BISA download file
Font Awesome/Google Fonts/dst secara langsung dari sini. Solusinya: dibuat
script + workflow yang men-download-nya di lingkungan yang PUNYA internet
(GitHub Actions), bukan dikerjakan manual di sini.

File baru:
- `scripts/vendor-fetch.mjs` — script Node (pakai `fetch` bawaan, tanpa
  dependency tambahan) yang: (1) download CSS Font Awesome 6.4.0, cari
  semua referensi `url(...)` webfont di dalamnya, download tiap font, tulis
  ulang CSS supaya nunjuk ke path lokal; (2) hal yang sama untuk Google
  Fonts (gabungan SEMUA weight Sora/Plus Jakarta Sans/JetBrains Mono yang
  dipakai di 3 halaman jadi 1 file CSS lokal bersama); (3) download
  xlsx.js/Chart.js/qrcodejs apa adanya (file tunggal, tanpa referensi
  internal); (4) tulis `public/vendor-manifest.json` — daftar SEMUA path
  yang berhasil didownload (perlu karena nama file font dari CDN itu
  hash-based, baru diketahui SETELAH didownload, jadi tidak bisa
  di-hardcode di `sw.js` sebelumnya).
- `.github/workflows/vendor-assets.yml` — workflow manual (tab Actions →
  "Vendor CDN Assets (self-host offline)" → Run workflow) yang menjalankan
  script itu DAN auto-commit hasilnya balik ke repo. Jadi user tidak perlu
  install Node.js sendiri untuk langkah ini.
- `public/sw.js`: install handler diubah — sebelumnya cuma `cache.addAll(
  APP_SHELL)` (daftar statis), sekarang juga fetch `/vendor-manifest.json`
  dulu (kalau ada) dan ikut precache semua path di dalamnya. Kalau manifest
  belum ada (vendor-fetch belum pernah dijalankan), gagal dengan aman —
  app-shell inti tetap ke-precache, cuma font/xlsx/Chart/QR belum
  offline-ready sampai manifest itu ada. `CACHE_NAME` di-bump ke
  `v5-vendored-assets`.
- `public/admin.html`, `index.html`, `login.html`: semua tag
  `<link>`/`<script>` yang tadinya mengarah ke `cdnjs.cloudflare.com` /
  `fonts.googleapis.com` / `fonts.gstatic.com` diganti ke path lokal
  (`/fonts/fontawesome/...`, `/fonts/google/fonts.css`,
  `/js/vendor/xlsx.full.min.js`, dst). Tag `<link rel="preconnect">` ke
  domain font (yang cuma relevan kalau masih fetch dari domain itu) ikut
  dihapus karena sudah tidak dipakai.
- `package.json`: script baru `vendor:fetch`. Script `deploy` diubah jadi
  `vendor:fetch && build:css && wrangler deploy` — supaya deploy web SELALU
  bawa asset lengkap (deploy toh sudah butuh internet untuk `wrangler
  deploy`, jadi tidak menambah prasyarat baru).
- `.github/workflows/build-apk.yml`: ditambah step `npm run vendor:fetch`
  sebelum build CSS — supaya APK SELALU offline-ready dari awal, tidak
  gantung apakah workflow vendor-assets terpisah sudah pernah dijalankan
  atau file-nya sempat lupa di-commit.
- `PANDUAN-MODE-LOKAL.md`: bagian baru "Asset offline" menjelaskan
  kenapa ini WAJIB disiapkan (tidak ada fallback CDN lagi setelah
  perubahan ini) dan 2 cara menyiapkannya.
- `README.md`, `PANDUAN-APK.md`: catatan singkat menunjuk ke penjelasan di
  atas.

**PENTING — status saat file zip ini diserahkan ke user:**
Karena TIDAK ADA cara bagi saya untuk benar-benar mengunduh file-file itu
di sandbox ini, **`public/fonts/`, `public/js/vendor/xlsx.full.min.js`
dst, dan `public/vendor-manifest.json` BELUM ADA di dalam zip ini** — cuma
kode/script/workflow-nya yang sudah siap. HTML sekarang **TIDAK PUNYA
fallback ke CDN sama sekali** (sengaja dihapus semua), jadi kalau
langsung dipakai/dideploy TANPA menjalankan salah satu dari 2 cara di
`PANDUAN-MODE-LOKAL.md` (workflow "Vendor CDN Assets" ATAU
`npm run vendor:fetch` manual) dulu, ikon/font akan hilang dan fitur
export Excel/Chart/QR akan error. Ini BUKAN opsional — wajib dijalankan
sekali sebelum dipakai.

**Verifikasi yang dijalankan (tanpa jaringan sungguhan):**
- Regex ekstraksi & penulisan-ulang `url(...)` di CSS ditest dengan data
  tiruan yang meniru struktur asli Font Awesome (referensi relatif
  `../webfonts/...`) dan Google Fonts CSS2 (referensi absolut ke
  `fonts.gstatic.com`, beberapa font-weight beda file) — hasilnya benar
  di kedua kasus (lihat log test: jumlah referensi unik, nama file hasil
  mapping, isi CSS setelah ditulis ulang — semua sesuai ekspektasi).
- Seluruh `main()` di `vendor-fetch.mjs` dijalankan end-to-end dengan
  `global.fetch` di-mock (tidak ada request jaringan sungguhan) — dicek
  struktur folder & file yang dihasilkan (`find public -type f`), isi
  `vendor-manifest.json`, dan isi CSS hasil rewrite — semuanya sesuai
  desain (path relatif `../webfonts/` dan `./files/` konsisten dengan
  struktur folder yang sebenarnya dibuat).
- `node --check` untuk `vendor-fetch.mjs` dan `sw.js` → lolos.
- Tag `<link>`/`<script>` di 3 HTML dihitung ulang seimbang setelah ganti
  ke path lokal.
- YAML `vendor-assets.yml` & `build-apk.yml` (setelah ditambah step baru)
  divalidasi `yaml.safe_load`.
- **Batasan yang TIDAK bisa diverifikasi di sini**: respons HTTP
  sungguhan dari `cdnjs.cloudflare.com`/`fonts.googleapis.com` saat ini
  (format response bisa saja sedikit berbeda dari asumsi di script kalau
  CDN mengubah struktur), dan hasil `gradlew assembleDebug`/`wrangler
  deploy` yang sesungguhnya. Kalau workflow "Vendor CDN Assets" atau
  "Build APK" gagal saat dijalankan user, paste log errornya untuk
  dibantu debug.

### 10. User minta kerjakan item 6, 3, 1, 4, 7, 8 dari daftar "belum dikerjakan" [SEBAGIAN BESAR SELESAI]

Konteks: Playwright (Chromium) ternyata tersedia di sandbox ini dan bisa
jalan headless TANPA internet (browser binary sudah ter-cache). Ini
mengubah banyak hal — sebelumnya verifikasi cuma lewat baca kode, sekarang
bisa benar-benar jalankan aplikasi di browser sungguhan.

**Item 6 (selisih tag `<div>` di index.html) — TERNYATA BUKAN BUG.**
Dicek ulang pakai parser python yang comment-aware: selisih 1 yang
dilaporkan di bagian 8 sebelumnya adalah **false-positive** — teks literal
`<div>` yang disebut di dalam **komentar CSS** (menjelaskan riwayat
perbaikan), ikut kehitung oleh `grep` polos yang dipakai sebelumnya. Setelah
blok `<style>` dikecualikan dari hitungan: 158 buka / 158 tutup, seimbang
sempurna. Tidak ada perbaikan kode yang diperlukan.

**Item 7 (tes langsung di browser) — dikerjakan, dan MENEMUKAN 3 BUG NYATA
dari sesi-sesi sebelumnya:**
1. **Bug kritis**: `public/js/mini-hono.js` (router lokal buatan sendiri,
   dipakai sejak project ini disederhanakan ke mode lokal) **tidak pernah
   punya method `.route()`**. Method ini dipakai untuk mount sub-router
   saat `local-app.js` dipecah jadi modul di bagian 2 — tapi tidak pernah
   diverifikasi terhadap implementasi mini-hono.js yang sebenarnya (waktu
   itu cuma dicek: diff daftar method+path sebelum/sesudah split, dan
   syntax check — keduanya TIDAK akan menangkap "method ini tidak ada saat
   runtime"). Akibatnya: **seluruh aplikasi versi lokal gagal start total**
   sejak refactor bagian 2 — bukan cuma fitur baru, SEMUA fitur, karena
   `local-app.js` throw error saat racik router, sebelum sempat mount apa
   pun. **Diperbaiki**: `.route(prefix, subApp)` ditambahkan ke class Hono
   di mini-hono.js (gabung route dari sub-router, prefix digabung pakai
   helper `joinPaths`), plus pattern asli tiap route disimpan (`r.pattern`)
   supaya bisa direkonstruksi ulang saat mounting.
2. **Bug**: `public/js/routes/users.js` dan `public/js/routes/settings.js`
   memanggil `catatLog(...)` tapi TIDAK pernah meng-import-nya dari
   `lib/helpers.js` — sisa kelalaian script pemisahan modul di bagian 1 & 2
   (kedua modul itu cuma dikasih import crypto-related, HELPERS_IMPORT_ALL
   lupa disertakan). Sama persis terjadi juga di versi TS legacy
   (`src/routes/users.ts`, `src/routes/settings.ts`). **Diperbaiki di
   ke-4 file.** Dampak sebelumnya: setiap kali admin tambah/ubah user atau
   ubah pengaturan toko, selalu gagal dengan pesan generik "Gagal menambah
   user" / serupa (ReferenceError tertangkap try/catch, jadi errornya
   tersembunyi dari pengguna).
3. **Bug**: `public/js/lib/base64.js` (hasil dedup di bagian 3) menulis
   `function toBase64`/`function fromBase64` di TOP-LEVEL (tanpa IIFE) —
   di halaman `admin.html`, ini bentrok dengan `local-backup.js` yang JUGA
   punya `const { toBase64, fromBase64 } = window.Base64Util` di top-level
   (classic script berbagi lexical scope top-level yang sama antar
   `<script>` tag dalam 1 dokumen). Errornya: `Identifier 'toBase64' has
   already been declared` — bikin SELURUH script `local-backup.js` gagal
   parse, jadi fitur backup/restore mati total di halaman admin.
   **Diperbaiki**: isi `base64.js` dibungkus IIFE (pola sama seperti
   `local-images.js`), cuma `window.Base64Util` yang bocor ke global.

Setelah 3 perbaikan itu, tes ulang lengkap (wizard setup, login benar/salah,
cegah setup ganda, data tersimpan di IndexedDB, role kasir vs admin/RBAC,
akses API ditolak/diizinkan sesuai role, kasir diusir dari admin.html,
super_admin tetap bisa) — **semua lolos, nol JS error di 3 halaman**.

**Item 4 (automated test) — ditambahkan dari nol:**
- `tests/unit/helpers.test.mjs` — 21 unit test (`node:test` bawaan, tanpa
  dependency tambahan) untuk logika hitung pembayaran (`hitungSplitPayment`,
  `hitungPembayaranSebagian` — termasuk kasus split payment, penolakan
  kembalian non-tunai, validasi metode), `kodeTransaksi`, dan helper
  tanggal/jam WIB.
- `tests/e2e/setup-and-login.test.mjs` (12 assertion) dan
  `tests/e2e/rbac.test.mjs` (7 assertion) — pakai Playwright + server statis
  Node bawaan (`node:http`, tanpa Python/dependency lain), benar-benar
  menjalankan mini-hono.js/local-db.js/sql.js/IndexedDB sungguhan di
  Chromium headless. Ini yang menemukan 3 bug di atas.
- `tests/e2e/run.mjs` — runner sederhana yang eksekusi semua file
  `*.test.mjs` di folder e2e/.
- `package.json`: script `test:unit`, `test:e2e`, `test`,
  `test:e2e:install` (download browser Chromium sekali). `playwright`
  ditambah sebagai devDependency.
- `.github/workflows/test.yml` — jalan otomatis tiap push/PR: install
  Chromium (`playwright install --with-deps chromium`), lalu
  `test:unit` + `test:e2e`.
- **Verifikasi**: `npm test` dijalankan penuh di sandbox ini (pakai
  symlink sementara ke Playwright yang sudah ter-cache global, DIHAPUS lagi
  setelah selesai — bukan bagian dari repo) → 21 unit + 19 e2e = 40 test,
  semua lolos.

**Item 3 (release APK bertanda tangan) — infrastruktur disiapkan, TANPA
membuatkan keystore produksi untuk user** (sengaja — keystore signing
harus dibuat & dipegang eksklusif oleh pemilik app, bukan oleh AI/pihak
ketiga manapun; kalau saya yang buatkan, secara prinsip keamanan itu
bermasalah walau secara teknis saya BISA, karena `keytool`/Java tersedia
di sandbox ini dan sempat dicoba+divalidasi lalu segera dihapus lagi).
- `scripts/patch-android-signing.mjs` — suntik blok `signingConfigs` ke
  `android/app/build.gradle` (yang di-generate fresh oleh `cap add android`
  tiap run CI, bukan dari repo), baca kredensial dari environment variable.
  Idempotent (aman dipanggil 2x), gagal-cepat dengan pesan jelas kalau env
  var kosong atau pola `buildTypes {` / `release {` tidak ketemu.
  **Ditest 2x dengan mock build.gradle** realistis (termasuk skenario ada
  blok `debug {}` sebelum `release {}`) — sempat ketahuan & diperbaiki bug
  urutan operasi (signingConfigs yang baru disisipkan sendiri punya
  sub-blok "release {" yang salah kena regex pencarian generik kalau
  disisipkan sebelum pencarian releasenya buildTypes).
- `.github/workflows/build-apk-release.yml` — trigger manual
  (`workflow_dispatch`, input `version_name`/`version_code`), baca 4
  GitHub Secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`,
  `KEY_PASSWORD`), decode keystore ke file sementara, jalankan patch
  signing, `gradlew assembleRelease`, hapus file keystore sementara
  (`if: always()`), upload APK hasil sebagai artifact.
- `PANDUAN-APK.md` — bagian baru lengkap: command `keytool` persis untuk
  generate keystore SENDIRI, cara encode base64, cara simpan sebagai
  GitHub Secrets, cara trigger workflow, peringatan keras soal keystore
  hilang = tidak bisa update app di Play Store lagi selamanya.

**Item 8 (dokumentasi basi) — `PANDUAN-DEPLOY.md` ditulis ulang TOTAL**
(sebelumnya 313 baris 100% membahas arsitektur cloud lama: D1 migration
manual 13 langkah, R2 bucket, `JWT_SECRET`, cookie session, geo-restriction
`ENFORCE_GEO` — **semua sudah tidak ada** di `wrangler.toml` versi lokal
saat ini, dan separuh command yang didokumentasikan, mis. seluruh
`db:migrate:*`, **sudah tidak ada** di `package.json` sama sekali, jadi
dokumen lama itu 100% tidak bisa diikuti). Dokumen baru menjelaskan alur
deploy static-only yang sebenarnya (Setup Awal via wizard, bukan generate
password hash manual; backup/restore lewat in-app export/import, bukan
`wrangler d1 export`; troubleshooting untuk isu mode lokal — asset offline
belum di-vendor, IndexedDB, service worker, dst).
`README.md` juga diperbaiki (bukan cuma Quick Start seperti rencana awal,
tapi ternyata paragraf pembuka, bagian Keamanan, dan Tech Stack semuanya
masih mendeskripsikan arsitektur D1/R2/Worker/cookie-JWT yang sudah tidak
akurat — ikut ditulis ulang supaya konsisten).

**Temuan tambahan yang DICATAT tapi TIDAK diperbaiki (di luar scope
literal permintaan)**: `REFERENSI-API.md` (193 baris) juga basi — masih
bilang "cookie sesi" dan menyebut `src/index.ts` (kode legacy/nonaktif)
sebagai sumber kebenaran API, padahal source aktifnya sekarang
`public/js/routes/*.js`. Daftar endpoint di dalamnya kemungkinan besar
masih akurat (method+path sama, cuma cara aksesnya beda), tapi
deskripsi mekanisme auth-nya menyesatkan. Belum ditulis ulang.

**Item 1 (tes vendor-fetch ke CDN sungguhan) — TETAP TIDAK BISA
dikerjakan.** Dicoba lagi dengan pendekatan berbeda (browser Playwright,
bukan cuma `curl` di bash) — hasilnya SAMA, `403 host_not_allowed` saat
`page.goto()` ke `cdnjs.cloudflare.com`. Ini kebijakan jaringan sandbox
level infrastruktur (bukan batasan tool tertentu), jadi tidak ada cara di
sisi saya untuk mengatasinya. **User WAJIB tetap menjalankan workflow
"Vendor CDN Assets" sendiri** (lewat GitHub Actions, yang punya akses
internet) sebelum pakai/deploy aplikasi ini — lihat bagian 9.

### 11. Rebrand total: "Kasir Harvey" → "muidsoft" [SELESAI]

User upload `muidsoft-brand-assets.zip` (paket brand lengkap: logo PNG/SVG
primary+stacked+appicon+icon-mark, favicon semua ukuran, ikon Android/iOS,
README brand guideline dengan kode warna resmi) dan minta ganti logo +
nama aplikasi. Dikerjakan menyeluruh, bukan cuma cari-ganti teks:

**Logo & ikon (file biner, bukan teks):**
- `public/icons/icon-192.png`, `icon-512.png` (dipakai `manifest.json`) —
  diganti dari `favicon-192x192.png`/`favicon-512x512.png` di paket brand.
- `public/favicon.ico`, `public/favicon.svg`, `public/apple-touch-icon.png`
  — file baru, sebelumnya app ini cuma pakai 1 file (`icon-192.png`) untuk
  semua keperluan favicon (kurang optimal). Sekalian dirapikan pakai
  `<link rel="icon">` terpisah untuk `.ico` (fallback lama) dan `.svg`
  (modern, scalable) + `<link rel="apple-touch-icon">` sendiri, di ketiga
  halaman (login/index/admin).
- `public/brand/muidsoft-appicon.png` (+svg, +icon-mark-white) — buat logo
  yang tampil LANGSUNG di UI (bukan cuma favicon tab browser): hero halaman
  login, header admin.html, avatar tombol akun di index.html. Sebelumnya
  ketiga tempat ini bukan gambar sama sekali — kotak gradient emas + ikon
  Font Awesome `fa-store` generik. Sekarang `<img>` logo asli.
- `assets/icon.png` (1024×1024, dari `ios/AppIcon-1024x1024.png` di paket
  brand) — **sekalian menemukan & memperbaiki bug tersembunyi dari sesi
  APK sebelumnya**: step "Generate ikon & splash screen" di kedua workflow
  APK selama ini nunjuk ke folder `public/icons/` di komentar, TAPI
  `@capacitor/assets generate` sebenarnya baca source dari folder
  `assets/` di root project (konvensi tool itu, bukan `public/icons/`) —
  folder itu sebelumnya TIDAK PERNAH ada di repo, jadi ikon custom
  kemungkinan besar **diam-diam gagal ke-generate** selama ini (ketutup
  `|| true` di command-nya, jadi tidak ada error yang kelihatan di log CI).
  Sekarang `assets/icon.png` dibuat + komentar/dokumentasi diperbaiki di
  kedua workflow dan `PANDUAN-APK.md`.

**Teks/identitas produk (product branding, BUKAN nama toko yang
dikonfigurasi tiap pemilik toko sendiri-sendiri — itu tetap terpisah &
tetap bisa diisi bebas lewat wizard Setup Awal):**
- `<title>` di 4 halaman HTML, `manifest.json` (name/short_name +
  `background_color` diganti ke warna resmi brand `#050D1C`),
  `capacitor.config.json` (`appName` + `appId` jadi `com.muidsoft.kasir` —
  **ganti App ID artinya Android anggap ini APLIKASI BEDA** dari APK lama
  yang mungkin sudah terinstall dengan App ID lama; ini konsekuensi yang
  memang tidak terhindarkan kalau appId ikut diganti, sudah pernah
  disinggung sebagai risiko di `PANDUAN-APK.md` bagian ganti App ID).
- `package.json` (`name`) dan `wrangler.toml` (`name`, ini yang menentukan
  URL Cloudflare Workers — **mengubah ini = URL deploy berubah**, kalau
  sudah pernah deploy dengan nama lama, deploy ulang pakai nama baru akan
  bikin Worker BARU, bukan update yang lama; user perlu redeploy manual &
  urus custom domain lagi kalau pakai).
- Teks fallback `'Kasir Harvey'` di 7 titik across `admin-app.js`,
  `kasir-app.js` (4 titik: header, receipt, 2x print thermal),
  `login-app.js`, `routes/settings.js` (+ versi legacy TS-nya,
  `src/routes/settings.ts`) → `'muidsoft'`.
- `sw.js`: `CACHE_NAME` di-rename + bump versi (`v6-rebrand`) — perlu,
  supaya browser yang sudah pernah install PWA versi lama dapat asset baru
  (logo/nama baru), bukan kepentok cache lama.
- Semua judul dokumen (`README.md`, `PANDUAN-DEPLOY.md`,
  `PANDUAN-MODE-LOKAL.md`, `PANDUAN-PENGGUNA.md`, `REFERENSI-API.md`) +
  1 instruksi navigasi settings HP yang menyebut nama app
  (`PANDUAN-MODE-LOKAL.md`).
- Migration `0013_kasir_toko.sql`: nilai default `toko.nama`/`app_title`
  yang di-seed diganti ke `'muidsoft'`. **Ditemukan bug duplikasi file**:
  project ini punya migration di 2 tempat (`migrations/` untuk referensi
  `wrangler d1 execute` versi cloud lama, dan `public/migrations/` yang
  BENERAN dipakai runtime oleh `local-db.js` lewat fetch) — sempat cuma
  edit yang di `migrations/` saja lalu ketahuan lewat sweep menyeluruh
  bahwa `public/migrations/0013_kasir_toko.sql` adalah salinan terpisah
  yang tidak otomatis ikut berubah. Dicek juga 12 file migration lain,
  tidak ada drift selain yang satu ini. Kedua salinan sekarang disamakan.
- Nama file unduhan backup (`backup-kasir-harvey-*.json` →
  `backup-muidsoft-*.json`) dan pesan error validasi backup — **cuma
  bagian yang user-facing**, diganti dengan aman.
- Artifact name di kedua workflow APK + contoh alias keystore di
  `PANDUAN-APK.md` (`kasir-harvey` → `muidsoft`, cuma nama saran, bukan
  hal teknis yang mengunci apa pun).

**SENGAJA TIDAK diubah (data-safety, bukan lupa)** — ditambahi komentar
peringatan tebal di kode supaya tidak kepencet "diperbaiki" di masa depan
tanpa sadar konsekuensinya:
- `IDB_NAME = 'kasir_harvey_local'` di `idb-helper.js` — ini nama
  database IndexedDB SUNGGUHAN. Kalau diubah, SEMUA instalasi yang sudah
  pernah dipakai akan kehilangan akses ke data lamanya (browser bikin DB
  baru kosong di bawah nama baru, data lama jadi orphan).
- `app: 'kasir-harvey-local-backup'` marker di `local-backup.js` (dipakai
  2 tempat: saat export DAN saat validasi import) — kalau diubah, semua
  file backup yang SUDAH PERNAH diunduh user jadi tidak bisa di-restore
  lagi (dianggap "bukan file backup yang valid").

**Verifikasi yang dijalankan:**
- Sweep `grep -rli` menyeluruh ke SEMUA tipe file di repo (bukan cuma
  `.html`/`.md` yang jadi dugaan awal) — ini yang menemukan bug duplikasi
  migration di atas, dan konfirmasi tidak ada file lain yang kelewat.
- `node --check` ulang semua file `.js` yang disentuh + full sweep proyek.
- `python3 -c json.load(...)` untuk `package.json`, `capacitor.config.json`,
  `public/manifest.json`.
- `yaml.safe_load` untuk kedua workflow APK setelah di-`sed`.
- **`npm test` penuh dijalankan ulang** (21 unit + 19 e2e, browser
  sungguhan) — SEMUA MASIH LOLOS, memastikan rebrand tidak merusak
  fungsionalitas (terutama alur setup/login yang paling banyak disentuh
  sesi-sesi sebelumnya).
- Tes tambahan khusus: load ketiga halaman HTML di browser sungguhan,
  tangkap SEMUA response HTTP berstatus ≥400 — dikonfirmasi 404 yang
  muncul CUMA untuk asset CDN yang memang belum di-vendor (masalah lama,
  item 9/1, tidak berubah), BUKAN untuk file logo/favicon baru manapun —
  semua asset branding baru berhasil dimuat tanpa error.

### 12. Fix akses kamera + fitur gambar produk [SELESAI]

User minta "fix akses kamera dan tambah gambar di produk". Investigasi
awal: KEDUANYA sudah ada di kode (bukan hilang), tapi diuji langsung pakai
Playwright (server statis Node + browser Chromium, `--use-fake-device-for-
media-stream` untuk simulasi kamera) — ditemukan 3 bug nyata yang bikin
keduanya rapuh/gagal di kondisi tertentu, semua berkat pola "test dulu,
jangan cuma baca kode" yang juga menemukan bug-bug besar di sesi
sebelumnya (bagian 10).

**Bug 1 — fallback scanner barcode masih dari CDN.** `kasir-app.js` sudah
punya scan-via-kamera yang bagus: prioritas `BarcodeDetector` native
(Chrome/Android), fallback ke ZXing kalau tidak didukung (Safari/iOS,
Firefox, DAN banyak WebView Android versi lama yang dipakai APK — jadi
fallback ini sebenarnya SERING kepakai, bukan cuma jarang). Tapi ZXing-nya
dimuat dari `unpkg.com` — CDN yang TIDAK ikut proses self-hosting di
bagian 9 (lolos sweep karena beda domain, `unpkg.com` bukan `cdnjs.
cloudflare.com`/`fonts.googleapis.com`). Kalau HP offline & butuh
fallback ZXing, scanner gagal total.
**Diperbaiki**: `scripts/vendor-fetch.mjs` ditambah 1 library lagi
(`@zxing/browser@0.2.1` dari unpkg, tetap dipin versinya persis sama demi
alasan supply-chain yang sudah dijelaskan di komentar aslinya), `kasir-
app.js` baca dari `/js/vendor/zxing-browser.min.js` lokal. Dites ulang
`vendor-fetch.mjs` dengan mock fetch — manifest sekarang 8 file (tadinya 7).

**Bug 2 — izin kamera Android tidak dideklarasikan.** Kode JS
`getUserMedia()`-nya benar dan jalan normal di browser biasa, TAPI kalau
dibungkus jadi APK (WebView via Capacitor), Android tetap butuh
`android.permission.CAMERA` dideklarasikan eksplisit di
`AndroidManifest.xml` supaya WebView-nya bisa minta izin ke sistem saat
runtime — template default `cap add android` TIDAK otomatis menambahkan
ini (App ini butuh kamera untuk fitur SPESIFIK/opsional, bukan sesuatu
yang Capacitor bisa tebak otomatis).
**Diperbaiki**: `scripts/patch-android-permissions.mjs` (pola sama dengan
`patch-android-signing.mjs` di bagian 6 — baca-tulis XML, idempotent,
gagal-cepat dengan pesan jelas kalau struktur `<manifest>` tidak
ditemukan). Ditest 2x dengan mock `AndroidManifest.xml` realistis:
sekali insert yang benar, sekali lagi untuk konfirmasi idempotent (tidak
dobel). Dipasang sebagai step baru di KEDUA workflow APK (`build-apk.yml`
dan `build-apk-release.yml`), tepat setelah `cap add android`.

**Bug 3 — placeholder foto produk manggil CDN eksternal.** Upload foto
produk sendiri **TIDAK ada bug** — dites langsung end-to-end (upload lewat
`FormData` ke `/api/upload/produk`, lalu `GET /api/gambar/:key` ambil lagi)
dan berhasil sempurna, backend R2-mimicking-lewat-IndexedDB (`local-
images.js`) berfungsi benar. TAPI produk yang BELUM ada fotonya (kasus
paling umum — banyak toko kecil tidak sempat foto tiap produk) pakai
placeholder dari `https://ui-avatars.com` — CDN eksternal lain yang lolos
dari sweep bagian 9 karena bukan library/font, melainkan dipanggil
langsung dari `kasir-app.js` sebagai bagian dari `products.map()`.
Konsekuensi: kartu produk tanpa foto gagal tampil ikonnya kalau HP
offline — bertentangan langsung dengan premis utama app ini.
**Diperbaiki**: fungsi baru `localPlaceholderImg(nama)` — generate SVG
data URI lokal (2 huruf inisial nama produk, warna sama persis dengan
gaya `ui-avatars.com` sebelumnya: background `#eff6ff`, teks `#2563eb`)
TANPA request jaringan sama sekali. Diverifikasi 2 lapis: (1) test logika
Node murni dengan nama produk normal + nama produk yang sengaja
mengandung karakter `<script>` (XSS-safety check, aman karena cuma 2
karakter pertama yang dipakai + tetap di-escape), (2) di-render
sungguhan di browser Playwright, `naturalWidth` dicek = 200 (bukan 0),
DAN discreenshot untuk verifikasi visual — hasilnya identik gaya dengan
yang lama, cuma sumbernya lokal.

**Bonus — pesan error kamera diperjelas.** Sebelumnya cuma 1 pesan
generik ("cek izin kamera di browser") untuk SEMUA kemungkinan penyebab
gagal. Sekarang: dicek dulu `window.isSecureContext` (kamera butuh HTTPS)
dan dukungan `navigator.mediaDevices` SEBELUM minta kamera, lalu di catch
block dipetakan per `err.name` (`NotAllowedError` = izin ditolak,
`NotFoundError` = tidak ada kamera, `NotReadableError` = kamera dipakai
app lain, `OverconstrainedError` = mode tidak didukung) — masing-masing
dengan saran tindakan yang beda & relevan.

**Verifikasi akhir**: `sw.js` `CACHE_NAME` di-bump (`v7-camera-gambar-
fix`). Test baru ditulis PERMANEN (bukan cuma dites manual lalu dibuang):
`tests/e2e/camera-dan-gambar-produk.test.mjs` (9 assertion — upload+ambil
gambar, tidak ada request ke `ui-avatars.com`, modal scan terbuka tanpa
page error pakai fake camera device). `npm test` penuh dijalankan ulang
(21 unit + 28 e2e sekarang, naik dari 19) — SEMUA LOLOS, tidak ada
regresi dari perubahan ini.

### 13. Redesign visual "premium, bukan template biasa" — login.html + index.html + admin.html [SELESAI]

User minta tampilan diupgrade supaya terasa premium/native-app-mahal, bukan
template Tailwind biasa. Dibaca dulu `/mnt/skills/public/frontend-design/
SKILL.md` sesuai prosedur wajib untuk kerja desain visual.

**Kendala teknis besar**: Tailwind CSS di project ini di-*compile* dari
`src-css/input.css` → `public/styles.css`, tapi **sandbox ini tidak bisa
install/jalankan `tailwindcss` CLI** (butuh `npm install`, diblokir jaringan
— sama seperti kendala vendor-fetch). Artinya: kelas utility Tailwind BARU
yang belum pernah dipakai di HTML manapun TIDAK akan menghasilkan CSS apa
pun (silently broken, tidak ada error). **Solusi**: semua styling baru
ditulis sebagai CSS murni di dalam `<style>` block tiap halaman (pola yang
sudah ada sebelumnya di `login.html`), bukan kelas Tailwind baru — ini
sekaligus memberi kontrol lebih detail untuk gradient/shadow/animasi custom
dibanding terbatas ke utility class.

**Sistem desain yang dipakai** (dibangun dari palet navy+gold brand
muidsoft yang sudah ada, bukan ganti total):
- Navy diperdalam & dilapis 3 titik gradient + vignette (sebelumnya cuma
  radial-gradient tunggal, terasa flat/datar).
- Shadow di-tint navy (`rgba(6,11,26,...)`), bukan abu-abu netral bawaan
  browser — ini yang bikin kartu/tombol terasa "menyatu" dengan palet,
  bukan style generik.
- Gold gradient tombol ditambah lapisan highlight (pseudo-element
  `::before` putih transparan di bagian atas) — kesan permukaan logam
  yang memantulkan cahaya, bukan warna solid rata.
- **JetBrains Mono untuk semua angka uang** (harga produk, total floating
  cart) — font ini sudah ter-load di project tapi cuma dipakai di 2 input
  kecil sebelumnya. Ini elemen signature: tabular-nums + letter-spacing
  rapat, kesan presisi ala aplikasi finansial sungguhan.
- Label kecil "eyebrow" (mis. "SECURE • POS SYSTEM") — huruf besar,
  tracking lebar, dipisah titik emas kecil, pakai JetBrains Mono juga.
- Cincin/glow tipis emas di sekitar logo (satu-satunya aksen dekoratif
  yang cukup berani, selebihnya sengaja ditahan — sesuai prinsip "lepas 1
  aksesori" dari skill frontend-design).

**`login.html`** — direstyle penuh: background gradient, logo badge +
glow ring, heading pakai Sora dengan letter-spacing disesuaikan, SEMUA
input (login + wizard setup, 7 field total) diganti dari
`bg-slate-50 + focus:ring-blue-500` flat jadi kelas `.input-premium` baru
(border tipis + focus glow emas lembut, bukan ring biru default).

**`index.html` (halaman kasir, paling sering dipakai)**:
- Kartu produk: kelas `.product-card` baru (shadow navy-tint + hover
  border emas halus), harga pakai `.price-figure` (JetBrains Mono).
- Floating cart bar: gradient diperkaya, badge ikon shopping-bag diganti
  gradient emas (sebelumnya `bg-blue-500` polos), angka total pakai
  monospace.
- Avatar logo header: ditambah glow ring emas tipis (konsisten dengan
  login).
- Tombol scan barcode: warna diganti aksen emas (sebelumnya navy,
  kurang menonjol sebagai "aksi pintar" tersendiri).
- Pill kategori: `rounded-lg` → `rounded-full` (bentuk pil sungguhan,
  lebih premium) — **hati-hati saat edit ini**: logic toggle aktif/tidak-
  aktif di `bindCategoryFilterEvents()` memanipulasi nama kelas warna
  spesifik lewat `classList.add/remove`, jadi HANYA bagian bentuk yang
  diubah, nama kelas warna yang dimanipulasi JS sengaja TIDAK disentuh
  supaya toggle-nya tetap jalan.
- Empty state "Produk tidak ditemukan": sebelumnya cuma teks abu-abu
  polos, sekarang ada ikon kotak dalam badge bulat + copy yang lebih
  membantu ("coba kata kunci lain, atau tambah produk lewat menu Admin").

**Insiden selama verifikasi (bukan bug asli, kesalahan skrip test
sendiri)**: sempat mengira ada bug serius — produk yang baru dibuat tidak
muncul di grid setelah reload halaman, di SEMUA percobaan. Ditelusuri
dalam-dalam (injeksi `console.log` sementara ke `loadProducts()`, dites
apakah `initDB()` nyangkut karena `indexedDB.open()` tanpa `onblocked`
handler, dicek network request/response satu-satu) — ternyata skrip debug
ad-hoc yang dipakai lupa menunggu `window.LocalDB.flush()` (debounce
400ms yang SAMA PERSIS dengan yang sudah didokumentasikan di bagian 10)
sebelum `page.reload()`, jadi produk yang baru dibuat belum sempat
tersimpan ke IndexedDB saat halaman di-reload. Begitu skrip test
diperbaiki (tambah `await window.LocalDB.flush()`), produk muncul normal.
Bukan bug di aplikasi — **pelajaran untuk diri sendiri**: kalau bikin
skrip debug baru yang menyentuh data lalu reload, WAJIB ingat pola flush
ini dari awal, jangan sampai mengira ada bug padahal cuma skrip test yang
kurang tepat.

**Verifikasi**: screenshot Playwright diambil untuk semua state (setup
wizard, login normal, input focus, kasir kosong, kasir dengan produk,
floating cart, drawer terbuka) — **kali ini saya sendiri tidak bisa
melihat hasil screenshot-nya secara visual dalam sesi ini** (tool
`view` untuk gambar tidak menampilkan deskripsi seperti biasanya, dicoba
beberapa kali, kemungkinan gangguan teknis sesaat), jadi verifikasi
visual dilakukan lewat sampling piksel terprogram (`PIL.Image.getpixel`)
di titik-titik kunci (warna header, warna badge floating cart, warna
placeholder kartu produk) untuk memastikan gradient/warna baru benar-benar
ter-render, bukan cuma dipercaya dari kode. Semua titik sample sesuai
ekspektasi. `npm test` penuh (49 test: 21 unit + 28 e2e) dijalankan ulang
setelah SEMUA perubahan desain — 100% lolos, tidak ada regresi fungsional.

**`admin.html` (dikerjakan setelah user konfirmasi "lanjut")** — ternyata
file ini SUDAH punya fondasi desain yang jauh lebih matang dari dugaan
awal: sistem token CSS custom property (`:root { --brand, --gold,
--surface, --ring }`), KPI card dengan hover+radial accent, skeleton
loading shimmer, dan — yang paling penting — **`font-mono` (JetBrains
Mono) SUDAH konsisten dipakai di semua kolom angka** (harga produk,
omzet, total transaksi, dst di `admin-app.js`) jauh sebelum sesi ini.
Jadi kerjanya bukan "bangun dari nol" tapi refine token yang sudah ada
supaya konsisten dengan bahasa desain login/kasir:
- `--ring` (shadow token utama) diperdalam ke navy-tint (sebelumnya
  `rgba(15,23,42,...)` — sudah lumayan gelap tapi belum konsisten
  angkanya dengan token di 2 halaman lain).
- `.btn-gold` ditambah lapisan highlight `::before` (pola sama persis
  dengan login/kasir) — dipakai otomatis di 6 tempat yang sudah memakai
  kelas ini tanpa perlu ubah HTML lain.
- `.logo-ring` (cincin glow emas) ditambahkan ke logo header admin,
  konsisten dengan login/kasir.
- `.kpi-card:hover` shadow diperdalam & di-navy-tint.

**Verifikasi**: screenshot diambil (sampling piksel dipakai lagi karena
`view` untuk gambar masih belum menampilkan deskripsi visual di sesi
ini — header dashboard dikonfirmasi navy gelap `rgb(25,43,90)`, tab aktif
`rgb(24,40,85)`, sesuai ekspektasi). `npm test` penuh (49 test) dijalankan
ULANG sekali lagi setelah perubahan admin.html — 100% lolos, tidak ada
regresi.

**Ringkasan akhir bagian ini**: ketiga halaman (login, kasir, admin)
sekarang memakai bahasa desain yang konsisten — navy dalam berlapis
gradient, shadow navy-tint, tombol emas dengan highlight metalik,
angka uang selalu JetBrains Mono, dan cincin glow emas di logo sebagai
detail signature yang berulang di semua halaman.

### 14. Bug: upload foto produk sukses tapi gambar tidak tampil (khusus dilaporkan di APK) [SELESAI]

User laporkan: di APK yang sudah diinstall, upload foto produk "sukses tapi
gambar tidak muncul". Sesi sebelumnya (bagian 12) sempat mengetes upload
lewat direct API call dan dinyatakan "berfungsi" — **tapi itu cuma
mengetes API-nya, tidak pernah mengetes apakah `<img>` yang menampilkan
hasilnya benar-benar ter-render**. Celah verifikasi ini yang bikin bug-nya
lolos sebelumnya.

**Akar masalah (arsitektur, bukan APK-spesifik — cuma paling kentara di
APK)**: `gambar_url` yang disimpan berbentuk path seperti
`/api/gambar/produk/xxx.png`. Path ini HANYA bisa "diselesaikan" lewat
`window.fetch()` yang di-patch `fetch-shim.js` (diarahkan ke router lokal
`mini-hono.js` + `local-images.js`/IndexedDB, bukan server sungguhan).
Tapi `<img src="...">` TIDAK memanggil `window.fetch()` — itu request
resource level-browser ASLI, dan `sw.js` **sengaja** membiarkan semua
`/api/*` request lewat apa adanya ke network asli:
```
if (url.pathname.startsWith("/api/")) return; // biarkan lewat langsung ke network
```
Komentar di atasnya menjelaskan ini didesain untuk versi CLOUD LAMA
(waktu `/api/` memang server sungguhan) — desain itu tidak pernah
diperbarui saat project dikonversi ke mode lokal murni. Di mode lokal,
tidak ada server sungguhan sama sekali untuk `/api/*`, jadi
`<img src="/api/gambar/...">` **selalu 404** di mana pun app ini dibuka
(Cloudflare Pages statis, ATAU dibungkus APK) — upload-nya sendiri sukses
(itu lewat `fetch()` biasa, benar), tapi menampilkannya lewat `<img src>`
langsung selalu gagal.

**Kenapa baru ketahuan sekarang**: sesi-sesi sebelumnya SELALU mengetes
lewat `fetch()` langsung (`page.evaluate(() => fetch(...))`) yang memang
benar dan berhasil — tidak pernah mengecek `naturalWidth` dari elemen
`<img>` yang sungguhan dirender di grid/tabel. Investigasi kali ini
dimulai dari LAPORAN USER dulu (bukan asumsi), lalu ditelusuri dengan
membaca alur render sebenarnya (`previewProdukGambar()`,
`renderProdukTable()`, product card di kasir) sampai ketemu bahwa
semuanya pakai `img.src = gambar_url` mentah.

**Perbaikan** — pola yang sama diterapkan di 2 file (`admin-app.js` dan
`kasir-app.js`, duplikasi kecil, konsisten dengan pola `escapeHtml` yang
sudah lama duplikat di keduanya):
- Fungsi baru `resolveGambarSrc(url)`: untuk path yang diawali
  `/api/gambar/`, ambil BENERAN lewat `fetch()` (yang sudah pasti benar),
  ubah jadi `blob:` URL via `URL.createObjectURL()`, simpan di cache
  `Map` supaya tidak fetch ulang tiap render. Untuk URL lain (data: URI
  placeholder, http(s) eksternal) dikembalikan apa adanya.
- `admin-app.js`: `renderProdukTable()` diubah `async`, resolve semua
  gambar produk yang difilter (`Promise.all`) SEBELUM bangun HTML tabel
  (halaman admin tidak perlu instan, lebih aman tunggu semua beres dulu).
  `previewProdukGambar()` (preview form tambah/edit produk) diubah `async`
  serupa.
- `kasir-app.js` (lebih hati-hati soal performa — grid ini dipakai
  terus-menerus sepanjang hari, tidak boleh nunggu network/IndexedDB dulu
  baru render): render grid TETAP instan pakai placeholder SVG lokal dulu
  (`localPlaceholderImg`, dari bagian 12), lalu fungsi baru
  `resolveProductImagesAsync()` jalan di BACKGROUND satu-satu, begitu
  satu foto selesai di-resolve langsung ditempel ke `<img>` yang sesuai
  lewat atribut `data-product-img="<id>"` — tidak perlu render ulang grid.

**Verifikasi**: test baru `tests/e2e/gambar-produk-tampil.test.mjs` (9
assertion) — SENGAJA cek `img.naturalWidth` (bukan cuma nilai atribut
`src`) di 3 tempat (grid kasir, tabel admin, preview form edit), pakai
gambar tes 1×1 piksel supaya `naturalWidth` yang benar HARUS persis `1`
(kalau gagal load, browser selalu kasih `naturalWidth: 0`). Sempat 1
assertion gagal karena selector test sendiri salah target tombol (kena
tombol "Tambah Produk" bukan tombol edit baris) — diperbaiki, lolos
semua setelah itu. `npm test` penuh (58 test sekarang, naik dari 49)
dijalankan ulang — semua lolos, tidak ada regresi.

**Catatan untuk ke depan**: `blob:` URL yang dibuat lewat
`URL.createObjectURL()` tidak di-`revokeObjectURL()` secara eksplisit
(dibiarkan browser bersihkan sendiri saat halaman ditutup/navigasi) —
untuk skala toko kecil (puluhan-ratusan produk) ini bukan masalah nyata,
tapi kalau suatu saat ada toko dengan RIBUAN produk semuanya berfoto,
worth dipertimbangkan revoke manual untuk gambar yang sudah tidak
terlihat lagi (di luar scope perbaikan bug kali ini).

### 15. User tanya: apakah cetak sudah jalan di APK? [SEBAGIAN — perlu konfirmasi user]

Ditelusuri fitur "Cetak Langsung ke Printer" (`connectBluetoothPrinter()`
di `kasir-app.js`, pakai Web Bluetooth API — `navigator.bluetooth.
requestDevice`). Bedanya dari kasus kamera/gambar sebelumnya: kali ini
saya TIDAK bisa memverifikasi perbaikannya secara end-to-end di sandbox
ini sama sekali (tidak ada hardware Bluetooth/printer fisik, dan
Playwright/Chromium tidak bisa mensimulasikan Web Bluetooth device picker
seperti bisa mensimulasikan fake camera device) — jadi bagian ini lebih
ke "perbaikan yang masuk akal berdasarkan pola bug yang sama seperti
kamera" ketimbang "bug yang dikonfirmasi lalu diperbaiki lalu
diverifikasi lolos".

**Yang PASTI jadi masalah (pola sama persis dengan bug kamera di bagian
12)**: `AndroidManifest.xml` hasil `cap add android` default TIDAK
mendeklarasikan izin Bluetooth apa pun. Tanpa itu, `navigator.bluetooth.
requestDevice()` di APK hampir pasti gagal/ditolak — regardless apakah
WebView-nya sendiri mendukung Bluetooth atau tidak.
**Diperbaiki**: `scripts/patch-android-permissions.mjs` (bagian 12)
diperluas — sekarang juga menyuntik `BLUETOOTH`/`BLUETOOTH_ADMIN` (Android
lama, sampai API 30) DAN `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` (Android
12+/API 31+, model izin baru). Ditest ulang dengan mock manifest yang
sama seperti bagian 12 — XML valid, semua baris tersisip benar.

**Yang TIDAK BISA saya pastikan dari sini (batasan jujur)**: bahkan
dengan izin lengkap, dukungan Web Bluetooth API — khususnya UI "device
picker"-nya — di **Android System WebView** (dasar Capacitor, BEDA dari
Chrome browser biasa yang memang sudah lama support Web Bluetooth)
secara historis tidak konsisten/kurang matang dibanding di kamera
(getUserMedia jauh lebih matang & konsisten dukungannya di WebView
dibanding Web Bluetooth). Ada kemungkinan nyata fitur ini TETAP tidak
berfungsi di sebagian device APK walau izin sudah lengkap — bukan karena
kurang izin, tapi karena WebView di device itu memang tidak
mengimplementasikan device picker Bluetooth-nya sama sekali. Ini beda
kelas masalah dari kamera (murni izin) — di sini ada komponen yang
genuinely di luar kendali kode aplikasi.

Perbaikan tambahan yang TETAP dilakukan supaya lebih mudah didiagnosis
kalau user coba sendiri: pesan error di `connectBluetoothPrinter()`
diperjelas per jenis error (`SecurityError` = izin ditolak,
`NotSupportedError` = device picker tidak tersedia di WebView ini →
saran update "Android System WebView" lewat Play Store,
`NetworkError` = printer tidak dalam jangkauan/lagi dipakai lain) —
sebelumnya cuma 1 pesan generik `err.message` mentah yang tidak
membantu kasir mendiagnosis sendiri.

`PANDUAN-APK.md` ditambah bagian troubleshooting yang menjelaskan
kemungkinan ini secara terus terang, termasuk saran solusi jangka panjang
(plugin Bluetooth native Capacitor, bukan Web Bluetooth API) kalau
terbukti WebView-nya memang tidak mendukung.

**Perlu dari user**: coba fitur cetak Bluetooth di APK sungguhan (setelah
build ulang dengan perbaikan izin ini), dan laporkan balik hasilnya —
kalau MASIH gagal, tolong sertakan pesan error persis yang muncul (bukan
cuma "gagal"), supaya bisa dibedakan izin-masih-kurang vs
WebView-memang-tidak-support (2 kemungkinan itu butuh solusi yang beda
jauh).

### 16. Bug: Export Excel & Backup tidak bisa diunduh di APK [SELESAI, kecuali verifikasi XLSX sungguhan]

User laporkan Export Excel tidak bisa dipakai di APK. Ditelusuri dari kode
dulu (pola yang sama seperti bug gambar di bagian 14 — curiga ada
mekanisme yang jalan di browser biasa tapi tidak di WebView), ketemu:

**Akar masalah**: `exportLaporanExcel()` pakai `XLSX.writeFile(wb,
namaFile)` — fungsi bawaan library SheetJS yang di baliknya bikin Blob
lalu klik elemen `<a download>` tersembunyi secara otomatis. Trik ini
ANDALKAN download manager bawaan browser (Chrome/Safari punya ini).
Tapi WebView Android polos (dasar Capacitor) **tidak otomatis punya
download manager terhubung** — klik `<a download>` di sana sering diam-
diam tidak melakukan apa-apa: tidak ada file tersimpan, TIDAK ADA error
atau pesan apa pun juga, jadi dari sisi user kelihatannya seperti tombol
"tidak merespons".

**Sweep tambahan menemukan bug KEDUA yang lebih serius**: `exportBackup()`
di `local-backup.js` (fitur **Backup & Pindah HP** — satu-satunya cara
menyelamatkan data toko karena semuanya lokal) pakai trik `<a download>`
yang SAMA PERSIS. Kalau tidak ikut diperbaiki, pemilik toko yang pakai
APK tidak akan pernah bisa backup data mereka — jauh lebih kritis
dibanding sekadar Export Excel gagal.

**Perbaikan**: file baru `public/js/lib/file-saver.js`
(`window.FileSaver.save(data, filename, mimeType)`) — deteksi
`window.Capacitor` (variabel yang SELALU disuntik Capacitor ke app-nya,
bisa diandalkan sebagai penanda "ini APK"):
- **Kalau di APK**: pakai Web Share API (`navigator.share` dengan file)
  — memicu menu "Bagikan/Simpan ke..." bawaan Android. Jauh lebih
  reliable di WebView dibanding trik `<a download>`, dan justru ini pola
  yang lebih natural buat mobile (user pilih sendiri mau simpan ke Drive/
  Files/kirim WA, dst) dibanding konsep "folder Downloads" yang di HP
  sering membingungkan dicari.
- **Kalau di browser biasa** (desktop atau HP tanpa dibungkus APK): tetap
  pakai `<a download>` classic — di sana itu justru paling familiar
  (langsung masuk folder Downloads seperti biasa).
- Kalau share gagal karena alasan lain (bukan user membatalkan), tetap
  ada fallback ke `<a download>` — lebih baik coba sesuatu daripada
  diam-diam gagal total.

Diterapkan di KEDUA tempat: `exportLaporanExcel()` (`admin-app.js`, ganti
`XLSX.writeFile` jadi `XLSX.write(...type:'array') + FileSaver.save`) dan
`exportBackup()` (`local-backup.js`). Marker validasi internal
`app: 'kasir-harvey-local-backup'` **SENGAJA TIDAK diubah** (sama seperti
alasan di bagian 11 — supaya backup lama tetap bisa direstore).

**Verifikasi**: `hasXLSX: false` di sandbox ini (library belum di-vendor,
keterbatasan lama/known-issue, bukan hal baru) — jadi **jalur Export
Excel sungguhan (dengan XLSX beneran) belum bisa ditest end-to-end dari
sini**. Yang BISA & SUDAH diverifikasi:
- `window.FileSaver.save()` ditest langsung: di browser biasa memicu
  event download sungguhan dengan nama file benar; dengan `window.
  Capacitor` + `navigator.share` di-mock (simulasi APK), `navigator.
  share` benar-benar terpanggil dengan file yang benar (nama, tipe) —
  BUKAN `<a download>`.
- **Export Backup diverifikasi PENUH end-to-end** lewat tombol asli
  (bukan cuma pemanggilan fungsi langsung): download sungguhan terjadi,
  file diunduh & dibuka, isinya JSON valid dengan semua field yang
  diharapkan (`app`, `dbBase64`, dst).
- Sempat ada 2 kali kesalahan di SKRIP TEST saya sendiri (bukan bug
  aplikasi) yang bikin bingung sesaat: (1) selector tab salah
  (`[data-tab="pengaturan"]` padahal id sebenarnya `#tab-btn-toko`), (2)
  `window.Capacitor`/`navigator.share` yang di-mock di satu langkah test
  tidak di-reset, jadi "bocor" ke langkah test berikutnya dan bikin
  export backup asli ikut salah kena jalur share-mock. Keduanya
  ditemukan & diperbaiki sebelum menyimpulkan hasil akhir.
- Test baru permanen: `tests/e2e/export-file.test.mjs` (9 assertion).
  `npm test` penuh sekarang 67 test (naik dari 58) — semua lolos.

**Yang masih perlu dari user**: setelah `vendor:fetch` benar-benar
dijalankan (jadi `XLSX` beneran ter-load) DAN dicoba di APK sungguhan,
tolong konfirmasi Export Excel & Backup keduanya berhasil memicu menu
"Bagikan" Android. Kalau ada yang aneh, laporkan detail gejalanya.

### 17. User laporkan (dengan screenshot): "undefined" di menu akun + spinner login "muncul sebelum waktunya" [SEBAGIAN — 1 diperbaiki & terkonfirmasi, 1 tidak bisa direproduksi]

User upload 2 screenshot: (1) menu akun di halaman kasir menampilkan teks
"undefined" sebagai header, (2) halaman login dengan tombol "Mulai"
ditandai, disertai keluhan spinner loading-nya "muncul sebelum waktunya".

**Bug #1 — "undefined" di menu akun — DITEMUKAN & DIPERBAIKI.**
Ditelusuri: `kasir-app.js` baris 567 membaca `currentUser.nama`, tapi
`currentUser` diisi dari `checkAuth()` yang fetch `/api/auth/me` —
endpoint itu mengembalikan kolom database MENTAH (`SELECT id, username,
nama_lengkap, role, toko_id FROM users`), field-nya `nama_lengkap`, BUKAN
`nama`. Konfirmasi lucu: kode di file yang SAMA, cuma beberapa baris di
atasnya (baris 178, 187), sudah benar pakai `.nama_lengkap` — jadi
inkonsistensi penamaan di dalam file itu sendiri. `/api/auth/login` dan
`/api/auth/setup` KEBETULAN tidak kena bug ini karena keduanya secara
eksplisit me-mapping `nama: user.nama_lengkap` di response-nya (lihat
bagian sebelumnya) — beda dari `/api/auth/me` yang cuma oper mentah hasil
query. Efeknya: bug BARU muncul setelah RELOAD halaman (giliran
`checkAuth()`/`/api/auth/me` yang isi `currentUser`), tidak kelihatan
tepat setelah login/setup pertama kali — cocok dengan skenario nyata
(user screenshot pasti sudah reload/buka-tutup app beberapa kali).
**Diperbaiki**: baris 567 diganti jadi `currentUser.nama_lengkap`,
konsisten dengan 3 pemakaian lain yang sudah benar. **Diverifikasi
end-to-end**: setup akun → RELOAD halaman (supaya lewat jalur
`/api/auth/me` yang buggy) → buka menu akun → nama tampil benar ("Budi
Santoso"), bukan "undefined". Test permanen baru:
`tests/e2e/account-menu-nama.test.mjs`.

**Bug #2 — spinner login "muncul sebelum waktunya" — TIDAK BISA
DIREPRODUKSI, tapi tetap ditambahkan pengaman preventif.**
Dicoba direproduksi di 4 skenario berbeda (buka langsung tanpa nunggu
apa pun, buka dengan akun sudah ada, lewat alur klik Logout → redirect
ke login, isi-form-lalu-klik-cepat) — spinner SELALU dalam keadaan
`hidden` yang benar di setiap titik waktu yang dicek (0ms sampai 2000ms
setelah load). User mengonfirmasi ini BUKAN soal cache (sudah ditawarkan
opsi uninstall-reinstall APK, user yakin bukan itu). Karena tidak bisa
dikonfirmasi akar masalahnya secara pasti, **diambil pendekatan
preventif** yang masuk akal berdasarkan hipotesis paling mungkin: kalau
`styles.css` (49KB, berisi definisi class `.hidden`) butuh waktu lebih
lama dimuat di device/koneksi asli dibanding server test lokal (yang
praktis instan), ada KEMUNGKINAN celah waktu singkat sebelum CSS
diterapkan di mana ikon spinner (yang cuma disembunyikan lewat CSS class
`.hidden`) sempat "kelihatan" sekilas sebelum stylesheet selesai di-
parse — flash-of-unstyled-content klasik.
**Perbaikan preventif**: tambahkan `style="display:none"` INLINE
langsung di HTML pada kedua elemen spinner (`#btn-loader`,
`#setup-btn-loader`) — inline style diterapkan browser SEGERA saat parsing
HTML, tidak perlu menunggu stylesheet eksternal selesai dimuat sama
sekali, jadi menutup celah itu kalau memang itu penyebabnya. JS yang
menampilkan spinner (`handleLogin`, `handleSetup`) diupdate supaya
eksplisit membersihkan inline style itu (`btnLoader.style.display = ''`)
tepat sebelum request dikirim — supaya spinner TETAP bisa muncul normal
saat memang harus muncul (diverifikasi: seluruh test suite yang memakai
alur login/setup asli, termasuk yang mengecek transisi UI, semuanya
tetap lolos setelah perubahan ini).

**Kejujuran soal bug #2**: perbaikan ini masuk akal dan tidak berisiko
(cuma pengaman tambahan, tidak mengubah perilaku normal), TAPI karena
tidak pernah berhasil direproduksi, saya tidak punya cara memastikan
ini benar-benar akar masalah yang user lihat. Kalau setelah update ini
gejalanya masih ada, kemungkinan penyebabnya lain sama sekali dan perlu
info lebih spesifik dari user (idealnya rekaman layar) untuk digali lebih
lanjut.

## Belum dikerjakan
- Isi `admin-app.js`/`kasir-app.js` sendiri (2500+ baris) belum dipecah lagi
  jadi per-fitur.
- Spinner login "muncul sebelum waktunya" (bagian 17) — pengaman
  preventif sudah ditambahkan tapi TIDAK terkonfirmasi menyelesaikan akar
  masalah sesungguhnya (tidak pernah berhasil direproduksi). Perlu
  feedback user setelah update ini apakah gejalanya hilang.
- Export Excel & Backup **belum diverifikasi dengan XLSX library
  sungguhan** (baru dites logika FileSaver-nya + backup end-to-end yang
  tidak butuh XLSX) — lihat bagian 16. Perlu dicoba di APK asli setelah
  `vendor:fetch` dijalankan.
- Cetak Bluetooth di APK sungguhan **belum terverifikasi end-to-end**
  (lihat bagian 15) — izin Android sudah ditambahkan, pesan error
  diperjelas, tapi dukungan Web Bluetooth API di Android System WebView
  sendiri di luar kendali kode aplikasi & tidak bisa ditest dari sandbox
  ini. Perlu dicoba langsung di APK + printer fisik, dan dilaporkan balik.
- **PALING PENTING, TIDAK BERUBAH DARI SEBELUMNYA**: workflow "Vendor CDN
  Assets" (atau `npm run vendor:fetch` manual) BELUM PERNAH benar-benar
  dijalankan terhadap CDN sungguhan (dicoba dari 2 pendekatan berbeda,
  sama-sama diblokir jaringan sandbox). User WAJIB menjalankannya sendiri
  sekali sebelum aplikasi ini dipakai/dideploy, dan melapor balik kalau ada
  error di situ. Sekarang mengunduh 1 file lebih banyak (ZXing) dari
  sebelumnya.
- Scan barcode SUNGGUHAN (arahkan kamera ke barcode fisik, verifikasi hasil
  decode-nya benar) TIDAK bisa ditest otomatis di sandbox ini (perlu kamera
  fisik + barcode fisik) — yang ditest cuma modal terbuka & tidak error.
  Kalau nanti dicoba di HP asli dan scan-nya tidak akurat/lambat, itu di
  luar apa yang sudah diverifikasi di sesi ini.
- Opsi PIN cepat (selain password penuh) untuk gonta-ganti kasir dalam
  sehari — disebut sebagai saran tambahan opsional, belum diimplementasi,
  nunggu keputusan user apakah mau dilanjutkan.
- `REFERENSI-API.md` isinya (bukan cuma judul, yang sudah diperbaiki di
  bagian 11) masih menyebut "cookie sesi" dan `src/index.ts` sebagai
  sumber kebenaran — belum ditulis ulang isinya.
- Keystore signing untuk release APK **sengaja belum dibuatkan** (harus
  dibuat sendiri oleh user — lihat `PANDUAN-APK.md`), infrastrukturnya
  (script patch + workflow) sudah siap dipakai begitu keystore ada.
- Belum ada test untuk endpoint transaksi/laporan/preorder — cakupan test
  masih sebagian, bukan menyeluruh ke semua 50 endpoint API.
- **Baru dari rebrand ini**: kalau user SUDAH PERNAH deploy versi
  "Kasir Harvey" ke Cloudflare dan/atau install APK versi lama, deploy
  ulang dengan `wrangler.toml`/`capacitor.config.json` yang baru akan
  membuat Worker/APK yang dianggap BEDA (bukan update in-place) — perlu
  tindakan manual (redeploy, uninstall APK lama, urus custom domain kalau
  ada). Data toko tetap aman (tidak kena dampak, karena `IDB_NAME`
  sengaja tidak diubah), tapi URL/APK lama & baru akan hidup berdampingan
  sebagai 2 hal terpisah kalau tidak dibereskan manual.
- Fitur kasir yang masih kurang (diskon per item, member/loyalty, retur
  barang, dll) — sudah dibahas di chat tapi belum diimplementasi, nunggu
  keputusan user prioritas mana dulu.
