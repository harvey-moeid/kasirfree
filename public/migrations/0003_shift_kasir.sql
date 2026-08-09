-- ==========================================================
-- Migration 0003 — Shift Kasir (buka/tutup kas, rekonsiliasi kas fisik)
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0003_shift_kasir.sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS shift_kasir (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kasir_id INTEGER NOT NULL REFERENCES users(id),
  toko_id INTEGER NOT NULL REFERENCES toko(id),
  modal_awal REAL NOT NULL,
  kas_sistem_akhir REAL,     -- dihitung otomatis saat tutup shift: modal_awal + total tunai masuk selama shift
  kas_fisik_akhir REAL,      -- hasil hitung manual kasir saat tutup shift
  selisih REAL,              -- kas_fisik_akhir - kas_sistem_akhir (negatif = kurang, positif = lebih)
  catatan TEXT,              -- opsional: alasan selisih, dsb
  status TEXT NOT NULL DEFAULT 'buka' CHECK(status IN ('buka','tutup')),
  waktu_buka TEXT DEFAULT (datetime('now')),
  waktu_tutup TEXT
);

CREATE INDEX IF NOT EXISTS idx_shift_kasir_status ON shift_kasir(kasir_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_toko_waktu ON shift_kasir(toko_id, waktu_buka);

-- Setiap transaksi ditautkan ke shift yang sedang aktif saat itu, supaya kas
-- sistem per-shift bisa dihitung akurat (bukan cuma total harian per toko).
-- Nullable: transaksi lama sebelum fitur ini tidak punya shift, dan tetap
-- boleh ada transaksi tanpa shift (fallback) supaya tidak memblokir endpoint
-- lain yang mungkin dipakai admin_toko langsung.
ALTER TABLE transaksi ADD COLUMN shift_id INTEGER REFERENCES shift_kasir(id);

CREATE INDEX IF NOT EXISTS idx_transaksi_shift ON transaksi(shift_id);
