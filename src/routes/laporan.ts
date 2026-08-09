import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';
import { wibDateExpr, wibHourExpr, todayWIB } from '../lib/helpers';

const laporanRoutes = new Hono<AppEnv>();

// ==========================================================
// 6. ROUTES: LAPORAN
// ==========================================================

laporanRoutes.get('/api/laporan/harian', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const tanggal = c.req.query('tanggal') ?? todayWIB();

  // FIX: sebelumnya memakai SUM(total_bayar) tanpa pengecualian. Untuk preorder
  // dengan status_bayar 'dp' atau 'belum_bayar', total_bayar = nilai penuh pesanan,
  // padahal yang benar-benar masuk kas hari itu hanya jumlah_dp (sebagian atau 0).
  // Akibatnya laporan harian menampilkan angka lebih tinggi dari kas yang sesungguhnya
  // diterima, dan owner salah kira omzetnya sudah masuk semua.
  // Sekarang: untuk preorder yang belum lunas, hanya jumlah_dp yang dihitung.
  // Pelunasan yang masuk di hari berbeda (saat pickup) tercatat di tabel
  // transaksi_pelunasan — di luar scope laporan harian berbasis tanggal transaksi ini.
  let sql = `
    SELECT
      COUNT(*) as jumlah_transaksi,
      COALESCE(SUM(
        CASE
          WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN jumlah_dp
          ELSE total_bayar
        END
      ), 0) as total_penjualan,
      COALESCE(SUM(
        CASE WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN sisa_bayar ELSE 0 END
      ), 0) as total_piutang_preorder
    FROM transaksi WHERE ${wibDateExpr('created_at')} = date(?) AND status = 'selesai'`;
  const params: any[] = [tanggal];

  if (session.role !== 'super_admin') {
    sql += ' AND toko_id = ?';
    params.push(session.toko_id);
  }

  const row = await db.prepare(sql).bind(...params).first();
  return c.json({ success: true, data: row });
});

laporanRoutes.get('/api/laporan/produk-terlaris', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { dari, sampai, limit = '10' } = c.req.query();

  let sql = `
    SELECT dt.produk_id, dt.nama_produk, SUM(dt.qty) as total_qty, SUM(dt.subtotal) as total_omzet
    FROM detail_transaksi dt
    JOIN transaksi t ON t.id = dt.transaksi_id
    WHERE t.status = 'selesai' AND dt.is_batal = 0`;
  const params: any[] = [];

  if (dari) { sql += ` AND ${wibDateExpr('t.created_at')} >= date(?)`; params.push(dari); }
  if (sampai) { sql += ` AND ${wibDateExpr('t.created_at')} <= date(?)`; params.push(sampai); }
  if (session.role !== 'super_admin') { sql += ' AND t.toko_id = ?'; params.push(session.toko_id); }

  sql += ' GROUP BY dt.produk_id ORDER BY total_qty DESC LIMIT ?';
  params.push(Number(limit));

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: results });
});

/**
 * Tren penjualan harian dalam rentang N hari terakhir (default 7) — dipakai
 * untuk grafik di dashboard admin. Mengembalikan SEMUA tanggal dalam rentang
 * (termasuk yang omzetnya 0) supaya sumbu-X chart tidak bolong/loncat.
 */
