-- ==========================================================
-- Migration 0001 — Skema awal Sistem Kasir + seed data demo
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0001_init.sql
-- ==========================================================

-- Tabel Toko/Cabang
CREATE TABLE IF NOT EXISTS toko (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  alamat TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tabel User (kasir & admin)
-- FIX: password disimpan sebagai hash + salt terpisah (PBKDF2-SHA256, 100k iterasi).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nama_lengkap TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin','admin_toko','kasir')),
  toko_id INTEGER REFERENCES toko(id),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tabel Kategori Produk
CREATE TABLE IF NOT EXISTS kategori (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL
);

-- Tabel Produk
CREATE TABLE IF NOT EXISTS produk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id INTEGER NOT NULL REFERENCES toko(id),
  kategori_id INTEGER REFERENCES kategori(id),
  kode_produk TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  harga_beli REAL DEFAULT 0,
  harga_jual REAL NOT NULL,
  stok INTEGER NOT NULL DEFAULT 0,
  satuan TEXT DEFAULT 'pcs',
  gambar_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tabel Transaksi (header)
CREATE TABLE IF NOT EXISTS transaksi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_transaksi TEXT UNIQUE NOT NULL,
  toko_id INTEGER NOT NULL REFERENCES toko(id),
  kasir_id INTEGER NOT NULL REFERENCES users(id),
  total_belanja REAL NOT NULL,
  diskon REAL DEFAULT 0,
  pajak REAL DEFAULT 0,
  total_bayar REAL NOT NULL,
  metode_bayar TEXT CHECK(metode_bayar IN ('cash','transfer','qris','debit')),
  uang_diterima REAL,
  kembalian REAL DEFAULT 0,
  status TEXT DEFAULT 'selesai' CHECK(status IN ('selesai','dibatalkan')),
  offline_uuid TEXT UNIQUE, -- krusial: cegah duplikasi saat sync offline
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tabel Detail Transaksi
CREATE TABLE IF NOT EXISTS detail_transaksi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id INTEGER NOT NULL REFERENCES transaksi(id),
  produk_id INTEGER NOT NULL REFERENCES produk(id),
  nama_produk TEXT NOT NULL,
  harga_satuan REAL NOT NULL,
  qty INTEGER NOT NULL,
  subtotal REAL NOT NULL
);

-- Tabel Riwayat Stok (audit trail)
CREATE TABLE IF NOT EXISTS riwayat_stok (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produk_id INTEGER NOT NULL REFERENCES produk(id),
  jenis TEXT CHECK(jenis IN ('masuk','keluar','koreksi')),
  jumlah INTEGER NOT NULL,
  stok_sebelum INTEGER NOT NULL,
  stok_sesudah INTEGER NOT NULL,
  referensi TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_transaksi_toko_tanggal ON transaksi(toko_id, created_at);
CREATE INDEX IF NOT EXISTS idx_detail_transaksi_id ON detail_transaksi(transaksi_id);
CREATE INDEX IF NOT EXISTS idx_produk_toko ON produk(toko_id, is_active);
CREATE INDEX IF NOT EXISTS idx_produk_kode ON produk(kode_produk);
CREATE INDEX IF NOT EXISTS idx_riwayat_stok_produk ON riwayat_stok(produk_id);
CREATE INDEX IF NOT EXISTS idx_users_toko ON users(toko_id);

-- ==========================================================
-- SEED DATA (data contoh untuk testing awal — hapus/ganti saat go-live)
-- ==========================================================

INSERT INTO toko (id, nama, alamat) VALUES (1, 'Toko Pusat', 'Jl. Sudirman No. 1, Jakarta');

-- User: admin / admin123  (role: super_admin)
INSERT INTO users (username, password_hash, password_salt, nama_lengkap, role, toko_id)
VALUES (
  'admin',
  '140a7aca01833a760a75db961467aca75f727d7ef1fe67e7f17200b9e6860a14',
  'TFmX3NRudck7T7kc2nXSTQ==',
  'Harvey (Admin)',
  'super_admin',
  1
);

-- User: kasir1 / kasir123  (role: kasir)
INSERT INTO users (username, password_hash, password_salt, nama_lengkap, role, toko_id)
VALUES (
  'kasir1',
  'cd908c8474284c0ce2441e079755b4f43dd1cb416f5955cbe131816f9dd82c99',
  'ZuY57TlXvVrXsZh+/82REg==',
  'Kasir Satu',
  'kasir',
  1
);

INSERT INTO kategori (id, nama) VALUES (1, 'Makanan'), (2, 'Minuman');

INSERT INTO produk (toko_id, kategori_id, kode_produk, nama, harga_beli, harga_jual, stok, satuan) VALUES
  (1, 1, '899123456', 'Indomie Goreng Original', 2800, 3500, 120, 'pcs'),
  (1, 2, '899654321', 'Kopi Kenangan Botol', 7500, 9500, 45, 'pcs'),
  (1, 1, '899112233', 'Roti Aoka Coklat', 2000, 2500, 80, 'pcs'),
  (1, 2, '899445566', 'Aqua Botol 600ml', 2200, 3000, 200, 'pcs'),
  (1, 1, '899333222', 'Beras Ramos 5kg', 68000, 75000, 15, 'pcs'),
  (1, 2, '899111222', 'Susu UHT 1L', 15000, 18500, 50, 'pcs');

-- ==========================================================
-- PENTING — Ganti password default sebelum go-live produksi:
--   node scripts/gen-password-hash.mjs "passwordBaruAnda"
-- lalu jalankan:
--   wrangler d1 execute pos_db --command="UPDATE users SET password_hash='...', password_salt='...' WHERE username='admin'"
-- ==========================================================
