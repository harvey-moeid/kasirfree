# Panduan Deploy — muidsoft POS

URL contoh: `https://umkm.ppicwkb.workers.dev` (Cloudflare Pages/Workers Assets,
static hosting saja — lihat catatan arsitektur di bawah).

---

## Arsitektur (baca ini dulu supaya tidak bingung)

Aplikasi ini **100% jalan di browser tiap HP** (database SQLite via sql.js,
gambar produk via IndexedDB — lihat [`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md)
untuk detail). Cloudflare di sini **cuma menyajikan file statis**
(HTML/CSS/JS/WASM) — **tidak ada** Worker script yang jalan di server,
**tidak ada** database D1, **tidak ada** R2 bucket, **tidak ada** cookie/JWT
session.

**Konsekuensi penting**: setiap HP yang membuka situs ini akan punya
datanya sendiri-sendiri (produk, transaksi, akun user, dst), tersimpan di
HP itu saja — **bukan** database bersama seperti aplikasi cloud biasa.
Kalau kamu familiar dengan versi lama project ini yang pakai D1/R2/Worker,
konfigurasi itu ada di `wrangler.toml.bak.old-cloud-version` untuk
referensi, tapi **sudah tidak dipakai**.

---

## 1. Prasyarat

- Akun Cloudflare (gratis, sudah cukup untuk skala UMKM)
- Node.js 18+ terinstall
- `git`

---

## 2. Install dependency & login Cloudflare

```bash
git clone https://github.com/ppicwkb/umkm.git
cd umkm
npm install
npx wrangler login
```
Browser akan terbuka minta izin akses. Setelah berhasil, `wrangler`
tersimpan kredensialnya di komputer ini.

---

## 3. Siapkan asset offline (WAJIB, sekali di awal)

Font, ikon, dan beberapa library (Chart.js, xlsx.js, qrcodejs) di-self-host
lokal (bukan dari CDN), supaya aplikasi tetap 100% offline-ready. File
hasil download ini **belum tentu sudah ada** di clone repo kamu — cek dulu:

```bash
ls public/fonts 2>/dev/null || echo "belum ada, perlu vendor:fetch"
```

Kalau belum ada, jalankan salah satu:
- **Lewat GitHub Actions** (tidak perlu Node.js/internet di komputer sendiri):
  tab **Actions** → workflow **"Vendor CDN Assets (self-host offline)"** →
  **Run workflow**, lalu `git pull` setelah selesai.
- **Manual** (kalau ada internet di komputer ini):
  ```bash
  npm run vendor:fetch
  ```
  (Langkah ini juga otomatis jalan tiap `npm run deploy` di bawah, jadi
  sebenarnya tidak wajib dijalankan terpisah kalau kamu langsung deploy —
  tapi baik untuk dicek dulu supaya tidak kaget kalau proses deploy makan
  waktu lebih lama dari biasanya karena download asset.)

Detail lengkap: [`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md) bagian
"Asset offline".

---

## 4. Deploy

```bash
npm run deploy
```
Perintah ini otomatis: `vendor:fetch` (pastikan asset offline lengkap) →
`build:css` (compile ulang Tailwind dari `src-css/input.css` — **wajib**
tiap ada perubahan class CSS di `public/*.html`) → `wrangler deploy`.

Tidak ada migration database untuk dijalankan (tidak ada database
server) — begitu deploy selesai, situsnya langsung bisa dibuka.

---

## 5. Pertama kali dibuka — wizard Setup Awal

Beda dari versi cloud lama yang punya akun seed default: sekarang **setiap
HP yang pertama kali membuka situs ini** akan disambut wizard **"Siapkan
Tokomu"** — isi nama toko, nama pemilik, username, password sendiri. Tidak
ada password bawaan yang perlu diganti. Detail:
[`PANDUAN-MODE-LOKAL.md`](./PANDUAN-MODE-LOKAL.md) bagian "Pertama kali
pakai".

Karena data per-HP, **kalau kamu buka situs ini dari HP/browser berbeda
untuk testing, kamu akan disambut wizard setup lagi** (database baru, kosong)
— itu normal, bukan bug.

---

## 6. Setelah deploy — checklist konfigurasi awal

1. **Setup Awal** (wizard, lihat bagian 5) → langsung dapat akun Super Admin
2. **Kelola Toko** (Admin → Pengaturan) → lengkapi alamat, atur Kustomisasi Struk
3. **Kelola Produk** → tambah produk toko (kode, nama, kategori, harga)
4. **Bahan Baku** → isi bahan baku & resep (opsional, buat laporan Margin akurat)
5. **Kelola User** → buat akun terpisah untuk tiap kasir (role **Kasir** —
   otomatis tidak bisa buka menu Admin/Laporan). Jangan share 1 akun untuk
   banyak orang.

---

## 7. Pakai domain sendiri (opsional)

Kalau punya domain yang DNS-nya dikelola Cloudflare:

1. **Cloudflare Dashboard → Workers & Pages → umkm → Settings → Domains & Routes**
2. **Add Custom Domain**, masukkan domain/subdomain (mis. `kasir.tokoanda.com`)
3. Cloudflare otomatis buat DNS record & sertifikat SSL

Tidak ada konfigurasi `ALLOWED_ORIGIN`/CORS yang perlu diubah (itu cuma
relevan untuk versi cloud lama yang punya Worker backend terpisah).

---

## 8. Backup & pindah data antar HP

Karena data 100% lokal per-HP, **tidak ada** `wrangler d1 export` untuk
backup server. Backup/restore dilakukan **di dalam aplikasi**:
**Admin → Pengaturan → Backup & Pindah HP** — export jadi 1 file `.json`
yang bisa diunduh, lalu diimpor lagi di HP lain. Ini **satu-satunya** cara
memindahkan data antar HP (lihat `local-backup.js`).

---

## 9. Build APK Android (opsional)

Aplikasi ini juga bisa dibungkus jadi APK Android (install seperti app
biasa, tetap 100% offline) — lihat panduan terpisah:
[`PANDUAN-APK.md`](./PANDUAN-APK.md).

---

## 10. Troubleshooting

**Ikon/font hilang, fitur Export Excel/Chart/QR error**
→ Asset offline belum di-download (lihat bagian 3). Jalankan workflow
"Vendor CDN Assets" atau `npm run vendor:fetch`, lalu `npm run deploy` ulang.

**"Endpoint tidak ditemukan" untuk request `/api/...`**
→ Buka DevTools (F12) → tab Console, cari error JavaScript. Kemungkinan
`mini-hono.js` (router lokal) gagal mount — cek tidak ada error merah saat
halaman dimuat. Kalau ada, laporkan pesan errornya lengkap.

**Wizard Setup Awal tidak muncul / muncul terus padahal sudah setup**
→ Cek IndexedDB browser (DevTools → Application → IndexedDB) beneran
tersimpan. Mode Incognito/Private Browsing **membersihkan IndexedDB saat
tab ditutup** — jangan pakai mode ini untuk pemakaian sehari-hari.

**Data hilang setelah tutup aplikasi / ganti HP**
→ Wajar (lihat bagian "Arsitektur" di atas) — data memang cuma di HP itu.
Pastikan rutin backup lewat **Admin → Pengaturan → Backup & Pindah HP**.

**Styling/tampilan berantakan setelah update kode**
→ CSS di-*compile* dari `src-css/input.css`, bukan CDN Tailwind. `npm run
deploy` sudah otomatis rebuild, tapi kalau testing manual pakai `wrangler
deploy` langsung (bukan `npm run deploy`), CSS baru tidak ikut ke-generate.
Selalu pakai `npm run deploy`.

**Service worker menampilkan versi lama setelah update kode**
→ `sw.js` pakai nama cache versi tertentu (`CACHE_NAME`). Naikkan versinya
tiap kali mengubah isi `public/` secara signifikan, supaya browser kasir
mengambil ulang app-shell & buang cache lama.

**Cetak Bluetooth tidak muncul tombolnya / gagal connect**
→ Web Bluetooth API cuma didukung Chrome/Edge di Android & Desktop —
Safari/iOS tidak mendukung sama sekali. Pastikan juga printer dalam mode
pairing/discoverable saat tombol "Cetak Langsung ke Printer" ditekan.

**Struk Bluetooth tercetak tapi karakternya aneh/rusak**
→ Kemungkinan printer tidak kompatibel dengan salah satu dari 3 UUID
service yang dicoba (`BT_PRINTER_SERVICES` di `public/js/pages/kasir-app.js`).
Coba printer lain, atau laporkan merek/model printernya untuk ditambahkan
UUID yang sesuai.

Untuk pertanyaan seputar pemakaian sehari-hari (bukan deploy), lihat
[`PANDUAN-PENGGUNA.md`](./PANDUAN-PENGGUNA.md).
