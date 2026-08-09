import { Hono } from '../mini-hono.js';
import { requireAuth } from '../local-auth-middleware.js';
import { hashPassword, verifyPassword } from '../crypto.js';

const authRoutes = new Hono();

authRoutes.post('/api/auth/setup', async (c) => {
    try {
        const db = c.env.DB;
        // Cek server-side (bukan cuma percaya client) — endpoint ini CUMA
        // boleh dipakai sekali, saat instalasi masih benar-benar kosong.
        // Mencegah orang lain memakai endpoint ini belakangan untuk bikin
        // akun super_admin tambahan tanpa lewat proteksi role Kelola User.
        const already = await db.prepare('SELECT id FROM users LIMIT 1').first();
        if (already) {
            return c.json({ success: false, error: 'Setup awal sudah pernah dilakukan. Silakan login.' }, 409);
        }
        const { nama_toko, nama_lengkap, username, password } = await c.req.json();
        if (!nama_toko?.trim() || !nama_lengkap?.trim() || !username?.trim() || !password) {
            return c.json({ success: false, error: 'Semua kolom wajib diisi' }, 400);
        }
        if (password.length < 6) {
            return c.json({ success: false, error: 'Password minimal 6 karakter' }, 400);
        }
        if (!/^[a-zA-Z0-9_.]{3,32}$/.test(username.trim())) {
            return c.json({ success: false, error: 'Username 3-32 karakter, hanya huruf/angka/titik/underscore' }, 400);
        }

        const { hash, salt } = await hashPassword(password);
        const result = await db
            .prepare(
                `INSERT INTO users (username, password_hash, password_salt, nama_lengkap, role, toko_id)
                 VALUES (?, ?, ?, ?, 'super_admin', 1)`
            )
            .bind(username.trim(), hash, salt, nama_lengkap.trim())
            .run();

        // Toko id=1 sudah pasti ada (diseed lewat migration saat DB pertama
        // dibuat, lihat local-db.js/buildFreshDatabase) — di sini cuma
        // diganti namanya sesuai isian pemilik toko.
        await db.prepare('UPDATE toko SET nama = ? WHERE id = 1').bind(nama_toko.trim()).run();
        await db
            .prepare(
                `INSERT INTO pengaturan (key, value) VALUES ('app_title', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
            )
            .bind(nama_toko.trim())
            .run();

        const userId = result.meta.last_row_id;
        await window.LocalAuth.markUnlocked({ uid: userId, role: 'super_admin', toko_id: 1 });

        return c.json({
            success: true,
            user: { id: userId, username: username.trim(), nama: nama_lengkap.trim(), role: 'super_admin', toko_id: 1 },
        });
    }
    catch (err) {
        console.error('Gagal setup awal:', err);
        return c.json({ success: false, error: 'Kesalahan server internal' }, 500);
    }
});
authRoutes.post('/api/auth/login', async (c) => {
    try {
        const { username, password } = await c.req.json();
        if (!username || !password) {
            return c.json({ success: false, error: 'Username dan password wajib diisi' }, 400);
        }
        const db = c.env.DB;
        const user = await db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').bind(username).first();
        // Tetap jalankan verifyPassword walau user tidak ditemukan (dengan hash
        // dummy) supaya waktu respons login-gagal-karena-username-salah dan
        // login-gagal-karena-password-salah TIDAK bisa dibedakan dari luar —
        // mencegah orang menebak-nebak username mana saja yang valid.
        const isValid = user
            ? await verifyPassword(password, user.password_hash, user.password_salt)
            : await verifyPassword(password, '', 'AAAAAAAAAAAAAAAAAAAAAA==');
        if (!user || !isValid) {
            return c.json({ success: false, error: 'Username atau password salah' }, 401);
        }
        await window.LocalAuth.markUnlocked({
            uid: user.id,
            role: user.role,
            toko_id: user.toko_id ?? null,
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
    }
    catch (err) {
        return c.json({ success: false, error: 'Kesalahan server internal' }, 500);
    }
});
authRoutes.post('/api/auth/logout', async (c) => {
    window.LocalAuth.lock();
    return c.json({ success: true });
});
authRoutes.get('/api/auth/me', requireAuth, async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const user = await db
        .prepare('SELECT id, username, nama_lengkap, role, toko_id FROM users WHERE id = ? AND is_active = 1')
        .bind(session.uid)
        .first();
    if (!user)
        return c.json({ success: false, error: 'User tidak ditemukan' }, 404);
    return c.json({ success: true, user });
});
// Ganti password sendiri (butuh password lama) — beda dari reset password oleh
// admin lewat PUT /api/users/:id yang tidak perlu tahu password lama.
authRoutes.post('/api/auth/change-password', requireAuth, async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const { password_lama, password_baru } = await c.req.json();
        if (!password_lama || !password_baru) {
            return c.json({ success: false, error: 'Password lama dan password baru wajib diisi' }, 400);
        }
        if (String(password_baru).length < 6) {
            return c.json({ success: false, error: 'Password baru minimal 6 karakter' }, 400);
        }
        const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(session.uid).first();
        if (!user)
            return c.json({ success: false, error: 'User tidak ditemukan' }, 404);
        const valid = await verifyPassword(password_lama, user.password_hash, user.password_salt);
        if (!valid)
            return c.json({ success: false, error: 'Password lama salah' }, 401);
        const { hash, salt } = await hashPassword(password_baru);
        await db
            .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
            .bind(hash, salt, session.uid)
            .run();
        return c.json({ success: true });
    }
    catch {
        return c.json({ success: false, error: 'Gagal mengubah password' }, 500);
    }
});

export default authRoutes;
