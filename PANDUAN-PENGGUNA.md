# Panduan Pengguna — muidsoft POS

Panduan praktis pakai aplikasi sehari-hari. Dibagi dua: **Kasir** (halaman
`index.html`, buat yang jualan) dan **Admin** (halaman `admin.html`, buat
yang atur menu/laporan).

---

# BAGIAN 1: KASIR

## Login & Shift

1. Buka aplikasi, login pakai username/password dari admin.
2. Sebelum mulai jualan, **buka shift** (tombol Shift di header) — isi modal
   awal kas di laci.
3. Di akhir hari/giliran, **tutup shift** — sistem hitung kas seharusnya ada
   di laci (dari transaksi tunai), Anda hitung kas fisik, sistem tunjukkan
   selisihnya kalau ada.

## Jualan produk

Tap produk di daftar — otomatis masuk keranjang qty 1 dengan harga tetap
sesuai yang diatur admin, tap lagi untuk nambah qty.

## Bayar

1. Buka keranjang (ikon keranjang atau geser dari bawah).
2. Cek Subtotal/Diskon/Total.
3. **Preorder** (opsional): kalau pembeli mau ambil nanti, tap toggle
   "Preorder (ambil nanti)", isi tanggal/jam ambil + nama/HP pemesan.
4. Tap **Bayar Sekarang** → pilih metode (Tunai/QRIS/Debit/Transfer) atau
   **SPLIT** untuk bayar pakai lebih dari satu metode sekaligus.
5. Struk muncul dengan nomor antrian besar di atas.

## Cetak struk

Tap **Cetak Langsung ke Printer** di struk — pertama kali akan diminta pilih
printer Bluetooth (harus sudah dinyalakan & dalam mode pairing). Setelah
tersambung sekali, printer tetap terhubung untuk transaksi berikutnya.

> Catatan: cetak Bluetooth cuma jalan di Chrome/Edge (Android/Desktop).
> Kalau kasir pakai iPhone/iPad, fitur cetak ini tidak tersedia — cukup
> tunjukkan struk di layar ke pembeli.

## Membatalkan transaksi/item

Kalau pembeli berubah pikiran **setelah** bayar (dalam 30 menit):

1. Buka menu **Akun** (ikon toko, pojok kiri atas) → **Batalkan Transaksi
   Terakhir**.
2. Muncul daftar item — centang yang mau dibatalkan saja (biarkan semua
   tercentang kalau mau batalkan seluruh transaksi).
3. Isi alasan (opsional), konfirmasi.

> **Penting**: kalau pembayarannya tunai, sistem **tidak otomatis**
> mengembalikan uang — Anda harus kembalikan uangnya secara fisik ke
> pembeli. Sistem cuma mengingatkan nominalnya.

Lewat dari 30 menit? Minta admin batalkan lewat panel admin (tidak ada
batas waktu untuk admin).

## Pesanan Ditahan (hold)

Kalau ada pembeli lain nyela sebelum transaksi selesai: tap ikon jeda
(pause) untuk simpan keranjang sementara, layani pembeli lain dulu, lanjut
lagi nanti dari daftar yang ditahan.

## Kalau internet mati

Transaksi tetap bisa diproses — otomatis disimpan di HP, ditandai lewat
ikon status koneksi (merah = offline) di header. Begitu internet nyala
lagi, transaksi yang tertunda otomatis terkirim ke server sendiri (tidak
perlu tindakan apa-apa).

---

# BAGIAN 2: ADMIN

Login pakai akun `admin_toko` atau `super_admin`. Dari kasir, akun admin
juga bisa langsung buka **Dashboard Admin** lewat menu Akun.

## Dashboard

- Kartu **Total Penjualan Hari Ini**, **Transaksi Hari Ini**, **Margin
  Kotor** (sesuai filter tanggal).
- Grafik **Tren Penjualan** & **Jam Ramai**.
- Tabel **Produk Terlaris** — produk mana yang paling banyak terjual (qty).
- Kalau ada peringatan kuning di bawah kartu Margin: sebagian produk belum
  ada resepnya (HPP dianggap Rp0), isi lewat **Bahan Baku**.

