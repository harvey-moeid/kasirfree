import { Hono } from '../mini-hono.js';
import { requireAuth, requireRole } from '../local-auth-middleware.js';
import { hashPassword } from '../crypto.js';
import { catatLog } from '../lib/helpers.js';

const usersRoutes = new Hono();

// ==========================================================
// 7. ROUTES: USERS (admin only)
// ==========================================================
usersRoutes.get('/api/users', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    let sql = 'SELECT id, username, nama_lengkap, role, toko_id, is_active FROM users WHERE 1=1';
    const params = [];
    if (session.role === 'admin_toko') {
        sql += " AND toko_id = ? AND role = 'kasir'";
        params.push(session.toko_id);
    }
    sql += ' ORDER BY nama_lengkap ASC';
    const { results } = await db.prepare(sql).bind(...params).all();
    return c.json({ success: true, data: results });
});
usersRoutes.post('/api/users', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const body = await c.req.json();
        if (!body.username || !body.password || !body.nama_lengkap) {
            return c.json({ success: false, error: 'username, password, dan nama_lengkap wajib diisi' }, 400);
        }
        // FIX: aturan "minimal 6 karakter" sebelumnya cuma dicek di JS admin.html
        // (gampang dilewati lewat panggilan API langsung) — endpoint self-service
        // /api/auth/change-password sudah benar mengecek ini di server, tapi
        // pembuatan user oleh admin belum. Samakan aturannya di sini.
        if (String(body.password).length < 6) {
            return c.json({ success: false, error: 'Password minimal 6 karakter' }, 400);
        }
        // admin_toko hanya boleh membuat kasir di tokonya sendiri
        const role = session.role === 'admin_toko' ? 'kasir' : body.role ?? 'kasir';
        const toko_id = body.toko_id ?? session.toko_id;
        const { hash, salt } = await hashPassword(body.password);
        const result = await db
            .prepare(`INSERT INTO users (username, password_hash, password_salt, nama_lengkap, role, toko_id)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(body.username, hash, salt, body.nama_lengkap, role, toko_id ?? null)
            .run();
        await catatLog(db, session, 'tambah', 'user', result.meta.last_row_id, `Menambah user "${body.username}" (${body.nama_lengkap}), role ${role}`);
        return c.json({ success: true, id: result.meta.last_row_id }, 201);
    }
    catch (err) {
        const msg = String(err.message ?? '').includes('UNIQUE') ? 'Username sudah dipakai' : 'Gagal menambah user';
        return c.json({ success: false, error: msg }, 400);
    }
});
usersRoutes.put('/api/users/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const id = c.req.param('id');
        const body = await c.req.json();
        const userLama = await db.prepare('SELECT username, nama_lengkap, role, toko_id, is_active FROM users WHERE id = ?').bind(id).first();
        if (!userLama)
            return c.json({ success: false, error: 'User tidak ditemukan' }, 404);
        // FIX (security): admin_toko HANYA boleh mengubah akun kasir di tokonya
        // sendiri — sebelumnya endpoint ini tidak mengecek kepemilikan toko sama
        // sekali, jadi admin_toko manapun bisa reset password / menonaktifkan
        // AKUN SIAPA PUN di seluruh sistem (termasuk super_admin/admin_toko toko
        // lain), yang berarti privilege escalation penuh. Konsisten dengan batas
        // yang sudah berlaku di POST /api/users (admin_toko hanya bisa membuat
        // kasir di tokonya sendiri).
        if (session.role === 'admin_toko' && (userLama.role !== 'kasir' || userLama.toko_id !== session.toko_id)) {
            return c.json({ success: false, error: 'Anda tidak memiliki akses untuk mengubah user ini' }, 403);
        }
        const finalIsActive = body.is_active === undefined || body.is_active === null ? 1 : Number(body.is_active) ? 1 : 0;
        // Proteksi: endpoint ini tidak bisa mengubah role (lihat query di bawah),
        // tapi BISA menonaktifkan akun. Kalau target adalah super_admin dan
        // hasilnya akan dinonaktifkan, pastikan masih ada super_admin aktif LAIN
        // yang tersisa — supaya panel admin tidak pernah terkunci total (tidak
        // ada satu pun yang bisa login sebagai super_admin untuk memperbaikinya).
        if (userLama.role === 'super_admin' && finalIsActive === 0) {
            const { c: jumlahSuperAdminLain } = (await db
                .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?")
                .bind(id)
                .first()) ?? { c: 0 };
            if (jumlahSuperAdminLain === 0) {
                return c.json({ success: false, error: 'Tidak bisa menonaktifkan super_admin ini — minimal harus ada 1 super_admin aktif tersisa.' }, 400);
            }
        }
        if (body.password) {
            // FIX: sama seperti POST /api/users — aturan "minimal 6 karakter"
            // sebelumnya cuma dicek di JS admin.html, tidak sama sekali di server.
            if (String(body.password).length < 6) {
                return c.json({ success: false, error: 'Password minimal 6 karakter' }, 400);
            }
            const { hash, salt } = await hashPassword(body.password);
            await db
                .prepare('UPDATE users SET nama_lengkap = ?, is_active = ?, password_hash = ?, password_salt = ? WHERE id = ?')
                .bind(body.nama_lengkap, finalIsActive, hash, salt, id)
                .run();
        }
        else {
            await db
                .prepare('UPDATE users SET nama_lengkap = ?, is_active = ? WHERE id = ?')
                .bind(body.nama_lengkap, finalIsActive, id)
                .run();
        }
        // Log spesifik: status aktif/nonaktif berubah dan/atau password direset —
        // dua hal ini paling sensitif untuk diaudit dibanding sekadar ganti nama.
        const catatan = [];
        if (Number(userLama.is_active) !== finalIsActive) {
            catatan.push(finalIsActive ? 'mengaktifkan kembali akun' : 'menonaktifkan akun');
        }
        if (body.password)
            catatan.push('reset password');
        if (catatan.length === 0)
            catatan.push('ubah data profil');
        await catatLog(db, session, catatan.some((x) => x.includes('nonaktifkan')) ? 'nonaktifkan' : 'ubah', 'user', id, `User "${userLama.username}": ${catatan.join(', ')}`);
        return c.json({ success: true });
    }
    catch (err) {
        return c.json({ success: false, error: 'Gagal mengubah user' }, 400);
    }
});

export default usersRoutes;
