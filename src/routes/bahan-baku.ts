import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';

const bahanBakuRoutes = new Hono<AppEnv>();

// ==========================================================
// 4b1. ROUTES: BAHAN BAKU & RESEP (HPP / margin)
//
// bahan_baku = daftar bahan mentah + harga per satuan (mis. Tepung Terigu,
// Rp12/gram). resep_item menghubungkan bahan_baku ke produk (ref_type +
// ref_id) beserta takarannya — dipakai menghitung HPP tiap kali ada
// transaksi (lihat POST /api/transaksi di atas).
// ==========================================================

// FIX: dibatasi admin_toko/super_admin — data HPP/harga bahan baku adalah
// informasi bisnis sensitif (margin), kasir tidak perlu (dan sebaiknya
// tidak) bisa mengaksesnya lewat pemanggilan API langsung.
bahanBakuRoutes.get('/api/bahan-baku', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const tokoIdFilter = session.role === 'super_admin' ? c.req.query('toko_id') ?? null : session.toko_id;
  let sql = 'SELECT * FROM bahan_baku WHERE is_active = 1';
  const params: any[] = [];
  if (tokoIdFilter) {
    sql += ' AND toko_id = ?';
    params.push(tokoIdFilter);
  }
  sql += ' ORDER BY nama ASC';
  const { results } = await db.prepare(sql).bind(...params).all();
  return c.json({ success: true, data: results });
});

bahanBakuRoutes.post('/api/bahan-baku', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const body = await c.req.json<any>();
    const nama = String(body.nama ?? '').trim().slice(0, 60);
    const satuan = String(body.satuan ?? '').trim().slice(0, 20) || 'gram';
    const harga = Number(body.harga_per_satuan);
    if (!nama) return c.json({ success: false, error: 'Nama bahan baku wajib diisi' }, 400);
    if (!Number.isFinite(harga) || harga < 0 || harga > 10_000_000) {
      return c.json({ success: false, error: 'Harga per satuan harus berupa angka antara 0 - 10.000.000' }, 400);
    }
    const toko_id = session.role === 'super_admin' ? Number(body.toko_id) || session.toko_id : session.toko_id;
    const result = await db
      .prepare('INSERT INTO bahan_baku (toko_id, nama, satuan, harga_per_satuan) VALUES (?, ?, ?, ?)')
      .bind(toko_id, nama, satuan, harga)
      .run();
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal menambah bahan baku' }, 400);
  }
});

bahanBakuRoutes.put('/api/bahan-baku/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const id = c.req.param('id');
    const body = await c.req.json<any>();
    const row = await db.prepare('SELECT * FROM bahan_baku WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ success: false, error: 'Bahan baku tidak ditemukan' }, 404);
    if (session.role !== 'super_admin' && row.toko_id !== session.toko_id) {
      return c.json({ success: false, error: 'Anda tidak memiliki akses untuk bahan baku ini' }, 403);
    }
    const nama = String(body.nama ?? '').trim().slice(0, 60);
    const satuan = String(body.satuan ?? '').trim().slice(0, 20) || 'gram';
    const harga = Number(body.harga_per_satuan);
    if (!nama) return c.json({ success: false, error: 'Nama bahan baku wajib diisi' }, 400);
    if (!Number.isFinite(harga) || harga < 0 || harga > 10_000_000) {
      return c.json({ success: false, error: 'Harga per satuan harus berupa angka antara 0 - 10.000.000' }, 400);
    }
    await db
      .prepare("UPDATE bahan_baku SET nama = ?, satuan = ?, harga_per_satuan = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(nama, satuan, harga, id)
      .run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal mengubah bahan baku' }, 400);
  }
});

