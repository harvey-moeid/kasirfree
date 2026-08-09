-- ==========================================================
-- Migration 0002 — Split Payment (bayar dengan >1 metode dalam
-- satu transaksi, mis. sebagian cash + sebagian QRIS) & audit
-- trail rinciannya per metode.
-- Jalankan: wrangler d1 execute pos_db --file=./migrations/0002_split_payment.sql
-- ==========================================================

-- SQLite tidak mendukung ALTER TABLE untuk mengubah CHECK constraint,
-- jadi tabel `transaksi` dibangun ulang dengan constraint metode_bayar
-- yang menambahkan nilai 'split' (dipakai saat >1 metode dipakai).
-- Data lama disalin apa adanya; id, offline_uuid, dan seluruh foreign key
-- dari detail_transaksi/riwayat_stok tetap valid karena id tidak berubah.

PRAGMA foreign_keys = OFF;

CREATE TABLE transaksi_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_transaksi TEXT UNIQUE NOT NULL,
  toko_id INTEGER NOT NULL REFERENCES toko(id),
  kasir_id INTEGER NOT NULL REFERENCES users(id),
  total_belanja REAL NOT NULL,
  diskon REAL DEFAULT 0,
  pajak REAL DEFAULT 0,
  total_bayar REAL NOT NULL,
  metode_bayar TEXT CHECK(metode_bayar IN ('cash','transfer','qris','debit','split')),
  uang_diterima REAL,
  kembalian REAL DEFAULT 0,
  status TEXT DEFAULT 'selesai' CHECK(status IN ('selesai','dibatalkan')),
  offline_uuid TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO transaksi_new
  (id, kode_transaksi, toko_id, kasir_id, total_belanja, diskon, pajak,
   total_bayar, metode_bayar, uang_diterima, kembalian, status, offline_uuid, created_at)
SELECT
  id, kode_transaksi, toko_id, kasir_id, total_belanja, diskon, pajak,
  total_bayar, metode_bayar, uang_diterima, kembalian, status, offline_uuid, created_at
FROM transaksi;

DROP TABLE transaksi;
ALTER TABLE transaksi_new RENAME TO transaksi;

CREATE INDEX IF NOT EXISTS idx_transaksi_toko_tanggal ON transaksi(toko_id, created_at);

PRAGMA foreign_keys = ON;

-- ==========================================================
-- Rincian pembayaran per metode (1 baris per metode yang dipakai).
-- Untuk transaksi single-method, tetap 1 baris di sini — supaya
-- laporan/rekap metode bayar konsisten satu sumber data.
-- ==========================================================
CREATE TABLE IF NOT EXISTS transaksi_pembayaran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id INTEGER NOT NULL REFERENCES transaksi(id),
  metode_bayar TEXT NOT NULL CHECK(metode_bayar IN ('cash','transfer','qris','debit')),
  jumlah REAL NOT NULL CHECK(jumlah > 0),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pembayaran_transaksi ON transaksi_pembayaran(transaksi_id);

-- Backfill: transaksi lama (sebelum migrasi ini) belum punya baris di
-- transaksi_pembayaran. Isi otomatis dari kolom metode_bayar/uang_diterima
-- yang sudah ada, supaya laporan rekap metode bayar tetap lengkap untuk
-- data historis juga.
INSERT INTO transaksi_pembayaran (transaksi_id, metode_bayar, jumlah)
SELECT id, metode_bayar,
       CASE WHEN metode_bayar = 'cash' THEN COALESCE(uang_diterima, total_bayar) ELSE total_bayar END
FROM transaksi
WHERE metode_bayar IN ('cash','transfer','qris','debit')
  AND id NOT IN (SELECT transaksi_id FROM transaksi_pembayaran);
