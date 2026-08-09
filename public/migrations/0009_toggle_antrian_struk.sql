-- ==========================================================
-- Migration 0009 — Opsi tampilkan/sembunyikan nomor antrian di struk
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0009_toggle_antrian_struk.sql
-- ==========================================================

INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_tampilkan_antrian', '1');
