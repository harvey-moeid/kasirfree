import { Hono } from '../mini-hono.js';
import { requireAuth, requireRole } from '../local-auth-middleware.js';
import { hitungSplitPayment } from '../lib/helpers.js';

const shiftRoutes = new Hono();

// ==========================================================
// 4b. ROUTES: SHIFT KASIR (buka/tutup kas, rekonsiliasi)
// ==========================================================
/**
 * Buka shift baru. Ditolak kalau kasir yang login masih punya shift 'buka'
 * yang belum ditutup — mencegah 1 kasir punya 2 shift aktif bersamaan
 * (bikin perhitungan kas sistem ambigu).
 */
shiftRoutes.post('/api/shift/buka', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    try {
        const { modal_awal } = await c.req.json();
        const modalAwalNum = Number(modal_awal);
        if (!Number.isFinite(modalAwalNum) || modalAwalNum < 0) {
            return c.json({ success: false, error: 'Modal awal harus berupa angka >= 0' }, 400);
        }
        if (!session.toko_id) {
            return c.json({ success: false, error: 'Akun ini tidak terikat ke toko manapun' }, 400);
        }
        const existing = await db
            .prepare("SELECT id FROM shift_kasir WHERE kasir_id = ? AND status = 'buka'")
            .bind(session.uid)
            .first();
        if (existing) {
            return c.json({ success: false, error: 'Kamu masih punya shift yang belum ditutup. Tutup shift itu dulu.' }, 409);
        }
        const result = await db
            .prepare('INSERT INTO shift_kasir (kasir_id, toko_id, modal_awal) VALUES (?, ?, ?)')
            .bind(session.uid, session.toko_id, modalAwalNum)
            .run();
        const shift = await db.prepare('SELECT * FROM shift_kasir WHERE id = ?').bind(result.meta.last_row_id).first();
        return c.json({ success: true, data: shift }, 201);
    }
    catch {
        return c.json({ success: false, error: 'Gagal membuka shift' }, 400);
    }
});
/** Shift yang sedang aktif (status='buka') milik kasir yang login, kalau ada. */
shiftRoutes.get('/api/shift/aktif', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    const shift = await db
        .prepare("SELECT * FROM shift_kasir WHERE kasir_id = ? AND status = 'buka' ORDER BY id DESC LIMIT 1")
        .bind(session.uid)
        .first();
    if (!shift)
        return c.json({ success: true, data: null });
    // Total tunai yang sudah masuk sejauh ini di shift ini (buat ditampilkan
    // sebagai "perkiraan kas di laci" sebelum kasir menutup shift).
    //
    // PENTING: tp.jumlah untuk metode 'cash' adalah nominal yang DISERAHKAN
    // pelanggan (mis. bayar pakai uang Rp50.000 untuk tagihan Rp15.500), BUKAN
    // nominal yang benar-benar tersisa di laci setelah kembalian diberikan.
    // Kembalian HANYA pernah diambil dari cash (aturan bisnis di
    // hitungSplitPayment), jadi kas fisik bersih = total tunai diserahkan
    // dikurangi total kembalian yang sudah dikeluarkan sepanjang shift ini.
    // FIX: tambah cash dari transaksi_pelunasan (pelunasan preorder) ke
    // total_tunai_diterima. Sebelumnya hanya dihitung dari transaksi_pembayaran
    // sehingga kasir yang terima pelunasan cash selalu terlihat "kurang".
    const kasSaatIni = await db
        .prepare(`SELECT
         COALESCE((SELECT SUM(tp.jumlah) FROM transaksi_pembayaran tp
                    JOIN transaksi t ON t.id = tp.transaksi_id
                    WHERE t.shift_id = ? AND tp.metode_bayar = 'cash' AND t.status = 'selesai'), 0)
         + COALESCE((SELECT SUM(tpl.jumlah) FROM transaksi_pelunasan tpl
                    WHERE tpl.shift_id = ? AND tpl.metode_bayar = 'cash'), 0)
         as total_tunai_diterima,
         COALESCE((SELECT SUM(t.kembalian) FROM transaksi t
                    WHERE t.shift_id = ? AND t.status = 'selesai'), 0) as total_kembalian`)
        .bind(shift.id, shift.id, shift.id)
        .first();
    const netTunai = (kasSaatIni?.total_tunai_diterima ?? 0) - (kasSaatIni?.total_kembalian ?? 0);
    return c.json({
        success: true,
        data: { ...shift, perkiraan_kas_saat_ini: shift.modal_awal + netTunai },
    });
});
/**
 * Tutup shift aktif milik kasir yang login. Kas sistem dihitung otomatis dari
 * total pembayaran TUNAI (metode_bayar='cash' di transaksi_pembayaran) atas
 * transaksi yang tertaut ke shift ini — bukan dari total_bayar transaksi,
 * karena QRIS/debit/transfer tidak menambah uang fisik di laci kasir.
 */
