# muidsoft — Mode Full Lokal (per HP)

Update ini mengubah aplikasi dari berbasis cloud (Cloudflare D1 + R2) menjadi
**100% lokal di tiap HP**. Dokumen ini ringkasan yang perlu Anda tahu.
Dokumen lama (`README.md`, `PANDUAN-DEPLOY.md`, `PANDUAN-PENGGUNA.md`,
`REFERENSI-API.md`, `MARTABAK-CHANGES.md`) menjelaskan versi CLOUD yang LAMA —
sudah tidak berlaku untuk arsitektur data/login, hanya masih relevan untuk
alur bisnis kasir sehari-hari (menu, transaksi, laporan, dll tidak berubah).

## Apa yang berubah

| | Sebelum (cloud) | Sekarang (lokal) |
|---|---|---|
| Database | Cloudflare D1 (server, dipakai bersama) | SQLite di browser (sql.js), tersimpan di IndexedDB HP masing-masing |
| Gambar produk | Cloudflare R2 | IndexedDB HP masing-masing |
| Login | Banyak akun, 3 role | Banyak akun, 3 role — sama, cuma sesinya sekarang cuma flag di HP ini (bukan cookie server) |
| Toko | Multi-toko | 1 toko per HP |
| Data antar HP | Sama (real-time) | **Beda HP = beda data**, tidak sinkron |
| Hosting | Worker (jalan kode di server) + assets | Cuma assets statis (HTML/JS/WASM), tidak ada kode server lagi |

## Pertama kali pakai

- Saat aplikasi dibuka pertama kali di HP (belum ada akun sama sekali),
  layar login otomatis berubah jadi wizard **"Siapkan Tokomu"**: isi Nama
  Toko, Nama Lengkap, Username, dan Password sendiri. **Tidak ada password
  bawaan** yang sama di semua instalasi — akun pertama (role **Super
  Admin**, akses penuh) dibuat dari isian kamu sendiri saat itu juga.
- Mau akun terpisah untuk kasir (supaya tidak bisa buka menu Admin/Laporan)?
  Buka **Admin → Kelola User → Tambah User**, isi role **Kasir**. Setiap
  kasir bisa punya username & password sendiri-sendiri, tetap 1 database
  yang sama (di HP itu) — cuma hak aksesnya beda sesuai role.
- Nama toko diisi langsung waktu wizard setup — bisa diubah lagi kapan saja
  lewat menu Admin → Pengaturan.

## Backup & pindah HP — WAJIB DIBACA

Karena data hanya ada di HP itu sendiri:
- Kalau HP hilang/rusak, cache browser dibersihkan, atau aplikasi
  di-uninstall, **semua data (produk, transaksi, riwayat) hilang permanen**
  kecuali sudah di-backup.
- Buka **Admin → Pengaturan → Backup & Pindah HP** untuk mengunduh file
  cadangan (`.json`, berisi database + semua foto produk).
- Untuk pindah ke HP baru: unduh cadangan dari HP lama, buka aplikasi di HP
  baru, lalu **Pulihkan dari File** di halaman yang sama.
- Disarankan mengunduh cadangan secara rutin (mis. tiap tutup toko).

## Lupa password

Tidak ada server yang bisa mereset password Anda (memang sengaja, tidak ada
data yang keluar dari HP). Kalau lupa password dan tidak ada backup terbaru,
satu-satunya jalan adalah menghapus data aplikasi ini di HP (Pengaturan HP →
Aplikasi/Situs → muidsoft → Hapus data), yang berarti **kembali ke kondisi
baru dan kehilangan seluruh data lama**. Simpan password Anda baik-baik.

## Untuk yang penasaran dengan sisi teknis

- Mesin database: [sql.js](https://sql.js.org) (SQLite dikompilasi ke
  WebAssembly), skemanya persis sama dengan `migrations/*.sql` yang dulu
  dipakai di Cloudflare D1.
- Seluruh logika bisnis (`src/index.ts` asli — transaksi, laporan, shift,
  preorder, resep/HPP, dll) tetap dipakai apa adanya, hanya dijalankan di
  browser lewat `public/js/local-app.js` (hasil transpile otomatis, bukan
  ditulis ulang manual) dan lapisan kompatibel D1/R2 buatan sendiri
  (`public/js/local-db.js`, `public/js/local-images.js`).
- `public/js/fetch-shim.js` membelokkan semua `fetch('/api/...')` di
  `index.html`/`admin.html`/`login.html` ke mesin lokal ini — halaman-halaman
  itu sendiri nyaris tidak berubah logikanya.
- Aplikasi tetap PWA (bisa dipasang di HP, jalan offline) — `sw.js` sudah
  diperbarui untuk cache semua file mesin lokal ini.
- `wrangler.toml` sudah disederhanakan jadi hosting statis murni (tidak ada
  lagi Worker/D1/R2). Konfigurasi lama ada di
  `wrangler.toml.bak.old-cloud-version` untuk referensi.

## Asset offline (font, ikon, library) — WAJIB setup sekali sebelum deploy

Supaya aplikasi bisa dibuka **100% offline dari kali pertama install**
(termasuk kalau dibungkus jadi APK — lihat `PANDUAN-APK.md`), semua yang
dulu dimuat dari CDN luar (Font Awesome, Google Fonts, xlsx.js, Chart.js,
qrcodejs) sekarang disimpan lokal di `public/fonts/` dan `public/js/vendor/`
— TIDAK ada lagi fallback ke CDN sama sekali.

**Konsekuensinya: file-file itu HARUS ada dulu sebelum halaman bisa tampil
dengan benar** (kalau belum ada, ikon hilang, font fallback ke default,
fitur export Excel/Chart di Admin/kode QR di struk akan error). Cara
menyiapkannya (pilih salah satu, cukup **sekali** di awal atau tiap kali
mau update versi library):

1. **Cara termudah — lewat GitHub Actions** (tidak perlu install apa pun di
   komputer): tab **Actions** di repo → workflow **"Vendor CDN Assets
   (self-host offline)"** → tombol **"Run workflow"**. Hasilnya otomatis
   ter-commit ke repo.
2. **Cara manual** (kalau Node.js sudah terinstall di komputer, ada internet):
   ```bash
   npm run vendor:fetch
   git add public/fonts public/js/vendor public/vendor-manifest.json
   git commit -m "chore: vendor CDN assets locally"
   ```

`npm run deploy` dan workflow build APK (`build-apk.yml`) **sudah otomatis**
menjalankan `vendor:fetch` juga sebagai jaring pengaman tambahan — jadi
selama kamu deploy lewat `npm run deploy` atau build APK lewat GitHub
Actions, ini tidak akan pernah lupa/kelewat. Yang WAJIB dilakukan manual
cuma kalau kamu jalankan `wrangler dev` untuk testing lokal di komputer
tanpa lewat `npm run deploy` dulu.
