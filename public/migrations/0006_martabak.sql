-- ==========================================================
-- Migration 0006 — Konversi menu jadi jualan Martabak.
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0006_martabak.sql
--
-- Yang ditambahkan:
--   1. Kolom `tipe` di produk ('simple' = harga tetap seperti biasa,
--      'custom' = pakai builder ukuran + topping, harga dihitung server).
--   2. Tabel produk_ukuran   — pilihan ukuran per produk custom + harganya.
--   3. Tabel produk_topping  — pilihan topping/isian tambahan + harga tambahnya.
--   4. Tabel produk_combo    — menu cepat/preset (kombinasi ukuran+topping
--      yang sudah jadi, biar kasir tinggal 1x klik untuk kombinasi favorit).
--   5. Kolom tambahan di detail_transaksi untuk menyimpan ukuran & topping
--      yang dipilih pelanggan (supaya struk & riwayat transaksi lengkap).
--
-- CATATAN: produk demo lama (Indomie, dsb) di-nonaktifkan (is_active=0),
-- BUKAN dihapus — supaya kalau ada transaksi lama yang mereferensikannya
-- tidak jadi patah (FK ke detail_transaksi tetap valid). Kalau database
-- ini masih benar-benar kosong (belum pernah dipakai jualan), aman untuk
-- dihapus manual belakangan.
-- ==========================================================

ALTER TABLE produk ADD COLUMN tipe TEXT DEFAULT 'simple';

ALTER TABLE detail_transaksi ADD COLUMN ukuran_nama TEXT;
ALTER TABLE detail_transaksi ADD COLUMN topping_json TEXT;
ALTER TABLE detail_transaksi ADD COLUMN catatan TEXT;

CREATE TABLE IF NOT EXISTS produk_ukuran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk_id INTEGER NOT NULL REFERENCES produk(id),
  nama TEXT NOT NULL,
  harga REAL NOT NULL CHECK(harga >= 0),
  urutan INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produk_topping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk_id INTEGER NOT NULL REFERENCES produk(id),
  nama TEXT NOT NULL,
  harga_tambahan REAL NOT NULL DEFAULT 0 CHECK(harga_tambahan >= 0),
  urutan INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produk_combo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk_id INTEGER NOT NULL REFERENCES produk(id),
  nama TEXT NOT NULL,
  ukuran_id INTEGER REFERENCES produk_ukuran(id),
  topping_ids TEXT NOT NULL DEFAULT '[]', -- JSON array id produk_topping
  harga_override REAL,                    -- NULL = jumlahkan otomatis (ukuran + topping)
  urutan INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_produk_ukuran_produk ON produk_ukuran(produk_id, is_active);
CREATE INDEX IF NOT EXISTS idx_produk_topping_produk ON produk_topping(produk_id, is_active);
CREATE INDEX IF NOT EXISTS idx_produk_combo_produk ON produk_combo(produk_id, is_active);

-- ==========================================================
-- Nonaktifkan produk & kategori demo lama
-- ==========================================================
UPDATE produk SET is_active = 0 WHERE kode_produk IN
  ('899123456','899654321','899112233','899445566','899333222','899111222');

UPDATE toko SET nama = 'Martabak Kita', alamat = 'Jl. Contoh No. 1, Surabaya (ganti lewat panel admin)' WHERE id = 1;

-- Judul aplikasi (ditampilkan di kasir/admin/struk) sudah bisa diatur lewat
-- panel admin (Pengaturan > Judul Aplikasi) sejak migration 0005 — di sini
-- cuma diganti nilai defaultnya saja.
INSERT INTO pengaturan (key, value) VALUES ('app_title', 'Martabak Kita')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;

-- ==========================================================
-- Kategori martabak
-- ==========================================================
INSERT INTO kategori (nama) VALUES ('Martabak Manis'), ('Martabak Telur'), ('Minuman');

-- ==========================================================
-- Produk custom (builder ukuran + topping)
-- ==========================================================
INSERT INTO produk (toko_id, kategori_id, kode_produk, nama, harga_beli, harga_jual, stok, satuan, tipe)
VALUES (
  1,
  (SELECT id FROM kategori WHERE nama = 'Martabak Manis'),
  'MTB-MANIS', 'Martabak Manis', 0, 0, 0, 'loyang', 'custom'
);