laporanRoutes.get('/api/laporan/tren-penjualan', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const hari = Math.min(Math.max(Number(c.req.query('hari') ?? 7), 1), 90);

  // FIX: sama seperti /api/laporan/harian — pakai jumlah_dp untuk preorder
  // DP/belum_bayar supaya grafik tren tidak melebih-lebihkan cash yang masuk.
  let sql = `
    SELECT ${wibDateExpr('created_at')} as tanggal, COUNT(*) as jumlah_transaksi,
      COALESCE(SUM(
        CASE
          WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN jumlah_dp
          ELSE total_bayar
        END
      ), 0) as total_penjualan
    FROM transaksi
    WHERE status = 'selesai' AND ${wibDateExpr('created_at')} >= date(?, ?)`;
  const params: any[] = [todayWIB(), `-${hari - 1} days`];

  if (session.role !== 'super_admin') {
    sql += ' AND toko_id = ?';
    params.push(session.toko_id);
  }
  sql += ` GROUP BY ${wibDateExpr('created_at')} ORDER BY tanggal ASC`;

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  const dataMap = new Map(results.map((r: any) => [r.tanggal, r]));

  // Isi tanggal kosong dengan 0 supaya grafik tetap kontinu. Dihitung mundur
  // dari "hari ini" versi WIB, bukan UTC, supaya konsisten dengan query di atas.
  const lengkap: { tanggal: string; jumlah_transaksi: number; total_penjualan: number }[] = [];
  const hariIniWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  for (let i = hari - 1; i >= 0; i--) {
    const d = new Date(hariIniWIB);
    d.setUTCDate(d.getUTCDate() - i);
    const tgl = d.toISOString().slice(0, 10);
    const row = dataMap.get(tgl) as any;
    lengkap.push({
      tanggal: tgl,
      jumlah_transaksi: row?.jumlah_transaksi ?? 0,
      total_penjualan: row?.total_penjualan ?? 0,
    });
  }

  return c.json({ success: true, data: lengkap });
});

laporanRoutes.get('/api/laporan/stok-menipis', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const ambang = Number(c.req.query('ambang') ?? 10);

  let sql = 'SELECT * FROM produk WHERE is_active = 1 AND stok <= ?';
  const params: any[] = [ambang];

  if (session.role !== 'super_admin') { sql += ' AND toko_id = ?'; params.push(session.toko_id); }
  sql += ' ORDER BY stok ASC';

  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: results });
});

// ==========================================================
// 6a. ROUTES: LAPORAN LANJUTAN (margin, kombinasi terlaris, jam ramai)
// ==========================================================

/** Total omzet, HPP, dan margin kotor dalam rentang tanggal. HPP diambil dari
 *  snapshot detail_transaksi.hpp_satuan (nilai saat transaksi terjadi), BUKAN
 *  dihitung ulang dari harga bahan baku sekarang — supaya margin bulan lalu
 *  tidak berubah kalau harga bahan baku naik/turun hari ini. */
laporanRoutes.get('/api/laporan/margin', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { dari, sampai } = c.req.query();

  let sql = `
    SELECT
      COALESCE(SUM(dt.subtotal), 0) as total_omzet,
      COALESCE(SUM(dt.hpp_satuan * dt.qty), 0) as total_hpp
    FROM detail_transaksi dt
    JOIN transaksi t ON t.id = dt.transaksi_id
    WHERE t.status = 'selesai' AND dt.is_batal = 0`;
  const params: any[] = [];
  if (dari) { sql += ` AND ${wibDateExpr('t.created_at')} >= date(?)`; params.push(dari); }
  if (sampai) { sql += ` AND ${wibDateExpr('t.created_at')} <= date(?)`; params.push(sampai); }
  if (session.role !== 'super_admin') { sql += ' AND t.toko_id = ?'; params.push(session.toko_id); }

  const row = await db.prepare(sql).bind(...params).first<any>();
  const totalOmzet = row?.total_omzet ?? 0;
  const totalHpp = row?.total_hpp ?? 0;
  const margin = totalOmzet - totalHpp;

  // Peringatan data: HPP = 0 di detail_transaksi bisa berarti dua hal yang
  // sangat berbeda — "bahan bakunya memang gratis" (jarang terjadi) atau
  // "belum sempat diisi resepnya" (jauh lebih umum). Tanpa peringatan ini,
  // owner bisa salah kira margin-nya lebih tinggi dari kenyataan padahal itu
  // cuma karena datanya belum lengkap. Kita tunjukkan produk mana saja yang
  // terjual dengan HPP=0 di rentang ini supaya bisa langsung dicek/diisi.
  let sqlTanpaResep = `
    SELECT DISTINCT dt.nama_produk
    FROM detail_transaksi dt
    JOIN transaksi t ON t.id = dt.transaksi_id
    WHERE t.status = 'selesai' AND dt.is_batal = 0 AND dt.hpp_satuan = 0`;
  const paramsTanpaResep: any[] = [];
  if (dari) { sqlTanpaResep += ` AND ${wibDateExpr('t.created_at')} >= date(?)`; paramsTanpaResep.push(dari); }
  if (sampai) { sqlTanpaResep += ` AND ${wibDateExpr('t.created_at')} <= date(?)`; paramsTanpaResep.push(sampai); }
  if (session.role !== 'super_admin') { sqlTanpaResep += ' AND t.toko_id = ?'; paramsTanpaResep.push(session.toko_id); }
  sqlTanpaResep += ' LIMIT 20';
  const { results: tanpaResepRows } = await db.prepare(sqlTanpaResep).bind(...paramsTanpaResep).all<any>();
  const produkTanpaResep = tanpaResepRows.map((r: any) => r.nama_produk);

  return c.json({
    success: true,
    data: {
      total_omzet: totalOmzet,
      total_hpp: totalHpp,
      margin_kotor: margin,
      produk_tanpa_resep: produkTanpaResep,
      margin_persen: totalOmzet > 0 ? Math.round((margin / totalOmzet) * 1000) / 10 : 0,
    },
  });
});

