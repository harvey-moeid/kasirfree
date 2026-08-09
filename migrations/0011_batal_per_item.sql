-- ==========================================================
-- Migration 0011 — Batalkan per item (bukan cuma seluruh transaksi)
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0011_batal_per_item.sql
-- ==========================================================
-- is_batal di level detail_transaksi (bukan cuma transaksi.status) supaya
-- satu transaksi bisa punya sebagian item batal & sebagian tetap valid.
-- transaksi.status baru berubah jadi 'dibatalkan' kalau SEMUA item-nya
-- sudah is_batal=1 (lihat logic di POST /api/transaksi/:id/batalkan).

ALTER TABLE detail_transaksi ADD COLUMN is_batal INTEGER DEFAULT 0;
ALTER TABLE detail_transaksi ADD COLUMN alasan_batal TEXT;