INSERT INTO produk (toko_id, kategori_id, kode_produk, nama, harga_beli, harga_jual, stok, satuan, tipe)
VALUES (
  1,
  (SELECT id FROM kategori WHERE nama = 'Martabak Telur'),
  'MTB-TELUR', 'Martabak Telur', 0, 0, 0, 'loyang', 'custom'
);

-- Produk simple (harga tetap, tanpa builder) — pelengkap/minuman
INSERT INTO produk (toko_id, kategori_id, kode_produk, nama, harga_beli, harga_jual, stok, satuan, tipe) VALUES
  (1, (SELECT id FROM kategori WHERE nama = 'Minuman'), 'MIN-ESTEH', 'Es Teh Manis', 0, 5000, 0, 'gelas', 'simple'),
  (1, (SELECT id FROM kategori WHERE nama = 'Minuman'), 'MIN-TEHANGET', 'Teh Anget', 0, 4000, 0, 'gelas', 'simple'),
  (1, (SELECT id FROM kategori WHERE nama = 'Minuman'), 'MIN-AQUA', 'Air Mineral', 0, 4000, 0, 'botol', 'simple');

-- ==========================================================
-- Ukuran Martabak Manis
-- ==========================================================
INSERT INTO produk_ukuran (produk_id, nama, harga, urutan) VALUES
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Mini', 15000, 1),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Setengah Loyang', 25000, 2),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Full Loyang', 45000, 3);

-- Ukuran Martabak Telur
INSERT INTO produk_ukuran (produk_id, nama, harga, urutan) VALUES
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Telur Ayam Kecil', 20000, 1),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Telur Ayam Besar', 35000, 2),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Telur Bebek Spesial', 45000, 3);

-- ==========================================================
-- Topping Martabak Manis
-- ==========================================================
INSERT INTO produk_topping (produk_id, nama, harga_tambahan, urutan) VALUES
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Keju', 5000, 1),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Kacang', 3000, 2),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Wijen', 3000, 3),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Selai Strawberry', 5000, 4),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Susu Kental Manis', 3000, 5),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Oreo', 7000, 6),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'), 'Nutella', 10000, 7);

-- Topping Martabak Telur
INSERT INTO produk_topping (produk_id, nama, harga_tambahan, urutan) VALUES
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Daging Sapi', 8000, 1),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Daging Ayam', 5000, 2),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Sosis', 5000, 3),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Extra Telur', 4000, 4),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Extra Daging', 6000, 5),
  ((SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'), 'Keju', 5000, 6);

-- ==========================================================
-- Menu cepat / combo (tombol pintas di kasir untuk kombinasi favorit)
-- ==========================================================
INSERT INTO produk_combo (produk_id, nama, ukuran_id, topping_ids, harga_override, urutan) VALUES
  (
    (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'),
    'Manis Full Keju Kacang',
    (SELECT id FROM produk_ukuran WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS') AND nama = 'Full Loyang'),
    json_array(
      (SELECT id FROM produk_topping WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS') AND nama = 'Keju'),
      (SELECT id FROM produk_topping WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS') AND nama = 'Kacang')
    ),
    NULL,
    1
  ),
  (
    (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS'),
    'Manis Mini Keju',
    (SELECT id FROM produk_ukuran WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS') AND nama = 'Mini'),
    json_array(
      (SELECT id FROM produk_topping WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-MANIS') AND nama = 'Keju')
    ),
    NULL,
    2
  ),
  (
    (SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR'),
    'Telur Besar Spesial Daging',
    (SELECT id FROM produk_ukuran WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR') AND nama = 'Telur Ayam Besar'),
    json_array(
      (SELECT id FROM produk_topping WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR') AND nama = 'Daging Sapi'),
      (SELECT id FROM produk_topping WHERE produk_id = (SELECT id FROM produk WHERE kode_produk = 'MTB-TELUR') AND nama = 'Extra Telur')
    ),
    NULL,
    3
  );