/** Produk paling laris berdasarkan total qty terjual. */
laporanRoutes.get('/api/laporan/kombinasi-terlaris', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { dari, sampai, limit = '10' } = c.req.query();

  let sql = `
    SELECT dt.nama_produk,
           SUM(dt.qty) as total_qty, SUM(dt.subtotal) as total_omzet
    FROM detail_transaksi dt
    JOIN transaksi t ON t.id = dt.transaksi_id
    WHERE t.status = 'selesai' AND dt.is_batal = 0`;
  const params: any[] = [];
  if (dari) { sql += ` AND ${wibDateExpr('t.created_at')} >= date(?)`; params.push(dari); }
  if (sampai) { sql += ` AND ${wibDateExpr('t.created_at')} <= date(?)`; params.push(sampai); }
  if (session.role !== 'super_admin') { sql += ' AND t.toko_id = ?'; params.push(session.toko_id); }

  sql += ` GROUP BY dt.nama_produk
           ORDER BY total_qty DESC LIMIT ?`;
  params.push(Number(limit));

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  const data = results.map((row: any) => ({
    nama_produk: row.nama_produk,
    total_qty: row.total_qty,
    total_omzet: row.total_omzet,
  }));
  return c.json({ success: true, data });
});

/** Jumlah transaksi & omzet per jam (00-23, WIB) — buat tahu jam paling ramai. */
laporanRoutes.get('/api/laporan/jam-ramai', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { dari, sampai } = c.req.query();

  // FIX: sama seperti /api/laporan/harian — pakai jumlah_dp untuk preorder
  // DP/belum_bayar supaya distribusi omzet per jam tidak melebih-lebihkan.
  let sql = `
    SELECT ${wibHourExpr('created_at')} as jam, COUNT(*) as jumlah_transaksi,
      COALESCE(SUM(
        CASE
          WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN jumlah_dp
          ELSE total_bayar
        END
      ), 0) as total_omzet
    FROM transaksi
    WHERE status = 'selesai'`;
  const params: any[] = [];
  if (dari) { sql += ` AND ${wibDateExpr('created_at')} >= date(?)`; params.push(dari); }
  if (sampai) { sql += ` AND ${wibDateExpr('created_at')} <= date(?)`; params.push(sampai); }
  if (session.role !== 'super_admin') { sql += ' AND toko_id = ?'; params.push(session.toko_id); }
  sql += ` GROUP BY jam ORDER BY jam ASC`;

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  const dataMap = new Map(results.map((r: any) => [r.jam, r]));
  // Isi jam 00-23 yang kosong dengan 0 supaya grafik tidak bolong.
  const lengkap = Array.from({ length: 24 }, (_, h) => {
    const jamStr = String(h).padStart(2, '0');
    const row = dataMap.get(jamStr) as any;
    return { jam: jamStr, jumlah_transaksi: row?.jumlah_transaksi ?? 0, total_omzet: row?.total_omzet ?? 0 };
  });
  return c.json({ success: true, data: lengkap });
});

