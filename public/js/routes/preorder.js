import { Hono } from '../mini-hono.js';
import { requireAuth } from '../local-auth-middleware.js';
import { catatLog, wibDateExpr, hitungPembayaranSebagian } from '../lib/helpers.js';

const preorderRoutes = new Hono();

// ==========================================================
// 5a. ROUTES: PREORDER / JADWAL AMBIL
// ==========================================================
preorderRoutes.get('/api/preorder', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    const status = c.req.query('status'); // 'menunggu' | 'selesai' | 'dibatalkan' | (kosong = semua)
    let sql = 'SELECT * FROM transaksi WHERE is_preorder = 1';
    const params = [];
    // FIX: sebelumnya kasir cuma bisa lihat preorder yang dia BUAT SENDIRI
    // (filter by kasir_id). Preorder itu tanggung jawab satu TOKO, bukan satu
    // orang — kasir shift lain yang jaga pas pelanggan datang ambil pesanan
    // perlu bisa lihat & tandai "selesai" juga, walau bukan dia yang input.
    if (session.role !== 'super_admin') {
        sql += ' AND toko_id = ?';
        params.push(session.toko_id);
    }
    if (status) {
        sql += ' AND status_preorder = ?';
        params.push(status);
    }
    sql += ' ORDER BY waktu_ambil ASC';
    const { results } = await db.prepare(sql).bind(...params).all();
    // Lampirkan ringkasan item per preorder (nama produk + ukuran) supaya admin
    // tidak perlu buka detail satu-satu untuk tahu apa yang harus disiapkan.
    if (results.length > 0) {
        const ids = results.map((r) => r.id);
        const ph = ids.map(() => '?').join(',');
        const { results: items } = await db
            .prepare(`SELECT transaksi_id, nama_produk, ukuran_nama, qty FROM detail_transaksi WHERE transaksi_id IN (${ph}) AND is_batal = 0`)
            .bind(...ids)
            .all();
        const itemsByTrx = new Map();
        for (const it of items) {
            if (!itemsByTrx.has(it.transaksi_id))
                itemsByTrx.set(it.transaksi_id, []);
            itemsByTrx.get(it.transaksi_id).push(it);
        }
        for (const r of results)
            r.items = itemsByTrx.get(r.id) ?? [];
    }
    return c.json({ success: true, data: results });
});
preorderRoutes.put('/api/preorder/:id/status', requireAuth, async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const id = c.req.param('id');
        const body = await c.req.json();
        const status = body.status;
        if (!['menunggu', 'selesai', 'dibatalkan'].includes(status)) {
            return c.json({ success: false, error: 'Status tidak valid' }, 400);
        }
        const trx = await db.prepare('SELECT * FROM transaksi WHERE id = ? AND is_preorder = 1').bind(id).first();
        if (!trx)
            return c.json({ success: false, error: 'Preorder tidak ditemukan' }, 404);
        // Sama seperti GET /api/preorder di atas: preorder milik TOKO, bukan
        // milik kasir yang menginputnya, jadi kasir lain di toko yang sama
        // boleh menandai selesai/batal (mis. kasir shift berikutnya yang
        // melayani pengambilan pesanannya).
        if (session.role !== 'super_admin' && trx.toko_id !== session.toko_id) {
            return c.json({ success: false, error: 'Preorder ini bukan milik toko Anda' }, 403);
        }
        // Aturan bisnis: barang cuma boleh ditandai "selesai" (diserahkan ke
        // pelanggan) kalau sudah LUNAS. Kalau masih ada sisa bayar (status 'dp'
        // atau 'belum_bayar'), kasir wajib lunasi dulu lewat
        // POST /api/preorder/:id/pelunasan sebelum bisa menutup pesanan ini —
        // supaya tidak ada barang keluar tapi tagihannya kebawa lupa.
        if (status === 'selesai' && trx.status_bayar && trx.status_bayar !== 'lunas') {
            return c.json({ success: false, error: `Lunasi sisa bayar Rp ${Math.ceil(trx.sisa_bayar).toLocaleString('id-ID')} dulu sebelum menandai pesanan ini selesai` }, 400);
        }
        await db.prepare('UPDATE transaksi SET status_preorder = ? WHERE id = ?').bind(status, id).run();
        return c.json({ success: true });
    }
    catch (err) {
        return c.json({ success: false, error: 'Gagal mengubah status preorder' }, 400);
    }
});
// Terima pelunasan sisa bayar preorder (dipanggil saat pelanggan datang
// mengambil pesanan yang sebelumnya DP atau belum bayar sama sekali).
// Boleh dicicil (tidak wajib langsung lunas dalam satu kali panggilan),
// tapi sisa_bayar tidak boleh sampai negatif.
preorderRoutes.post('/api/preorder/:id/pelunasan', requireAuth, async (c) => {
    try {
        const db = c.env.DB;
        const session = c.get('session');
        const id = c.req.param('id');
        const body = await c.req.json();
        const trx = await db.prepare('SELECT * FROM transaksi WHERE id = ? AND is_preorder = 1').bind(id).first();
        if (!trx)
            return c.json({ success: false, error: 'Preorder tidak ditemukan' }, 404);
        if (session.role !== 'super_admin' && trx.toko_id !== session.toko_id) {
            return c.json({ success: false, error: 'Preorder ini bukan milik toko Anda' }, 403);
        }
        if (trx.status_preorder === 'dibatalkan') {
            return c.json({ success: false, error: 'Preorder ini sudah dibatalkan' }, 400);
        }
        if (!trx.status_bayar || trx.status_bayar === 'lunas' || trx.sisa_bayar <= 0.01) {
            return c.json({ success: false, error: 'Preorder ini sudah lunas' }, 400);
        }
        const pembayaranInput = body.pembayaran;
        const hasil = hitungPembayaranSebagian(pembayaranInput, trx.sisa_bayar);
        if (!hasil.ok) {
            return c.json({ success: false, error: hasil.error }, 400);
        }
        const sisaBaru = Math.round((trx.sisa_bayar - hasil.totalDiterima) * 100) / 100;
        const statusBaru = sisaBaru <= 0.01 ? 'lunas' : 'dp';
        // UPDATE dulu (dengan optimistic lock: WHERE sisa_bayar = nilai yang tadi
        // kita baca), BARU insert baris transaksi_pelunasan kalau UPDATE-nya
        // benar-benar kena baris (rows_written > 0). Urutan ini penting — kalau
        // INSERT dilakukan lebih dulu/bersamaan dalam 1 batch dan UPDATE-nya
        // ternyata tidak kena baris apa pun (race: ada pelunasan lain yang lebih
        // dulu mengubah sisa_bayar), INSERT itu TETAP ke-commit walau UPDATE-nya
        // no-op — jadinya ada baris "hantu" di transaksi_pelunasan yang mencatat
        // uang seolah diterima tapi tidak pernah ikut dihitung ke sisa_bayar.
        // Dengan mengecek hasil UPDATE dulu, request yang kalah race di-reject
        // SEBELUM apa pun tercatat, jadi kasir yang dapat error 409 tahu betul
        // belum ada apa-apa yang tersimpan dan bisa retry dengan aman.
        const updateResult = await db
            .prepare(`UPDATE transaksi SET jumlah_dp = jumlah_dp + ?, sisa_bayar = ?, status_bayar = ? WHERE id = ? AND sisa_bayar = ?`)
            .bind(hasil.totalDiterima, Math.max(0, sisaBaru), statusBaru, id, trx.sisa_bayar)
            .run();
        if (!updateResult?.meta || updateResult.meta.rows_written === 0) {
            // Race condition terdeteksi (mis. 2 kasir menekan "Lunasi" hampir
            // bersamaan) — pelunasan lain sudah lebih dulu mengubah sisa_bayar.
            // Belum ada apa pun yang tersimpan untuk request ini, aman untuk retry.
            return c.json({ success: false, error: 'Sisa bayar sudah berubah (ada pelunasan lain barusan) — refresh dulu lalu cek ulang sisanya.' }, 409);
        }
        await db.batch(hasil.entries.map((entry) => db
            .prepare(`INSERT INTO transaksi_pelunasan (transaksi_id, jumlah, metode_bayar, user_id) VALUES (?, ?, ?, ?)`)
            .bind(id, entry.jumlah, entry.metode, session.uid)));
        await catatLog(db, session, 'lunasi', 'transaksi', id, `Pelunasan preorder ${trx.kode_transaksi}: diterima Rp ${Math.ceil(hasil.totalDiterima).toLocaleString('id-ID')}, sisa Rp ${Math.ceil(Math.max(0, sisaBaru)).toLocaleString('id-ID')}`);
        return c.json({ success: true, status_bayar: statusBaru, sisa_bayar: Math.max(0, sisaBaru) });
    }
    catch (err) {
        return c.json({ success: false, error: 'Gagal mencatat pelunasan' }, 400);
    }
});
/**
 * Laporan piutang preorder — dua bagian:
 * 1. `ringkasan` + `daftar`: snapshot SEKARANG, semua preorder aktif
 *    (status_preorder='menunggu') yang masih ada sisa_bayar > 0, dikelompokkan
 *    per status_bayar ('dp'/'belum_bayar') dan diurutkan waktu_ambil paling
 *    lama dulu (paling mendesak/berisiko lewat waktu ambil).
 * 2. `riwayat_pelunasan`: histori UANG YANG BENERAN MASUK dari pelunasan,
 *    dikelompokkan per hari (WIB) dalam rentang tanggal filter — ini laporan
 *    "trend piutang tertagih" yang datanya nyata (dari tabel
 *    transaksi_pelunasan), bukan proyeksi. Kalau dari/sampai tidak diisi,
 *    bagian ini dikosongkan (skip query) supaya endpoint tetap ringan untuk
 *    kasus umum (cuma butuh snapshot).
 */
