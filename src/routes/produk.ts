import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';
import { catatLog, getProdukAtauTolak } from '../lib/helpers';

const produkRoutes = new Hono<AppEnv>();

produkRoutes.get('/api/produk', requireAuth, async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const { kategori_id, search } = c.req.query();

    // Kasir & admin_toko hanya lihat produk tokonya sendiri; super_admin bisa semua
    // (opsional filter ?toko_id= untuk super_admin).
    const tokoIdFilter =
      session.role === 'super_admin' ? c.req.query('toko_id') ?? null : session.toko_id;

    let sql = `
      SELECT p.*, k.nama as kategori_nama
      FROM produk p
      LEFT JOIN kategori k ON k.id = p.kategori_id
      WHERE p.is_active = 1`;
    const params: any[] = [];

    if (tokoIdFilter) {
      sql += ' AND p.toko_id = ?';
      params.push(tokoIdFilter);
    }
    if (kategori_id) {
      sql += ' AND p.kategori_id = ?';
      params.push(kategori_id);
    }
    if (search) {
      sql += ' AND (p.nama LIKE ? OR p.kode_produk LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY p.nama ASC';

    const { results } = await db.prepare(sql).bind(...params).all<any>();

    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal mengambil data produk' }, 500);
  }
});

/**
 * FIX (integritas data): harga_jual/harga_beli/stok sebelumnya diterima apa
 * adanya dari body tanpa validasi tipe/rentang — bisa jadi NaN, negatif, atau
 * string kalau body dimodifikasi manual (endpoint ini memang dibatasi role
 * admin, tapi tetap defense-in-depth: harga negatif pada satu produk bisa
 * dipakai untuk mengimbangi/menurunkan total_bayar transaksi lain yang
 * memuatnya, mirip celah yang sudah diperbaiki pada diskon/pajak transaksi).
 */
function validasiHargaStok(body: any): { ok: true } | { ok: false; error: string } {
  const hargaJual = Number(body.harga_jual);
  if (!Number.isFinite(hargaJual) || hargaJual <= 0) {
    return { ok: false, error: 'harga_jual harus berupa angka lebih besar dari 0' };
  }
  if (body.harga_beli != null) {
    const hargaBeli = Number(body.harga_beli);
    if (!Number.isFinite(hargaBeli) || hargaBeli < 0) {
      return { ok: false, error: 'harga_beli harus berupa angka >= 0' };
    }
  }
  if (body.stok != null) {
    const stok = Number(body.stok);
    if (!Number.isFinite(stok) || !Number.isInteger(stok) || stok < 0) {
      return { ok: false, error: 'stok awal harus berupa bilangan bulat >= 0' };
    }
  }
  return { ok: true };
}

