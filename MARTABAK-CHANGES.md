# Perubahan: Kasir Cloud → Martabak Kita

> 📖 Dokumen ini adalah **riwayat/changelog** pengembangan, disusun per tahap.
> Untuk panduan pakai sehari-hari, deploy, atau referensi API, lihat:
> [`README.md`](./README.md) · [`PANDUAN-DEPLOY.md`](./PANDUAN-DEPLOY.md) ·
> [`PANDUAN-PENGGUNA.md`](./PANDUAN-PENGGUNA.md) · [`REFERENSI-API.md`](./REFERENSI-API.md)

Ringkasan semua yang diubah dari template POS generik jadi sistem kasir martabak,
berdasarkan jawaban yang kamu kasih di awal.

## Struktur bisnis
- **1 outlet**, tetap ada login **admin** & **kasir** (role `super_admin`/`admin_toko` di
  database tidak diubah — cuma dipakai untuk 1 toko saja, jadi secara efektif jadi
  "admin" & "kasir").
- **Tidak ada pelacakan stok** — endpoint & kolom stok lama masih ada di database (biar
  tidak ada yang patah), tapi transaksi sekarang tidak lagi memotong stok, dan
  dashboard/laporan "Stok Menipis" + tombol "Koreksi Stok" sudah dihapus dari tampilan.
- Semua fitur teknis lama dipertahankan: offline mode, split payment, cetak struk
  thermal, export Excel, upload foto produk.

## Menu martabak
- **Martabak Manis** & **Martabak Telur** jadi produk "custom": kasir pilih **ukuran**
  (wajib, 1 pilihan) lalu **topping** tambahan (opsional, boleh lebih dari satu).
  Harga dihitung otomatis: harga ukuran + total harga topping.
- Ada 3 minuman contoh (Es Teh Manis, Teh Anget, Air Mineral) sebagai produk "simple"
  (harga tetap seperti sistem lama) — supaya kelihatan gimana campur custom & simple.
- **Menu Cepat**: tombol pintas kombinasi favorit (ukuran+topping) di kasir, diatur dari
  tab baru "Menu Cepat" di admin panel.
- Semua harga di atas (ukuran, topping, menu cepat) **cuma perkiraan awal** — silakan
  diedit langsung dari panel admin, tidak perlu ubah kode/migration lagi.

## Yang harus kamu lakukan sebelum pakai
1. **Migrasi database** (setelah migration lama sudah pernah dijalankan):
   ```
   npm install
   npm run db:migrate:local:martabak   # untuk dev lokal
   npm run db:migrate:remote:martabak  # untuk database production di Cloudflare
   ```
2. **Deploy**: `npm run deploy` seperti biasa.
3. Login sebagai admin → cek tab **Kelola Produk** (atur ukuran/topping lewat ikon
   <i class="fas fa-sliders-h"></i>), tab **Menu Cepat**, dan **Pengaturan** (nama
   usaha "Martabak Kita" bisa langsung diganti nama usahamu di sana — nggak perlu
   redeploy).
4. Sesuaikan alamat toko lewat tab **Kelola Toko**, dan foto produk lewat form edit
   produk seperti biasa.

## Kalau ada database production yang sudah dipakai jualan produk lama
Migration `0006_martabak.sql` **menonaktifkan** (bukan menghapus) produk demo lama, jadi
transaksi lama tetap aman. Tapi kalau kamu sudah sempat isi produk RIIL (bukan demo) di
database ini, cek dulu isi migration sebelum dijalankan — bagian `UPDATE produk SET
is_active = 0 WHERE kode_produk IN (...)` cuma menyasar kode produk demo bawaan
template, jadi produkmu sendiri aman, tapi kategori/toko yang di-reseed (`INSERT INTO
kategori...`, `UPDATE toko...`) sebaiknya ditinjau ulang.

## File yang berubah
- `migrations/0006_martabak.sql` — tabel baru `produk_ukuran`, `produk_topping`,
  `produk_combo`, kolom baru di `produk` & `detail_transaksi`, seed data martabak.
- `src/index.ts` — endpoint CRUD ukuran/topping/combo, perhitungan harga transaksi
  server-side untuk produk custom (harga tetap dihitung ulang di server, tidak percaya
  angka dari HP kasir — sama seperti sistem harga lama), stok tidak lagi dipotong saat
  transaksi.
- `public/index.html` — builder ukuran+topping saat kasir pilih martabak, tombol Menu
  Cepat, keranjang & struk menampilkan detail ukuran/topping/catatan.
- `public/admin.html` — form produk punya pilihan Tipe (Simple/Custom), modal Ukuran &
  Topping, tab & modal Menu Cepat, widget/export Stok Menipis dihapus.
- `public/manifest.json`, `public/sw.js` — branding PWA & versi cache diperbarui.

---

## Update lanjutan: Nomor Antrian, Preorder, HPP/Margin & Analisa

Migration `0007_fitur_lanjutan.sql` menambah:

### 1. Nomor Antrian
Tiap transaksi otomatis dapat nomor urut harian (reset tiap hari, per toko), tercetak
besar di bagian atas struk. Dihitung server-side saat transaksi dibuat — untuk 1 kasir/1
outlet risiko nomor kembar sangat kecil, tapi kalau nanti ada beberapa kasir input
bersamaan persis di detik yang sama, teorinya bisa dobel (limitasi yang disengaja demi
kesederhanaan, cukup untuk skala UMKM).

