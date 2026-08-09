import { Hono } from '../mini-hono.js';
import { requireAuth, requireRole } from '../local-auth-middleware.js';

const logAktivitasRoutes = new Hono();

// ==========================================================
// 7b. ROUTES: LOG AKTIVITAS (audit trail admin)
// ==========================================================
/**
 * Riwayat aksi admin (tambah/ubah/nonaktifkan produk & user, batalkan transaksi,
 * dll). admin_toko hanya lihat log tokonya sendiri; super_admin lihat semua
 * (opsional filter ?toko_id=). Ini terpisah dari riwayat_stok yang khusus
 * mutasi stok.
 */
logAktivitasRoutes.get('/api/log-aktivitas', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    const { entitas, dari, sampai } = c.req.query();
    let sql = 'SELECT * FROM log_aktivitas WHERE 1=1';
    const params = [];
    if (session.role !== 'super_admin') {
        sql += ' AND toko_id = ?';
        params.push(session.toko_id);
    }
    else {
        const tokoIdFilter = c.req.query('toko_id');
        if (tokoIdFilter) {
            sql += ' AND toko_id = ?';
            params.push(tokoIdFilter);
        }
    }
    if (entitas) {
        sql += ' AND entitas = ?';
        params.push(entitas);
    }
    if (dari) {
        sql += ' AND date(created_at) >= date(?)';
        params.push(dari);
    }
    if (sampai) {
        sql += ' AND date(created_at) <= date(?)';
        params.push(sampai);
    }
    sql += ' ORDER BY created_at DESC LIMIT 300';
    const { results } = await db.prepare(sql).bind(...params).all();
    return c.json({ success: true, data: results });
});

export default logAktivitasRoutes;
