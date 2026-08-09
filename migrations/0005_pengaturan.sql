-- ==========================================================
-- Migration 0005 — Pengaturan aplikasi global (key/value)
-- Dipakai untuk judul aplikasi ("KASIR CLOUD") yang sekarang
-- bisa diubah lewat panel admin, tanpa perlu redeploy.
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0005_pengaturan.sql
-- ==========================================================

CREATE TABLE IF NOT EXISTS pengaturan (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('app_title', 'KASIR CLOUD');