### 2. Preorder / Jadwal Ambil
Di keranjang kasir ada toggle "Preorder (ambil nanti)" — isi tanggal/jam ambil + nama/HP
pemesan (opsional). Admin bisa lihat & kelola di tab **Pesanan Mendatang** (tandai
selesai/dibatalkan). Struk preorder menampilkan jadwal ambilnya, bukan cuma nomor
antrian biasa.

### 3. HPP & Margin (Bisnis & Analisa)
- Tab **Bahan Baku** (admin): daftar bahan mentah + harga per satuan (mis. Tepung
  Terigu Rp12/gram).
- Di modal Ukuran & Topping tiap produk, ada tombol resep (ikon labu <i
  class="fas fa-flask"></i>) untuk menghubungkan bahan baku + takaran ke ukuran/topping
  tersebut.
- HPP dihitung & **disimpan (snapshot)** tiap kali ada transaksi — supaya laporan margin
  bulan lalu tidak ikut berubah kalau harga bahan baku naik/turun hari ini.
- Dashboard admin sekarang punya kartu **Margin Kotor**, grafik **Jam Ramai**, dan tabel
  **Kombinasi Terlaris** (bukan cuma "Martabak Manis" secara umum, tapi rincian sampai
  ke ukuran+topping mana yang paling laku).
- **Resep starter sudah diisi otomatis** untuk Full Loyang Manis, topping Keju & Kacang,
  dan Telur Ayam Besar — cuma contoh takaran & harga, **wajib disesuaikan** dengan resep
  & harga belanja asli lewat panel admin supaya angka margin akurat. Produk/ukuran/
  topping lain yang belum ada resepnya akan tampil HPP = Rp0 (bukan error, cuma belum
  diisi).

### File yang berubah (update ini)
- `migrations/0007_fitur_lanjutan.sql` — tabel `bahan_baku`, `resep_item`, kolom baru
  di `transaksi` (nomor_antrian, is_preorder, waktu_ambil, nama_pemesan, hp_pemesan,
  status_preorder) & `detail_transaksi` (ukuran_id, hpp_satuan).
- `src/index.ts` — endpoint `/api/bahan-baku`, `/api/resep`, `/api/preorder`,
  `/api/laporan/margin`, `/api/laporan/kombinasi-terlaris`, `/api/laporan/jam-ramai`;
  perhitungan HPP & nomor antrian terintegrasi ke `POST /api/transaksi`.
- `public/index.html` — nomor antrian & info preorder di struk, toggle preorder di
  cart drawer, payload offline-sync ikut membawa data preorder.
- `public/admin.html` — tab Bahan Baku, tab Pesanan Mendatang, resep di modal Ukuran &
  Topping, kartu Margin + grafik Jam Ramai + tabel Kombinasi Terlaris di dashboard,
  export Excel dapat sheet Margin & Kombinasi Terlaris.

### Yang harus dilakukan setelah update ini
```
npm install
npm run db:migrate:remote:fitur-lanjutan
npm run deploy
```
Lalu buka tab **Bahan Baku** & resep tiap ukuran/topping untuk mengisi/menyesuaikan
harga bahan baku sungguhan — angka margin baru akurat setelah itu.

---

## Update lanjutan: Kustomisasi Struk & Cetak Langsung Bluetooth

Migration `0008_kustomisasi_struk.sql` menambah pengaturan tampilan struk, diambil dari
sebuah versi lanjutan template ini yang sudah lebih dulu punya fitur ini ("kas-main").

### Yang baru
- **Lebar kertas printer** (58mm/80mm) — struk otomatis menyesuaikan lebar, baik saat
  cetak lewat browser maupun Bluetooth.
- **Pesan footer & catatan tambahan** yang bisa diubah tanpa redeploy (mis. ucapan
  terima kasih custom, syarat retur, nomor WA).
- **Ikon footer struk**: tidak ada / QR code asli yang bisa di-scan (mis. link
  WhatsApp/Instagram toko, digenerate di browser kasir — tidak dikirim ke pihak ketiga)
  / nama toko sebagai teks besar mirip logo.
- **Cetak langsung ke printer thermal Bluetooth** (ESC/POS) — tombol baru di struk,
  terpisah dari "Cetak (Browser)". Sekali connect, printer tetap tersambung untuk
  transaksi berikutnya. Catatan kompatibilitas: Web Bluetooth API hanya didukung
  Chrome/Edge di Android & Desktop — Safari/iOS tidak mendukung sama sekali, pakai
  "Cetak (Browser)" sebagai alternatif di perangkat itu.
- Semua pengaturan ini diatur dari tab **Kelola Toko** → kartu "Kustomisasi Struk" di
  admin panel.
- Detail ukuran/topping/catatan tiap martabak & info nomor antrian/preorder tetap
  tampil di kedua jalur cetak (browser maupun Bluetooth) — bukan cuma nama produk polos.

### File yang berubah (update ini)
- `migrations/0008_kustomisasi_struk.sql` — nilai default pengaturan struk baru.
- `src/index.ts` — `GET`/`PUT /api/settings` diperluas untuk field `struk_*`.
- `public/index.html` — QRCode.js, CSS lebar kertas 80mm, ikon footer dinamis, mesin
  ESC/POS lengkap (QR code native printer, format sesuai lebar kertas, tombol cetak
  Bluetooth).
- `public/admin.html` — kartu "Kustomisasi Struk" di tab Kelola Toko.