shiftRoutes.post('/api/shift/tutup', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    try {
        const { kas_fisik_akhir, catatan } = await c.req.json();
        const kasFisikNum = Number(kas_fisik_akhir);
        if (!Number.isFinite(kasFisikNum) || kasFisikNum < 0) {
            return c.json({ success: false, error: 'Kas fisik akhir harus berupa angka >= 0' }, 400);
        }
        const shift = await db
            .prepare("SELECT * FROM shift_kasir WHERE kasir_id = ? AND status = 'buka' ORDER BY id DESC LIMIT 1")
            .bind(session.uid)
            .first();
        if (!shift) {
            return c.json({ success: false, error: 'Tidak ada shift aktif untuk ditutup' }, 404);
        }
        // PENTING: tp.jumlah untuk metode 'cash' adalah nominal yang DISERAHKAN
        // pelanggan, BUKAN nominal yang benar-benar tersisa di laci setelah
        // kembalian diberikan. Kembalian HANYA pernah diambil dari cash (aturan
        // bisnis di hitungSplitPayment), jadi kas fisik bersih = total tunai
        // diserahkan dikurangi total kembalian yang sudah dikeluarkan shift ini.
        // (Sebelum fix ini, kembalian sama sekali tidak dikurangi — kas sistem
        // akhir jadi jauh lebih besar dari kas fisik yang sesungguhnya ada.)
        // FIX: sama seperti /api/shift/aktif — tambah cash dari
        // transaksi_pelunasan supaya kas_sistem_akhir akurat untuk kasir
        // yang menerima pelunasan preorder cash di shift mereka.
        const rekap = await db
            .prepare(`SELECT
           COALESCE((SELECT SUM(tp.jumlah) FROM transaksi_pembayaran tp
                      JOIN transaksi t ON t.id = tp.transaksi_id
                      WHERE t.shift_id = ? AND tp.metode_bayar = 'cash' AND t.status = 'selesai'), 0)
           + COALESCE((SELECT SUM(tpl.jumlah) FROM transaksi_pelunasan tpl
                      WHERE tpl.shift_id = ? AND tpl.metode_bayar = 'cash'), 0)
           as total_tunai_diterima,
           COALESCE((SELECT SUM(t.kembalian) FROM transaksi t
                      WHERE t.shift_id = ? AND t.status = 'selesai'), 0) as total_kembalian`)
            .bind(shift.id, shift.id, shift.id)
            .first();
        const netTunai = (rekap?.total_tunai_diterima ?? 0) - (rekap?.total_kembalian ?? 0);
        const kasSistemAkhir = shift.modal_awal + netTunai;
        const selisih = Math.round((kasFisikNum - kasSistemAkhir) * 100) / 100;
        await db
            .prepare(`UPDATE shift_kasir
         SET status = 'tutup', waktu_tutup = datetime('now'),
             kas_sistem_akhir = ?, kas_fisik_akhir = ?, selisih = ?, catatan = ?
         WHERE id = ?`)
            .bind(kasSistemAkhir, kasFisikNum, selisih, catatan ?? null, shift.id)
            .run();
        const updated = await db.prepare('SELECT * FROM shift_kasir WHERE id = ?').bind(shift.id).first();
        return c.json({ success: true, data: updated });
    }
    catch {
        return c.json({ success: false, error: 'Gagal menutup shift' }, 400);
    }
});
/** Riwayat shift — admin_toko lihat toko sendiri, super_admin lihat semua. */
shiftRoutes.get('/api/shift', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    let sql = `
    SELECT sk.*, u.nama_lengkap as kasir_nama, t.nama as toko_nama
    FROM shift_kasir sk
    JOIN users u ON u.id = sk.kasir_id
    JOIN toko t ON t.id = sk.toko_id
    WHERE 1=1`;
    const params = [];
    if (session.role === 'admin_toko') {
        sql += ' AND sk.toko_id = ?';
        params.push(session.toko_id);
    }
    sql += ' ORDER BY sk.waktu_buka DESC LIMIT 100';
    const { results } = await db.prepare(sql).bind(...params).all();
    return c.json({ success: true, data: results });
});

export default shiftRoutes;
