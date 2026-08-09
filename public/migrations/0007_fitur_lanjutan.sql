-- ==========================================================
-- Migration 0007 — Nomor antrian, Preorder, dan HPP/Margin (bahan baku + resep).
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0007_fitur_lanjutan.sql
-- ==========================================================

-- ----------------------------------------------------------
-- 1) NOMOR ANTRIAN — dicetak besar di struk, direset otomatis tiap hari
--    (dihitung ulang tiap transaksi baru: jumlah transaksi hari itu + 1).
-- ----------------------------------------------------------
ALTER TABLE transaksi ADD COLUMN nomor_antrian INTEGER;

-- ----------------------------------------------------------
-- 2) PREORDER / JADWAL AMBIL
-- ----------------------------------------------------------
ALTER TABLE transaksi ADD COLUMN is_preorder INTEGER DEFAULT 0;
ALTER TABLE transaksi ADD COLUMN waktu_ambil TEXT;        -- ISO datetime, kapan pelanggan mau ambil
ALTER TABLE transaksi ADD COLUMN nama_pemesan TEXT;
ALTER TABLE transaksi ADD COLUMN hp_pemesan TEXT;
ALTER TABLE transaksi ADD COLUMN status_preorder TEXT;    -- 'menunggu' | 'selesai' | 'dibatalkan' (NULL kalau bukan preorder)

CREATE INDEX IF NOT EXISTS idx_transaksi_preorder ON transaksi(toko_id, is_preorder, waktu_ambil);
CREATE INDEX IF NOT EXISTS idx_transaksi_toko_created ON transaksi(toko_id, created_at);

-- ----------------------------------------------------------
-- 3) HPP / MARGIN — bahan baku + resep (BOM) per produk-simple / ukuran / topping.
--    HPP tiap baris transaksi DIHITUNG & DISIMPAN saat transaksi terjadi
--    (bukan dihitung ulang belakangan pakai harga bahan baku TERKINI),
--    supaya laporan margin bulan lalu tidak berubah kalau harga bahan baku
--    naik/turun hari ini.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS bahan_baku (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id INTEGER NOT NULL REFERENCES toko(id),
  nama TEXT NOT NULL,
  satuan TEXT NOT NULL DEFAULT 'gram',       -- gram, ml, butir, porsi, pcs, dst — bebas teks
  harga_per_satuan REAL NOT NULL CHECK(harga_per_satuan >= 0),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ref_type+ref_id menunjuk ke produk (produk simple), produk_ukuran, atau
-- produk_topping — satu pola generik dipakai untuk ketiganya supaya tidak
-- perlu 3 tabel resep terpisah.
CREATE TABLE IF NOT EXISTS resep_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_type TEXT NOT NULL CHECK(ref_type IN ('produk', 'ukuran', 'topping')),
  ref_id INTEGER NOT NULL,
  bahan_baku_id INTEGER NOT NULL REFERENCES bahan_baku(id),
  jumlah REAL NOT NULL CHECK(jumlah > 0),
  urutan INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resep_item_ref ON resep_item(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_bahan_baku_toko ON bahan_baku(toko_id, is_active);

-- detail_transaksi: tambah ukuran_id (dulu cuma nama-nya yang disimpan,
-- sekarang perlu id-nya juga untuk lookup resep & laporan kombinasi-terlaris
-- yang konsisten), dan hpp_satuan (HPP per unit, di-snapshot saat transaksi).
ALTER TABLE detail_transaksi ADD COLUMN ukuran_id INTEGER;
ALTER TABLE detail_transaksi ADD COLUMN hpp_satuan REAL DEFAULT 0;

-- ----------------------------------------------------------
-- 4) Contoh data bahan baku + resep starter untuk Martabak Kita.
--    INI CUMA CONTOH TAKARAN & HARGA — sesuaikan dengan resep & harga
--    belanja bahan baku kamu yang sebenarnya lewat panel admin
--    (tab "Bahan Baku" dan tombol "Resep" di tiap ukuran/topping).
-- ----------------------------------------------------------
INSERT INTO bahan_baku (toko_id, nama, satuan, harga_per_satuan) VALUES
  (1, 'Tepung Terigu', 'gram', 12),
  (1, 'Telur Ayam', 'butir', 2500),
  (1, 'Gula Pasir', 'gram', 14),
  (1, 'Mentega', 'gram', 30),
  (1, 'Susu Kental Manis', 'ml', 20),
  (1, 'Coklat Meses', 'gram', 25),
  (1, 'Keju Cheddar', 'gram', 35),
  (1, 'Kacang Tanah', 'gram', 20),
  (1, 'Daging Sapi Cincang', 'gram', 60),
  (1, 'Daun Bawang & Bumbu', 'porsi', 2000),
  (1, 'Minyak Goreng', 'ml', 18);

-- Resep dasar Martabak Manis "Full Loyang" (adonan + coklat meses dasar)
INSERT INTO resep_item (ref_type, ref_id, bahan_baku_id, jumlah) VALUES
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Tepung Terigu'), 250),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Telur Ayam'), 3),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Gula Pasir'), 100),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Mentega'), 50),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Susu Kental Manis'), 30),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Full Loyang'),
    (SELECT id FROM bahan_baku WHERE nama='Coklat Meses'), 50);

-- Resep topping Manis
INSERT INTO resep_item (ref_type, ref_id, bahan_baku_id, jumlah) VALUES
  ('topping', (SELECT id FROM produk_topping WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Keju'),
    (SELECT id FROM bahan_baku WHERE nama='Keju Cheddar'), 40),
  ('topping', (SELECT id FROM produk_topping WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-MANIS') AND nama='Kacang'),
    (SELECT id FROM bahan_baku WHERE nama='Kacang Tanah'), 30);

-- Resep dasar Martabak Telur "Telur Ayam Besar"
INSERT INTO resep_item (ref_type, ref_id, bahan_baku_id, jumlah) VALUES
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-TELUR') AND nama='Telur Ayam Besar'),
    (SELECT id FROM bahan_baku WHERE nama='Tepung Terigu'), 200),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-TELUR') AND nama='Telur Ayam Besar'),
    (SELECT id FROM bahan_baku WHERE nama='Telur Ayam'), 4),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-TELUR') AND nama='Telur Ayam Besar'),
    (SELECT id FROM bahan_baku WHERE nama='Daging Sapi Cincang'), 80),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-TELUR') AND nama='Telur Ayam Besar'),
    (SELECT id FROM bahan_baku WHERE nama='Daun Bawang & Bumbu'), 1),
  ('ukuran', (SELECT id FROM produk_ukuran WHERE produk_id=(SELECT id FROM produk WHERE kode_produk='MTB-TELUR') AND nama='Telur Ayam Besar'),
    (SELECT id FROM bahan_baku WHERE nama='Minyak Goreng'), 100);
