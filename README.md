# muidsoft — Sistem Kasir (POS)

Aplikasi kasir untuk toko, jalan **100% lokal di browser tiap HP** (database
SQLite via sql.js + IndexedDB — tidak ada server backend, tidak ada
database cloud). Cloudflare cuma menyajikan file statis (HTML/CSS/JS/WASM).
Bisa diinstall sebagai PWA di HP kasir (atau dibungkus jadi APK Android,
lihat `PANDUAN-APK.md`), tetap bisa jualan walau internet mati total —
bukan cuma "antre lalu sinkron", tapi memang tidak butuh internet sama
sekali setelah aplikasi pertama kali dimuat.

**Konsekuensi penting**: setiap HP punya datanya sendiri-sendiri, tidak
sinkron otomatis antar perangkat. Detail lengkap arsitekturnya ada di
[`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md).

Repo: `github.com/ppicwkb/umkm` • Live: `https://umkm.ppicwkb.workers.dev`

---

## Dokumentasi

| Dokumen | Isi |
|---|---|
| **README.md** (ini) | Ringkasan fitur, struktur project, tech stack |
| [`PANDUAN-DEPLOY.md`](./PANDUAN-DEPLOY.md) | Cara pasang dari nol & cara update — **baca ini kalau mau deploy** |
| [`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md) | Penjelasan arsitektur 100% lokal (data per-HP, asset offline, dst) |
| [`PANDUAN-APK.md`](./PANDUAN-APK.md) | Cara build APK Android (Capacitor + GitHub Actions, otomatis, tanpa Android Studio) |
| [`PANDUAN-PENGGUNA.md`](./PANDUAN-PENGGUNA.md) | Cara pakai sehari-hari (kasir & admin) — **baca ini kalau mau operasional** |
| [`REFERENSI-API.md`](./REFERENSI-API.md) | Daftar lengkap endpoint backend — buat yang mau lanjut develop |
| [`MARTABAK-CHANGES.md`](./MARTABAK-CHANGES.md) | Riwayat perubahan historis (changelog dari versi martabak sebelumnya) |

---

## Fitur

### Kasir (`index.html`)
- **Katalog produk harga tetap** — tap produk langsung masuk keranjang,
  harga selalu dihitung ulang & divalidasi di server (tidak percaya angka
  dari HP kasir).
- **Split payment** — satu transaksi bisa dibayar dengan lebih dari satu
  metode (mis. sebagian tunai + sebagian QRIS).
- **Preorder / jadwal ambil** — tandai transaksi sebagai pesanan yang
  diambil nanti, isi tanggal/jam + nama/HP pemesan.
- **Nomor antrian** — otomatis tercetak di struk, reset tiap hari.
- **Mode offline** — transaksi tetap bisa dibuat saat internet mati,
  otomatis tersinkron ke server begitu online lagi (antrian IndexedDB).
- **Cetak struk langsung ke printer thermal Bluetooth** (ESC/POS) — tanpa
  dialog print browser. Catatan: cuma jalan di Chrome/Edge Android/Desktop
  (Web Bluetooth tidak didukung Safari/iOS).
- **Batalkan transaksi/item** — kasir bisa batalkan transaksi miliknya
  sendiri dalam 30 menit (bisa pilih sebagian item saja, tidak harus
  seluruh transaksi); admin bisa batalkan kapan saja lewat panel admin.
- **Shift kasir** — buka/tutup shift dengan pencatatan modal awal, kas
  akhir, dan selisih.
- **Pesanan Ditahan (hold)** — simpan keranjang sementara, lanjutkan nanti.

### Admin (`admin.html`)
- **Dashboard** — omzet & transaksi hari ini, margin kotor, grafik tren
  penjualan & jam ramai, tabel kombinasi produk terlaris.
- **Kelola Produk** — CRUD produk & kategori, harga tetap.
- **Bahan Baku & Resep (HPP)** — input harga bahan baku, hubungkan ke
  produk dengan takaran; HPP dihitung & di-*snapshot* tiap transaksi
  supaya laporan margin bulan lalu tidak berubah kalau harga bahan naik.
- **Pesanan Mendatang** — daftar preorder yang belum diambil, tandai
  selesai/dibatalkan.
- **Riwayat Transaksi** — lihat & batalkan transaksi/item kapan saja.
- **Kelola Kasir & Toko** — tambah akun kasir, atur data toko.
- **Kustomisasi Struk** — lebar kertas (58/80mm), pesan footer, catatan,
  ikon footer (QR code asli atau nama toko), tampilkan/sembunyikan nomor
  antrian & alamat toko.
- **Kelola Data** — hapus data contoh/testing atau reset transaksi (khusus
  super_admin, wajib konfirmasi berlapis).
- **Log Aktivitas** — audit trail siapa mengubah apa.
- **Export Excel** — transaksi, kombinasi terlaris, margin.

### Keamanan
- Password di-hash PBKDF2 (100.000 iterasi) + salt (bukan plaintext).
- Sesi login disimpan di `sessionStorage` HP itu sendiri (bukan
  cookie/JWT — tidak ada server untuk memvalidasinya, semua logika
  autentikasi jalan di browser terhadap database lokal).
- Akun pertama dibuat lewat wizard "Setup Awal" saat instalasi baru —
  tidak ada password bawaan yang sama di semua instalasi.
- Role-based access ditegakkan di router lokal (`mini-hono.js` +
  `local-auth-middleware.js`): `super_admin` (akses penuh), `admin_toko`,
  `kasir` (transaksi & operasional harian, tidak bisa buka menu
  Admin/Laporan/Pengaturan/Kelola User).

---

## Tech stack

- **"Backend"**: router mini-Hono buatan sendiri (`public/js/mini-hono.js`)
  yang jalan **di dalam browser**, meniru API [Hono](https://hono.dev) asli
- **Database**: SQLite di browser via [sql.js](https://sql.js.org) (WASM),
  persisten lewat IndexedDB
- **Storage foto produk**: IndexedDB (`local-images.js`)
- **Frontend**: HTML + Tailwind CSS (di-*build*, bukan CDN) + vanilla JS,
  tanpa framework — supaya ringan & cepat di HP kasir low-end
- **Offline**: Service Worker (app-shell) + semua asset (font, library)
  di-self-host lokal, tidak ada dependency CDN saat runtime
- **Hosting**: Cloudflare Workers Assets — murni static file hosting
- **APK Android**: [Capacitor](https://capacitorjs.com), build otomatis
  lewat GitHub Actions (lihat `PANDUAN-APK.md`)
- **Cetak**: Web Bluetooth API + ESC/POS

## Struktur folder

```
umkm/
├── migrations/                  ← 0001–0014 (referensi skema, lihat catatan di public/migrations/)
├── public/
│   ├── login.html                ← form login
│   ├── index.html                  ← halaman kasir (POS)
│   ├── admin.html                   ← panel admin
│   ├── manifest.json                 ← PWA manifest
│   ├── sw.js                          ← service worker (app-shell, bukan API)
│   ├── migrations/                     ← 0001–0014, SATU-SATUNYA yang dijalankan runtime (local-db.js fetch dari sini)
│   ├── js/
│   │   ├── local-app.js                 ← router utama (mini-Hono), satu-satunya sumber kebenaran API
│   │   ├── local-db.js                   ← SQLite di browser (sql.js) + persist ke IndexedDB
│   │   ├── local-images.js                ← storage foto produk (IndexedDB)
│   │   ├── local-auth.js / local-auth-middleware.js ← sesi login (sessionStorage, tanpa cookie/JWT)
│   │   ├── crypto.js                       ← hash password (PBKDF2+salt)
│   │   ├── routes/                          ← 1 file per domain (produk, transaksi, laporan, dst.)
│   │   └── pages/                            ← logika tiap halaman (admin-app.js, kasir-app.js, login-app.js)
│   └── icons/                          ← ikon PWA
├── src-css/input.css             ← sumber Tailwind (di-build ke public/styles.css)
├── scripts/
│   ├── gen-password-hash.mjs     ← generate hash+salt password baru
│   └── check-migrations-sync.mjs ← guard CI: migrations/ vs public/migrations/ harus identik
├── wrangler.toml                 ← konfigurasi hosting statis (Cloudflare Workers Assets)
└── package.json
```

## Quick start

```bash
git clone https://github.com/ppicwkb/umkm.git
cd umkm
npm install
npm run deploy
```

> `npm run deploy` otomatis menjalankan `vendor:fetch` dulu (download Font
> Awesome/Google Fonts/xlsx.js/Chart.js/qrcode.js sekali dan simpan lokal di
> `public/fonts/` + `public/js/vendor/` — lihat
> [`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md) bagian "Asset offline")
> sebelum build & deploy. Butuh internet (wajar, `wrangler deploy` sendiri
> juga butuh internet). Tidak ada migration database untuk dijalankan —
> tidak ada database server sama sekali di arsitektur ini.

Untuk detail lengkap (termasuk cara update dari state yang sudah berjalan,
generate password admin, dan troubleshooting), baca
[`PANDUAN-DEPLOY.md`](./PANDUAN-DEPLOY.md).
