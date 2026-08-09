-- ==========================================================
-- Migration 0012 — Status Bayar untuk Preorder (Lunas / DP / Belum Bayar)
-- Jalankan: wrangler d1 execute umkm2 --file=./migrations/0012_status_bayar_preorder.sql
-- ==========================================================
-- Preorder sekarang bisa: dibayar lunas di muka (perilaku lama, default),
-- DP sebagian (sisanya dilunasi saat ambil), atau belum bayar sama sekali
-- (bayar penuh saat ambil). Transaksi BIASA (bukan preorder) selalu tetap
-- 'lunas' seperti sebelumnya — tidak ada perubahan perilaku untuk kasir
-- reguler. Tidak pakai CHECK constraint (konsisten dengan kolom
-- status_preorder yang sudah ada) — divalidasi di application layer saja,
-- supaya ALTER TABLE ADD COLUMN ini tetap aman dijalankan di SQLite/D1.

ALTER TABLE transaksi ADD COLUMN status_bayar TEXT DEFAULT 'lunas'; -- 'lunas' | 'dp' | 'belum_bayar'
ALTER TABLE transaksi ADD COLUMN jumlah_dp REAL DEFAULT 0;          -- nominal yang sudah diterima di muka
ALTER TABLE transaksi ADD COLUMN sisa_bayar REAL DEFAULT 0;         -- total_bayar - jumlah_dp, dilunasi saat ambil

-- Backfill data lama (transaksi yang sudah ada sebelum migrasi ini, termasuk
-- preorder lama) — semuanya dianggap lunas penuh, sama seperti perilaku
-- sistem sebelum fitur ini ada.
UPDATE transaksi
SET status_bayar = 'lunas', jumlah_dp = total_bayar, sisa_bayar = 0
WHERE status_bayar IS NULL;

-- Tabel rincian pelunasan preorder (histori pembayaran sisa saat pelanggan
-- ambil pesanan) — terpisah dari transaksi_pembayaran (yang mencatat
-- pembayaran DP/lunas di muka saat transaksi dibuat) supaya jelas mana
-- pembayaran awal vs pelunasan belakangan, dan bisa dicatat >1 kali kalau
-- pelunasan dicicil.
CREATE TABLE IF NOT EXISTS transaksi_pelunasan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id INTEGER NOT NULL REFERENCES transaksi(id),
  jumlah REAL NOT NULL CHECK(jumlah > 0),
  metode_bayar TEXT NOT NULL CHECK(metode_bayar IN ('cash','transfer','qris','debit')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pelunasan_transaksi ON transaksi_pelunasan(transaksi_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_status_bayar ON transaksi(toko_id, status_bayar, is_preorder);
