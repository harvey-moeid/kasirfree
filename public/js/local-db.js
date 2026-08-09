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

async function buildFreshDatabase(SQL) {
  const db = new SQL.Database();
  for (const file of MIGRATION_FILES) {
    const sql = await fetchText('/migrations/' + file);
    db.run(sql);
  }
  // Migration 0013 sudah membersihkan produk/kategori/bahan-baku demo &
  // mengganti nama toko jadi "muidsoft" secara default. Yang masih
  // tersisa & PERLU dibersihkan untuk instalasi lokal baru: 2 akun demo
  // (admin/kasir1) dari migration 0001 — kredensialnya publik/diketahui
  // (ada di riwayat kode), jadi tidak aman dipakai apa adanya. Akun
  // sesungguhnya (1 password) dibuat oleh local-app.js saat pertama kali
  // dipakai.
  db.run('DELETE FROM users;');
  return db;
}

async function initLocalDb() {
  const SQL = await initSqlJs({ locateFile: (file) => new URL('/js/vendor/' + file, window.location.origin).href });

  const saved = await idbGet('files', DB_FILE_KEY);
  let sqlJsDb;
  if (saved) {
    try {
      sqlJsDb = new SQL.Database(new Uint8Array(saved));
    } catch (err) {
      console.error('Database tersimpan rusak, membuat baru:', err);
      sqlJsDb = await buildFreshDatabase(SQL);
    }
  } else {
    sqlJsDb = await buildFreshDatabase(SQL);
  }

  const localD1 = new LocalD1(sqlJsDb);
  await localD1.flush(); // pastikan langsung tersimpan setelah instalasi awal
  window.LocalDB = localD1;

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
