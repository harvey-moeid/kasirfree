-- ==========================================================
-- Migration 0010 — Alasan pembatalan transaksi (akuntabilitas)
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0010_alasan_batal.sql
-- ==========================================================

ALTER TABLE transaksi ADD COLUMN alasan_batal TEXT;