produkRoutes.post('/api/produk', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const body = await c.req.json<any>();
    const toko_id = session.role === 'super_admin' ? body.toko_id : session.toko_id;

    if (!body.kode_produk || !body.nama || body.harga_jual == null) {
      return c.json({ success: false, error: 'kode_produk, nama, dan harga_jual wajib diisi' }, 400);
    }
    const validasi = validasiHargaStok(body);
    if (!validasi.ok) return c.json({ success: false, error: validasi.error }, 400);
    const result = await db
      .prepare(
        `INSERT INTO produk (toko_id, kategori_id, kode_produk, nama, harga_beli, harga_jual, stok, satuan, gambar_url, tipe)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        toko_id,
        body.kategori_id ?? null,
        body.kode_produk,
        body.nama,
        body.harga_beli ?? 0,
        body.harga_jual,
        body.stok ?? 0,
        body.satuan ?? 'pcs',
        body.gambar_url ?? null,
        'simple'
      )
      .run();

    await catatLog(
      db,
      session,
      'tambah',
      'produk',
      result.meta.last_row_id,
      `Menambah produk "${body.nama}" (${body.kode_produk}), harga jual ${body.harga_jual}`
    );

    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err: any) {
    const msg = String(err.message ?? '').includes('UNIQUE')
      ? 'Kode produk/barcode sudah dipakai'
      : 'Gagal menambah produk';
    return c.json({ success: false, error: msg }, 400);
  }
});

produkRoutes.put('/api/produk/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const id = c.req.param('id');
    const body = await c.req.json<any>();

    if (body.harga_jual == null) {
      return c.json({ success: false, error: 'harga_jual wajib diisi' }, 400);
    }
    const validasi = validasiHargaStok(body);
    if (!validasi.ok) return c.json({ success: false, error: validasi.error }, 400);

    const check = await getProdukAtauTolak(db, id, session);
    if ('error' in check) return check.error;
    const produkLama = check.produk;

    await db
      .prepare(
        `UPDATE produk SET nama = ?, kategori_id = ?, harga_beli = ?, harga_jual = ?, satuan = ?,
         gambar_url = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(
        body.nama,
        body.kategori_id ?? null,
        body.harga_beli ?? 0,
        body.harga_jual,
        body.satuan ?? 'pcs',
        body.gambar_url ?? null,
        id
      )
      .run();

    // Foto lama yang kita simpan sendiri di R2 (bukan URL eksternal) dan sudah
    // diganti dengan foto lain (atau dihapus) tidak dipakai lagi — bersihkan
    // supaya bucket tidak terus membengkak dengan foto yatim. Best-effort:
    // kalau gagal (jaringan dsb), tidak menggagalkan penyimpanan produknya.
    const keyLama = r2KeyDariGambarUrl(produkLama.gambar_url);
    if (keyLama && produkLama.gambar_url !== body.gambar_url) {
      c.executionCtx.waitUntil(c.env.IMAGES.delete(keyLama).catch(() => {}));
    }

    // Catat perubahan spesifik (nama & harga) supaya log berguna untuk investigasi,
    // bukan cuma "produk diubah" yang tidak informatif.
    const perubahan: string[] = [];
    if (produkLama.nama !== body.nama) perubahan.push(`nama: "${produkLama.nama}" -> "${body.nama}"`);
    if (Number(produkLama.harga_jual) !== Number(body.harga_jual)) {
      perubahan.push(`harga jual: Rp${Number(produkLama.harga_jual).toLocaleString('id-ID')} -> Rp${Number(body.harga_jual).toLocaleString('id-ID')}`);
    }
    if (Number(produkLama.harga_beli ?? 0) !== Number(body.harga_beli ?? 0)) {
      perubahan.push(`harga beli: Rp${Number(produkLama.harga_beli ?? 0).toLocaleString('id-ID')} -> Rp${Number(body.harga_beli ?? 0).toLocaleString('id-ID')}`);
    }
    await catatLog(
      db,
      session,
      'ubah',
      'produk',
      id,
      perubahan.length > 0 ? `Ubah produk "${produkLama.nama}": ${perubahan.join('; ')}` : `Ubah produk "${produkLama.nama}" (tanpa perubahan harga/nama)`
    );

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal mengubah produk' }, 400);
  }
});

produkRoutes.delete('/api/produk/:id', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const id = c.req.param('id');

  const check = await getProdukAtauTolak(db, id, session);
  if ('error' in check) return check.error;

  await db.prepare('UPDATE produk SET is_active = 0 WHERE id = ?').bind(id).run();
  await catatLog(db, session, 'nonaktifkan', 'produk', id, `Menonaktifkan produk "${check.produk.nama}"`);
  return c.json({ success: true });
});

// Koreksi stok manual — WAJIB tercatat di riwayat_stok (PRD 7.2)
produkRoutes.post('/api/produk/:id/koreksi-stok', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const id = Number(c.req.param('id'));
    const { jumlah, alasan } = await c.req.json<{ jumlah: number; alasan?: string }>();

    if (typeof jumlah !== 'number') {
      return c.json({ success: false, error: 'jumlah wajib berupa angka (bisa negatif untuk koreksi turun)' }, 400);
    }

    const check = await getProdukAtauTolak(db, id, session);
    if ('error' in check) return check.error;
    const produk = check.produk;

    const stokSebelum = produk.stok as number;
    const stokSesudah = stokSebelum + jumlah;

    await db.batch([
      db.prepare(`UPDATE produk SET stok = ?, updated_at = datetime('now') WHERE id = ?`).bind(stokSesudah, id),
      db
        .prepare(
          `INSERT INTO riwayat_stok (produk_id, jenis, jumlah, stok_sebelum, stok_sesudah, referensi, user_id)
           VALUES (?, 'koreksi', ?, ?, ?, ?, ?)`
        )
        .bind(id, jumlah, stokSebelum, stokSesudah, alasan ?? 'Koreksi manual', session.uid),
    ]);

    return c.json({ success: true, stok_sesudah: stokSesudah });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal melakukan koreksi stok' }, 500);
  }
});

export default produkRoutes;
