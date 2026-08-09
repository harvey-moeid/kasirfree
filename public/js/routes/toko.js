import { Hono } from '../mini-hono.js';
import { requireAuth, requireRole } from '../local-auth-middleware.js';
import { catatLog } from '../lib/helpers.js';

const tokoRoutes = new Hono();

// ==========================================================
// 4b. ROUTES: TOKO & KATEGORI (untuk dropdown form admin)
// ==========================================================
tokoRoutes.get('/api/toko', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    if (session.role === 'super_admin') {
        const { results } = await db.prepare('SELECT * FROM toko ORDER BY nama ASC').all();
        return c.json({ success: true, data: results });
    }
    // admin_toko & kasir hanya lihat toko miliknya sendiri
    const toko = await db.prepare('SELECT * FROM toko WHERE id = ?').bind(session.toko_id).first();
    return c.json({ success: true, data: toko ? [toko] : [] });
});
tokoRoutes.post('/api/toko', requireAuth, requireRole('super_admin'), async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const { nama, alamat } = await c.req.json();
        if (!nama)
            return c.json({ success: false, error: 'nama toko wajib diisi' }, 400);
        const result = await db.prepare('INSERT INTO toko (nama, alamat) VALUES (?, ?)').bind(nama, alamat ?? null).run();
        await catatLog(db, session, 'tambah', 'toko', result.meta.last_row_id, `Menambah toko "${nama}"`);
        return c.json({ success: true, id: result.meta.last_row_id }, 201);
    }
    catch {
        return c.json({ success: false, error: 'Gagal menambah toko' }, 400);
    }
});
// FIX: sebelumnya hanya ada create (POST) toko, tidak ada endpoint untuk
// mengubah nama/alamat toko yang sudah ada — jadi nama toko tidak bisa
// diedit dari panel admin sama sekali. Ditambahkan PUT di sini.
tokoRoutes.put('/api/toko/:id', requireAuth, requireRole('super_admin'), async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const id = c.req.param('id');
        const { nama, alamat } = await c.req.json();
        if (!nama || !String(nama).trim()) {
            return c.json({ success: false, error: 'nama toko wajib diisi' }, 400);
        }
        const tokoLama = await db.prepare('SELECT nama FROM toko WHERE id = ?').bind(id).first();
        if (!tokoLama)
            return c.json({ success: false, error: 'Toko tidak ditemukan' }, 404);
        await db.prepare('UPDATE toko SET nama = ?, alamat = ? WHERE id = ?').bind(String(nama).trim(), alamat ?? null, id).run();
        await catatLog(db, session, 'ubah', 'toko', id, `Mengubah toko "${tokoLama.nama}" menjadi "${String(nama).trim()}"`);
        return c.json({ success: true });
    }
    catch {
        return c.json({ success: false, error: 'Gagal mengubah toko' }, 400);
    }
});

export default tokoRoutes;
