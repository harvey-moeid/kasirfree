-- ==========================================================
-- Migration 0014 — Tambah shift_id ke transaksi_pelunasan
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0014_pelunasan_shift.sql
--
-- LATAR BELAKANG:
-- Cash dari pelunasan preorder (tabel transaksi_pelunasan) sebelumnya tidak
-- pernah dihitung dalam rekonsiliasi shift kasir, karena query kas shift hanya
-- membaca transaksi_pembayaran (yang mencatat pembayaran saat transaksi dibuat).
-- Akibatnya kasir yang menerima pelunasan cash di shift mereka akan selalu
-- punya selisih kas negatif — seolah kurang, padahal uangnya masuk lewat jalur
-- yang berbeda dan tidak terlacak.
--
-- FIX: tambah kolom shift_id ke transaksi_pelunasan. Saat POST
-- /api/preorder/:id/pelunasan diproses, shift aktif kasir yang login akan
-- direkam di sini — persis seperti yang dilakukan transaksi reguler.
-- Query kas shift di /api/shift/aktif dan /api/shift/tutup diperbarui
-- untuk ikut menjumlahkan cash dari tabel ini.
-- ==========================================================

ALTER TABLE transaksi_pelunasan ADD COLUMN shift_id INTEGER REFERENCES shift_kasir(id);

CREATE INDEX IF NOT EXISTS idx_pelunasan_shift ON transaksi_pelunasan(shift_id);
