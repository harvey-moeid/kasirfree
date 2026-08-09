-- ==========================================================
-- Migration 0004 — Log Aktivitas Admin (audit trail CRUD)
-- Mencatat siapa melakukan apa terhadap produk, user, toko,
-- kategori, dan pembatalan transaksi. Terpisah dari riwayat_stok
-- (yang khusus mutasi stok) supaya query-nya tetap ringan dan
-- fokus per keperluan masing-masing.
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0004_log_aktivitas.sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS log_aktivitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  username TEXT NOT NULL,
  toko_id INTEGER REFERENCES toko(id),
  aksi TEXT NOT NULL,      -- 'tambah' | 'ubah' | 'nonaktifkan' | 'batalkan'
  entitas TEXT NOT NULL,   -- 'produk' | 'user' | 'toko' | 'kategori' | 'transaksi'
  entitas_id INTEGER,
  keterangan TEXT,         -- deskripsi human-readable, mis. "Harga jual: Rp3.500 -> Rp4.000"
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_log_aktivitas_toko_waktu ON log_aktivitas(toko_id, created_at);
CREATE INDEX IF NOT EXISTS idx_log_aktivitas_user ON log_aktivitas(user_id);