bahanBakuRoutes.delete('/api/bahan-baku/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const id = c.req.param('id');
  const row = await db.prepare('SELECT * FROM bahan_baku WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ success: false, error: 'Bahan baku tidak ditemukan' }, 404);
  if (session.role !== 'super_admin' && row.toko_id !== session.toko_id) {
    return c.json({ success: false, error: 'Anda tidak memiliki akses untuk bahan baku ini' }, 403);
  }
  await db.prepare('UPDATE bahan_baku SET is_active = 0 WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

const REF_TYPES = ['produk'] as const;
type RefType = (typeof REF_TYPES)[number];

/** Ambil toko_id pemilik suatu produk (resep HPP hanya mengacu ke produk sekarang). */
async function tokoIdDariRef(db: D1Database, refType: RefType, refId: number): Promise<number | null> {
  const row = await db.prepare('SELECT toko_id FROM produk WHERE id = ?').bind(refId).first<any>();
  return row?.toko_id ?? null;
}

// FIX: dibatasi admin_toko/super_admin (sama seperti /api/bahan-baku) &
// ditambah pengecekan kepemilikan toko — sebelumnya endpoint ini bisa
// dipanggil siapa saja yang login untuk ref_id manapun tanpa verifikasi
// toko, berpotensi bocor data resep/HPP toko lain kalau nanti multi-toko
// benar-benar dipakai (skema-nya sudah mendukung, walau saat ini 1 toko).
bahanBakuRoutes.get('/api/resep', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const refType = c.req.query('ref_type');
  const refId = Number(c.req.query('ref_id'));
  if (!REF_TYPES.includes(refType as RefType) || !refId) {
    return c.json({ success: false, error: 'ref_type/ref_id tidak valid' }, 400);
  }
  const tokoRef = await tokoIdDariRef(db, refType as RefType, refId);
  if (tokoRef == null) return c.json({ success: false, error: 'Produk tujuan tidak ditemukan' }, 404);
  if (session.role !== 'super_admin' && tokoRef !== session.toko_id) {
    return c.json({ success: false, error: 'Anda tidak memiliki akses untuk item ini' }, 403);
  }
  const { results } = await db
    .prepare(
      `SELECT ri.id, ri.jumlah, ri.urutan, bb.id as bahan_baku_id, bb.nama as bahan_nama, bb.satuan, bb.harga_per_satuan
       FROM resep_item ri JOIN bahan_baku bb ON bb.id = ri.bahan_baku_id
       WHERE ri.ref_type = ? AND ri.ref_id = ? AND bb.is_active = 1 ORDER BY ri.urutan ASC, ri.id ASC`
    )
    .bind(refType, refId)
    .all<any>();
  const totalHpp = results.reduce((s: number, r: any) => s + r.jumlah * r.harga_per_satuan, 0);
  return c.json({ success: true, data: results, total_hpp: totalHpp });
});

bahanBakuRoutes.post('/api/resep', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const body = await c.req.json<any>();
    const refType = body.ref_type;
    const refId = Number(body.ref_id);
    const bahanBakuId = Number(body.bahan_baku_id);
    const jumlah = Number(body.jumlah);

    if (!REF_TYPES.includes(refType)) return c.json({ success: false, error: 'ref_type tidak valid' }, 400);
    if (!refId) return c.json({ success: false, error: 'ref_id wajib diisi' }, 400);
    if (!Number.isFinite(jumlah) || jumlah <= 0 || jumlah > 100_000) {
      return c.json({ success: false, error: 'Jumlah/takaran harus berupa angka > 0 (maks 100.000)' }, 400);
    }

    const tokoRef = await tokoIdDariRef(db, refType, refId);
    if (tokoRef == null) return c.json({ success: false, error: 'Produk tujuan tidak ditemukan' }, 404);
    if (session.role !== 'super_admin' && tokoRef !== session.toko_id) {
      return c.json({ success: false, error: 'Anda tidak memiliki akses untuk item ini' }, 403);
    }

    const bahan = await db.prepare('SELECT * FROM bahan_baku WHERE id = ? AND is_active = 1').bind(bahanBakuId).first<any>();
    if (!bahan) return c.json({ success: false, error: 'Bahan baku tidak ditemukan' }, 404);
    if (session.role !== 'super_admin' && bahan.toko_id !== session.toko_id) {
      return c.json({ success: false, error: 'Bahan baku ini bukan milik toko Anda' }, 403);
    }

    const result = await db
      .prepare('INSERT INTO resep_item (ref_type, ref_id, bahan_baku_id, jumlah) VALUES (?, ?, ?, ?)')
      .bind(refType, refId, bahanBakuId, jumlah)
      .run();
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal menambah resep' }, 400);
  }
});

bahanBakuRoutes.delete('/api/resep/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const id = c.req.param('id');
  const row = await db.prepare('SELECT * FROM resep_item WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ success: false, error: 'Resep tidak ditemukan' }, 404);
  const tokoRef = await tokoIdDariRef(db, row.ref_type, row.ref_id);
  if (session.role !== 'super_admin' && tokoRef !== session.toko_id) {
    return c.json({ success: false, error: 'Anda tidak memiliki akses untuk resep ini' }, 403);
  }
  await db.prepare('DELETE FROM resep_item WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default bahanBakuRoutes;
