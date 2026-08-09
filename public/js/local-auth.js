// ==========================================================
// local-auth.js — Sistem login lokal (tanpa cookie/JWT/server). Status
// "sedang login" hanya hidup di sessionStorage tab browser ini (hilang
// otomatis kalau tab/aplikasi ditutup) — tidak pernah dikirim ke mana pun
// karena memang tidak ada server untuk dikirimi.
// Mendukung BANYAK akun per HP dengan role beneran (super_admin/
// admin_toko/kasir, sama seperti versi cloud) — kelola lewat menu
// Admin → Kelola User. Akun PERTAMA (super_admin) dibuat lewat wizard
// "Setup Awal" di halaman login (lihat routes/auth.js `POST
// /api/auth/setup` + pages/login-app.js) — BUKAN password bawaan yang
// sama di semua instalasi, supaya tidak ada celah "lupa ganti password
// default" yang bisa dieksploitasi siapa saja yang baca dokumentasi ini.
// ==========================================================

const SESSION_KEY = 'kasir_local_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam

class LocalAuthManager {
  isUnlocked() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data.exp || data.exp < Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async getSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return { uid: data.uid, role: data.role, toko_id: data.toko_id, exp: data.exp };
    } catch {
      return null;
    }
  }

  async markUnlocked(session) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...session, exp: Date.now() + SESSION_TTL_MS })
    );
  }

  lock() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /** True kalau belum ada akun sama sekali di HP ini (instalasi baru,
   * wizard "Setup Awal" perlu ditampilkan alih-alih layar login biasa). */
  async needsSetup() {
    const db = window.LocalDB;
    const existing = await db.prepare('SELECT id FROM users LIMIT 1').first();
    return !existing;
  }
}

window.LocalAuth = new LocalAuthManager();
