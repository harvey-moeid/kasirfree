// ==========================================================
// local-db.js — Database SQLite yang jalan 100% di browser (sql.js /
// WASM), datanya disimpan di IndexedDB HP ini saja. Ini pengganti
// Cloudflare D1: skema tabelnya PERSIS sama (pakai file migrations/*.sql
// yang sama), tapi tidak ada server/koneksi jaringan sama sekali.
//
// Beda HP = beda IndexedDB = beda isi database. Sesuai permintaan:
// "full lokal database, beda hp beda data".
// ==========================================================

(function () {
const { idbGet, idbSet } = window.IdbHelper;

const MIGRATION_FILES = [
  '0001_init.sql',
  '0002_split_payment.sql',
  '0003_shift_kasir.sql',
  '0004_log_aktivitas.sql',
  '0005_pengaturan.sql',
  '0006_martabak.sql',
  '0007_fitur_lanjutan.sql',
  '0008_kustomisasi_struk.sql',
  '0009_toggle_antrian_struk.sql',
  '0010_alasan_batal.sql',
  '0011_batal_per_item.sql',
  '0012_status_bayar_preorder.sql',
  '0013_kasir_toko.sql',
  '0014_pelunasan_shift.sql',
];

const DB_FILE_KEY = 'sqlite_db_v1';

class LocalD1Stmt {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
    this._params = [];
  }
  bind(...args) {
    this._params = args;
    return this;
  }
  async first() {
    return this._db._first(this._sql, this._params);
  }
  async all() {
    return this._db._all(this._sql, this._params);
  }
  async run() {
    return this._db._run(this._sql, this._params);
  }
}

class LocalD1 {
  constructor(sqlJsDb) {
    this.sqlDb = sqlJsDb;
    this._saveTimer = null;
  }

  prepare(sql) {
    return new LocalD1Stmt(this, sql);
  }

  async batch(stmts) {
    const results = [];
    this.sqlDb.run('BEGIN');
    try {
      for (const s of stmts) {
        results.push(this._runNoTx(s._sql, s._params));
      }
      this.sqlDb.run('COMMIT');
    } catch (err) {
      try { this.sqlDb.run('ROLLBACK'); } catch (_) {}
      throw err;
    }
    this._scheduleSave();
    return results;
  }

  _first(sql, params) {
    const stmt = this.sqlDb.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return null;
    } finally {
      stmt.free();
    }
  }

  _all(sql, params) {
    const stmt = this.sqlDb.prepare(sql);
    const results = [];
    try {
      stmt.bind(params);
      while (stmt.step()) results.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return { results };
  }

  _runNoTx(sql, params) {
    this.sqlDb.run(sql, params);
    const idRow = this.sqlDb.exec('SELECT last_insert_rowid() AS id');
    const lastId = idRow.length ? idRow[0].values[0][0] : null;
    const changes = this.sqlDb.getRowsModified();
    return { success: true, meta: { last_row_id: lastId, changes, rows_written: changes } };
  }

  _run(sql, params) {
    const res = this._runNoTx(sql, params);
    this._scheduleSave();
    return res;
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 400);
  }

  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const bytes = this.sqlDb.export();
    await idbSet('files', DB_FILE_KEY, bytes);
  }

  exportBinary() {
    return this.sqlDb.export();
  }
}

async function fetchText(url) {
  const absUrl = new URL(url, window.location.origin).href;
  const res = await fetch(absUrl);
  if (!res.ok) throw new Error('Gagal memuat ' + url);
  return res.text();
}

/**
 * Terapkan migration yang belum dijalankan ke rawDb (sql.js Database).
 *
 * Versi DB dilacak via SQLite PRAGMA user_version (integer di header file DB,
 * tidak butuh tabel tambahan). Setiap migration yang berhasil menaikkan
 * user_version sebesar 1, sehingga startup berikutnya tahu mulai dari mana.
 *
 * Masalah transisi: DB lama yang dibuat sebelum sistem ini ada tidak punya
 * user_version (= 0). Supaya migration 0001-0013 tidak diulang (dan gagal
 * karena tabel sudah ada), kita deteksi keberadaan tabel 'transaksi':
 *   - Tabel ada  → DB lama → anggap sudah di versi 13, set user_version = 13
 *   - Tabel tidak ada → DB benar-benar baru → jalankan semua dari awal
 *
 * Tiap migration dijalankan dalam transaksi eksplisit (BEGIN/COMMIT) supaya
 * jika satu migration gagal di tengah jalan, DB tidak tertinggal dalam
 * keadaan setengah-setengah.
 *
 * @returns {{ isFreshInstall: boolean }}
 */
