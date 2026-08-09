-- ==========================================================
-- Migration 0013 — Konversi jadi kasir toko umum (rebrand ke "muidsoft").
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0013_kasir_toko.sql
--
-- Yang dilakukan:
--   1. Hapus fitur builder ukuran + topping (produk_ukuran, produk_topping,
--      produk_combo) beserta resep & data demo martabak yang menempel di sana.
--      Semua produk sekarang selalu tipe simple (harga tetap).
--   2. Hapus semua data produk/kategori/bahan-baku demo lama — toko akan
--      diisi ulang dari awal lewat panel admin.
--   3. Ganti nama toko & judul aplikasi jadi "muidsoft" (nilai ini cuma
--      default sementara — pada instalasi lokal, wizard "Setup Awal" akan
--      langsung menimpanya dengan nama toko pilihan pemilik toko).
-- ==========================================================

-- 1) Buang resep_item yang nempel ke ukuran/topping (bakal jadi sampah
--    begitu tabel produk_ukuran/produk_topping dihapus di bawah).
DELETE FROM resep_item WHERE ref_type IN ('ukuran', 'topping');

DROP TABLE IF EXISTS produk_combo;
DROP TABLE IF EXISTS produk_topping;
DROP TABLE IF EXISTS produk_ukuran;

-- 2) Bersihkan semua data produk/kategori/bahan-baku demo (termasuk resep
--    produk-simple yang masih nyisa) — admin isi ulang dari panel admin.
DELETE FROM resep_item WHERE ref_type = 'produk';
DELETE FROM bahan_baku;
DELETE FROM produk;
DELETE FROM kategori;

-- 3) Rebranding
UPDATE toko SET nama = 'muidsoft' WHERE id = 1;
INSERT INTO pengaturan (key, value) VALUES ('app_title', 'muidsoft')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