## Kelola Produk

- **Tambah Produk**: kode, nama, kategori, harga beli & harga jual (tetap).
- Tap ikon 🧪 di baris produk untuk atur **Resep** (bahan baku + takaran)
  — ini yang dipakai hitung HPP.
- Tombol 🗑️ menonaktifkan produk (bukan hapus permanen — transaksi lama
  yang pernah pakai produk ini tetap aman).

## Bahan Baku (buat hitung HPP/margin)

1. **Tambah Bahan Baku**: nama, satuan (gram/ml/butir/dll), harga per satuan.
2. Di **Kelola Produk**, tap ikon 🧪 di baris produk → pilih bahan baku
   + jumlah pakai.
3. HPP dihitung otomatis & **disimpan** tiap transaksi terjadi — jadi kalau
   besok harga bahan baku naik, laporan margin bulan lalu tidak ikut
   berubah (tetap akurat sesuai harga saat itu).

## Pesanan Mendatang (preorder)

Daftar semua preorder yang masuk, difilter status (Menunggu/Selesai/
Dibatalkan). Tandai **Selesai** setelah diambil pembeli, atau **Batal**
kalau pembeli tidak jadi ambil.

## Riwayat Transaksi

Lihat semua transaksi (sesuai filter tanggal di Dashboard). Tombol
**Batalkan** di tiap baris (kalau masih berstatus "selesai") — bisa pilih
item mana saja yang mau dibatalkan, sama seperti di kasir, tapi **tanpa
batas waktu 30 menit**. Label kecil "N item batal" muncul kalau sebagian
item transaksi itu sudah pernah dibatalkan sebelumnya.

## Kelola Kasir

Tambah/ubah akun kasir & admin. Password diatur lewat form ini juga.

## Kelola Toko

- Data toko (nama, alamat) — muncul di struk & header aplikasi.
- **Kustomisasi Struk**: lebar kertas (58/80mm), pesan footer, catatan
  tambahan, ikon footer (QR code asli yang bisa di-scan / nama toko),
  tampilkan/sembunyikan alamat & nomor antrian.
- **Kelola Data** (khusus super_admin, ada di bagian paling bawah):
  - **Hapus Semua Bahan Baku & Resep** — buat buang data contoh sebelum
    mulai jualan beneran.
  - **Hapus Transaksi** — isi rentang tanggal (atau kosongkan untuk semua),
    wajib ketik "HAPUS" buat konfirmasi. **Permanen, tidak bisa dibatalkan**
    — backup dulu (`wrangler d1 export`) kalau ragu.

## Log Aktivitas

Audit trail — siapa mengubah/menghapus/membatalkan apa dan kapan. Berguna
kalau ada yang perlu ditelusuri (mis. kenapa suatu transaksi dibatalkan).

## Export Excel

Dari Dashboard, tombol export — hasilnya 3 sheet: Transaksi, Kombinasi
Terlaris, Margin (sesuai filter tanggal yang aktif).

---

## Pertanyaan umum

**Kenapa margin kelihatan tinggi banget?**
→ Cek peringatan di kartu Margin — kemungkinan sebagian produk belum ada
resep bahan bakunya (dianggap HPP Rp0, jadi margin keliatan lebih tinggi
dari kenyataan). Isi resepnya di Kelola Produk.

**Nomor antrian kok balik ke 1 padahal masih hari yang sama?**
→ Seharusnya tidak — nomor antrian reset otomatis cuma di pergantian hari
(jam 00:00 WIB). Kalau kejadian, laporkan beserta waktu kejadiannya.

**Kasir salah pilih produk, gimana?**
→ Kalau belum bayar: hapus dari keranjang, susun ulang. Kalau sudah bayar:
pakai fitur Batalkan (per item), lalu buat transaksi baru dengan pilihan
yang benar.

**Bisa multi-cabang?**
→ Skema database sudah mendukung, tapi UI saat ini disederhanakan untuk 1
outlet. Kalau mau buka cabang kedua, informasikan supaya fitur pilih-toko
diaktifkan kembali.
