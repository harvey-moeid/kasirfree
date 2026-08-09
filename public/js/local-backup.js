// ==========================================================
// local-backup.js — Ekspor SELURUH data (database + semua gambar produk)
// jadi satu file .json yang bisa diunduh, dan sebaliknya (pulihkan dari
// file itu). Ini satu-satunya cara memindahkan data ke HP lain, karena
// modenya sekarang full lokal (tidak ada server pusat yang menyimpan data).
// ==========================================================

const { toBase64, fromBase64 } = window.Base64Util;

async function exportBackup() {
  await window.LocalAppReady;
  await window.LocalDB.flush();
  const dbBytes = window.LocalDB.exportBinary();
  const images = await window.LocalImages.exportAll();

  const payload = {
    // PENTING: string ini adalah marker validasi internal, BUKAN teks
    // branding yang ditampilkan ke user — JANGAN diubah walau brand/nama
    // produk berganti, supaya file backup LAMA (dari sebelum rebrand)
    // tetap bisa di-restore. Lihat pengecekan yang sama persis di
    // importBackup() di bawah.
    app: 'kasir-harvey-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    dbBase64: toBase64(dbBytes),
    images,
  };

  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return window.FileSaver.save(blob, `backup-muidsoft-${stamp}.json`, 'application/json');
}

async function importBackup(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('File cadangan tidak valid (bukan JSON)');
  }
  if (!payload || payload.app !== 'kasir-harvey-local-backup' || !payload.dbBase64) {
    throw new Error('File ini bukan file cadangan muidsoft yang valid');
  }

  const dbBytes = fromBase64(payload.dbBase64);

  // Validasi cepat: pastikan bisa dibuka sebagai database SQLite sebelum menimpa apa pun.
  const SQL = await initSqlJs({ locateFile: (f) => new URL('/js/vendor/' + f, window.location.origin).href });
  try {
    const testDb = new SQL.Database(dbBytes);
    testDb.exec('SELECT COUNT(*) FROM produk');
    testDb.close();
  } catch (err) {
    throw new Error('File cadangan rusak atau tidak kompatibel: ' + err.message);
  }

  await window.IdbHelper.idbSet('files', 'sqlite_db_v1', dbBytes);
  if (Array.isArray(payload.images)) {
    await window.LocalImages.importAll(payload.images);
  }
}

window.LocalBackup = { exportBackup, importBackup };