/**
 * Kinerja per kasir/staff — breakdown "siapa jual berapa" dalam rentang
 * tanggal filter. Dua sumber digabung di JS (bukan satu JOIN besar) karena
 * beda level agregasi: omzet dihitung dari detail_transaksi (supaya item
 * yang dibatalkan per-item tidak ikut kehitung, sama seperti /laporan/margin),
 * sedangkan selisih kas dihitung dari shift_kasir yang sudah ditutup
 * (waktu_tutup, bukan waktu_buka, supaya konsisten dgn kapan shift itu
 * "selesai" dan masuk rentang filter tanggal).
 */
laporanRoutes.get('/api/laporan/per-kasir', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { dari, sampai } = c.req.query();

  let sqlOmzet = `
    SELECT
      u.id as kasir_id,
      u.nama_lengkap,
      u.username,
      u.is_active,
      COUNT(DISTINCT t.id) as jumlah_transaksi,
      COALESCE(SUM(dt.subtotal), 0) as total_omzet,
      COALESCE(SUM(dt.qty), 0) as total_item_terjual
    FROM detail_transaksi dt
    JOIN transaksi t ON t.id = dt.transaksi_id
    JOIN users u ON u.id = t.kasir_id
    WHERE t.status = 'selesai' AND dt.is_batal = 0`;
  const paramsOmzet: any[] = [];
  if (dari) { sqlOmzet += ` AND ${wibDateExpr('t.created_at')} >= date(?)`; paramsOmzet.push(dari); }
  if (sampai) { sqlOmzet += ` AND ${wibDateExpr('t.created_at')} <= date(?)`; paramsOmzet.push(sampai); }
  if (session.role !== 'super_admin') { sqlOmzet += ' AND t.toko_id = ?'; paramsOmzet.push(session.toko_id); }
  sqlOmzet += ' GROUP BY u.id ORDER BY total_omzet DESC';

  let sqlShift = `
    SELECT
      kasir_id,
      COUNT(*) as jumlah_shift,
      COALESCE(SUM(selisih), 0) as total_selisih,
      COALESCE(SUM(CASE WHEN selisih < 0 THEN 1 ELSE 0 END), 0) as shift_kurang
    FROM shift_kasir
    WHERE status = 'tutup'`;
  const paramsShift: any[] = [];
  if (dari) { sqlShift += ` AND ${wibDateExpr('waktu_tutup')} >= date(?)`; paramsShift.push(dari); }
  if (sampai) { sqlShift += ` AND ${wibDateExpr('waktu_tutup')} <= date(?)`; paramsShift.push(sampai); }
  if (session.role !== 'super_admin') { sqlShift += ' AND toko_id = ?'; paramsShift.push(session.toko_id); }
  sqlShift += ' GROUP BY kasir_id';

  const [omzetRes, shiftRes] = await Promise.all([
    db.prepare(sqlOmzet).bind(...paramsOmzet).all<any>(),
    db.prepare(sqlShift).bind(...paramsShift).all<any>(),
  ]);

  const shiftMap = new Map(shiftRes.results.map((r: any) => [r.kasir_id, r]));
  const data = omzetRes.results.map((r: any) => {
    const shift = shiftMap.get(r.kasir_id) as any;
    return {
      kasir_id: r.kasir_id,
      nama_lengkap: r.nama_lengkap,
      username: r.username,
      is_active: r.is_active,
      jumlah_transaksi: r.jumlah_transaksi,
      total_omzet: r.total_omzet,
      total_item_terjual: r.total_item_terjual,
      rata_rata_transaksi: r.jumlah_transaksi > 0 ? Math.round(r.total_omzet / r.jumlah_transaksi) : 0,
      jumlah_shift: shift?.jumlah_shift ?? 0,
      total_selisih_kas: shift?.total_selisih ?? 0,
      shift_kurang: shift?.shift_kurang ?? 0,
    };
  });

  return c.json({ success: true, data });
});

export default laporanRoutes;