async function applyMigrations(rawDb) {
  // Baca versi migration saat ini dari header DB
  let currentVersion = 0;
  try {
    const rows = rawDb.exec('PRAGMA user_version');
    currentVersion = rows[0]?.values[0][0] ?? 0;
  } catch (_) { /* db baru, user_version belum ada */ }

  // Deteksi DB lama vs benar-benar baru
  let isFreshInstall = false;
  if (currentVersion === 0) {
    const tableRows = rawDb.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='transaksi'"
    );
    const hasTransaksi = tableRows.length > 0 && tableRows[0]?.values?.length > 0;
    if (hasTransaksi) {
      // DB sudah jalan sebelum version tracking ditambahkan — skip 0001-0013
      currentVersion = 13;
      rawDb.run('PRAGMA user_version = 13');
    } else {
      isFreshInstall = true; // DB kosong, jalankan semua migration
    }
  }

  // Jalankan migration yang belum diaplikasikan
  for (let i = currentVersion; i < MIGRATION_FILES.length; i++) {
    const sql = await fetchText('/migrations/' + MIGRATION_FILES[i]);
    rawDb.run('BEGIN');
    try {
      rawDb.run(sql);
      rawDb.run('COMMIT');
      // Set user_version setelah COMMIT agar tahan crash (kalau crash antara
      // COMMIT dan PRAGMA, migration sudah apply tapi version belum naik —
      // migration akan dicoba ulang saat startup berikutnya; migration perlu
      // idempotent atau handler error di atas perlu menangani ini).
      rawDb.run(`PRAGMA user_version = ${i + 1}`);
    } catch (err) {
      try { rawDb.run('ROLLBACK'); } catch (_) {}
      console.error(`Migration ${MIGRATION_FILES[i]} gagal:`, err);
      throw new Error(`Gagal menerapkan migration ${MIGRATION_FILES[i]}: ${err.message}`);
    }
  }

  return { isFreshInstall };
}

async function initLocalDb() {
  const SQL = await initSqlJs({ locateFile: (file) => new URL('/js/vendor/' + file, window.location.origin).href });

  const saved = await idbGet('files', DB_FILE_KEY);
  let rawSqlDb;

  if (saved) {
    try {
      rawSqlDb = new SQL.Database(new Uint8Array(saved));
    } catch (err) {
      console.error('Database tersimpan rusak, membuat baru:', err);
      rawSqlDb = new SQL.Database();
    }
  } else {
    rawSqlDb = new SQL.Database();
  }

  // Terapkan semua migration yang belum dijalankan (termasuk upgrade untuk
  // DB lama yang baru pertama kali melewati sistem version tracking ini).
  const { isFreshInstall } = await applyMigrations(rawSqlDb);

  // Migration 0001 membuat 2 akun demo (admin/kasir1) dengan password yang
  // ada di riwayat kode publik — hapus hanya untuk instalasi BARU supaya
  // user lama tidak kehilangan akunnya saat upgrade.
  if (isFreshInstall) {
    rawSqlDb.run('DELETE FROM users;');
  }

  const localD1 = new LocalD1(rawSqlDb);
  await localD1.flush(); // pastikan langsung tersimpan setelah instalasi/upgrade
  window.LocalDB = localD1;

  // Minta browser JANGAN menghapus IndexedDB kita otomatis saat storage
  // perangkat menipis ("best-effort" eviction Chrome/Android WebView bisa
  // membuang data PWA yang jarang dibuka tanpa peringatan). persist() tidak
  // menjamin 100% (browser tetap bisa menolak diam-diam), tapi jauh
  // mengurangi risiko dibanding tidak minta sama sekali. Aman di-skip kalau
  // API tidak didukung (mis. build APK/Capacitor WebView lama).
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch (_) { /* best-effort, gagal diam-diam tidak fatal */ }

  // Simpan biar bisa flush cepat sebelum halaman ditutup/di-background-kan
  // (mis. kasir mengunci layar HP tepat setelah transaksi tersimpan).
  const flushNow = () => { localD1.flush(); };
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });

  return localD1;
}

window.LocalDBReady = initLocalDb();

})();