preorderRoutes.get('/api/laporan/piutang', requireAuth, async (c) => {
    const db = c.env.DB;
    const session = c.get('session');
    const { dari, sampai } = c.req.query();
    const filterToko = session.role !== 'super_admin';
    let sqlDaftar = `
    SELECT id, kode_transaksi, nama_pemesan, hp_pemesan, waktu_ambil, total_bayar, jumlah_dp, sisa_bayar, status_bayar
    FROM transaksi
    WHERE is_preorder = 1 AND status_preorder = 'menunggu' AND sisa_bayar > 0`;
    const paramsDaftar = [];
    if (filterToko) {
        sqlDaftar += ' AND toko_id = ?';
        paramsDaftar.push(session.toko_id);
    }
    sqlDaftar += ' ORDER BY waktu_ambil ASC';
    const { results: daftar } = await db.prepare(sqlDaftar).bind(...paramsDaftar).all();
    const ringkasan = { dp: { jumlah: 0, total_sisa: 0 }, belum_bayar: { jumlah: 0, total_sisa: 0 } };
    for (const row of daftar) {
        const key = row.status_bayar === 'dp' ? 'dp' : 'belum_bayar';
        ringkasan[key].jumlah += 1;
        ringkasan[key].total_sisa += row.sisa_bayar;
    }
    let riwayatPelunasan = [];
    if (dari && sampai) {
        let sqlRiwayat = `
      SELECT ${wibDateExpr('tp.created_at')} as tanggal, SUM(tp.jumlah) as total, COUNT(*) as jumlah_pelunasan
      FROM transaksi_pelunasan tp
      JOIN transaksi t ON t.id = tp.transaksi_id
      WHERE ${wibDateExpr('tp.created_at')} BETWEEN date(?) AND date(?)`;
        const paramsRiwayat = [dari, sampai];
        if (filterToko) {
            sqlRiwayat += ' AND t.toko_id = ?';
            paramsRiwayat.push(session.toko_id);
        }
        sqlRiwayat += ' GROUP BY tanggal ORDER BY tanggal ASC';
        const { results } = await db.prepare(sqlRiwayat).bind(...paramsRiwayat).all();
        riwayatPelunasan = results;
    }
    return c.json({ success: true, ringkasan, daftar, riwayat_pelunasan: riwayatPelunasan });
});

export default preorderRoutes;
