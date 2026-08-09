-- ==========================================================
-- Migration 0008 — Kustomisasi Struk (footer, catatan, lebar kertas, ikon/QR)
-- Jalankan: wrangler d1 execute umkm --file=./migrations/0008_kustomisasi_struk.sql
-- ==========================================================
-- Disimpan di tabel `pengaturan` (key/value) yang sudah ada sejak migrasi
-- 0005, supaya tidak perlu tabel baru & bisa diubah dari panel admin tanpa
-- redeploy. struk_footer_ikon: 'tidak' (default) | 'qr' (QR code asli yang
-- bisa di-scan, mis. link WhatsApp/Instagram/website toko) | 'judul' (nama
-- toko/aplikasi ditampilkan sebagai teks besar, mirip logo teks).
-- ==========================================================

INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_footer', 'Terima kasih atas kunjungan Anda');
INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_catatan', '');
INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_lebar_kertas', '58');
INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_tampilkan_alamat', '1');
INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_footer_ikon', 'tidak');
INSERT OR IGNORE INTO pengaturan (key, value) VALUES ('struk_qr_data', '');
