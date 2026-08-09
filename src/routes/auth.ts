import { Hono } from 'hono';
import { requireAuth, type AppEnv } from '../lib/auth-middleware';
import { setCookie, deleteCookie } from 'hono/cookie';
import { hashPassword, verifyPassword, signToken } from '../lib/crypto';
import { SESSION_COOKIE } from '../lib/auth-middleware';

const authRoutes = new Hono<AppEnv>();

authRoutes.post('/api/auth/login', async (c) => {
  try {
    const { username, password } = await c.req.json<{ username?: string; password?: string }>();
    if (!username || !password) {
      return c.json({ success: false, error: 'Username dan password wajib diisi' }, 400);
    }

    const db = c.env.DB;
    const user = await db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .bind(username)
      .first<any>();

    // Selalu jalankan verifyPassword walau user tidak ditemukan (dummy hash+salt)
    // agar waktu respons konsisten dan tidak membocorkan apakah username valid (timing attack).
    const isValid = user
      ? await verifyPassword(password, user.password_hash, user.password_salt)
      : await verifyPassword(password, '', 'AAAAAAAAAAAAAAAAAAAAAA==');

    if (!user || !isValid) {
      return c.json({ success: false, error: 'Username atau password salah' }, 401);
    }

    const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60; // 8 jam, sesuai shift kasir
    const token = await signToken(
      { uid: user.id, role: user.role, toko_id: user.toko_id ?? null, exp },
      c.env.JWT_SECRET
    );

    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 8 * 60 * 60,
    });

    return c.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nama: user.nama_lengkap,
        role: user.role,
        toko_id: user.toko_id,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: 'Kesalahan server internal' }, 500);
  }
});

authRoutes.post('/api/auth/logout', async (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ success: true });
});

authRoutes.get('/api/auth/me', requireAuth, async (c) => {
  const session = c.get('session');
  const db = c.env.DB;
  const user = await db
    .prepare('SELECT id, username, nama_lengkap, role, toko_id FROM users WHERE id = ? AND is_active = 1')
    .bind(session.uid)
    .first<any>();

  if (!user) return c.json({ success: false, error: 'User tidak ditemukan' }, 404);
  return c.json({ success: true, user });
});

// Ganti password sendiri (butuh password lama) — beda dari reset password oleh
// admin lewat PUT /api/users/:id yang tidak perlu tahu password lama.
authRoutes.post('/api/auth/change-password', requireAuth, async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const { password_lama, password_baru } = await c.req.json<{ password_lama?: string; password_baru?: string }>();

    if (!password_lama || !password_baru) {
      return c.json({ success: false, error: 'Password lama dan password baru wajib diisi' }, 400);
    }
    if (String(password_baru).length < 6) {
      return c.json({ success: false, error: 'Password baru minimal 6 karakter' }, 400);
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(session.uid).first<any>();
    if (!user) return c.json({ success: false, error: 'User tidak ditemukan' }, 404);

    const valid = await verifyPassword(password_lama, user.password_hash, user.password_salt);
    if (!valid) return c.json({ success: false, error: 'Password lama salah' }, 401);

    const { hash, salt } = await hashPassword(password_baru);
    await db
      .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .bind(hash, salt, session.uid)
      .run();

    return c.json({ success: true });
  } catch {
    return c.json({ success: false, error: 'Gagal mengubah password' }, 500);
  }
});

export default authRoutes;
