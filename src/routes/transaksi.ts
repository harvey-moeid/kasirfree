import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';
import { catatLog, wibDateExpr, kodeTransaksi, hitungSplitPayment, hitungPembayaranSebagian } from '../lib/helpers';

const transaksiRoutes = new Hono<AppEnv>();

// ==========================================================
// 5. ROUTES: TRANSAKSI (BATCH ATOMIC)
// ==========================================================

transaksiRoutes.post('/api/transaksi', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');

  try {
    const body = await c.req.json<any>();
    const { offline_uuid, items, diskon = 0, pajak = 0 } = body;
    const toko_id = session.toko_id ?? body.toko_id;
    const kasir_id = session.uid;

    if (!Array.isArray(items) || items.length === 0) {
      return c.json({ success: false, error: 'Item transaksi kosong' }, 400);
    }
    if (!toko_id) {
      return c.json({ success: false, error: 'toko_id tidak diketahui untuk user ini' }, 400);
    }

    // Validasi bentuk tiap item SEBELUM apa pun disentuh DB. `id` & `qty` dari
    // client boleh dipakai (menentukan barang & jumlah yang dibeli), tapi
    // `harga`/`nama` dari client TIDAK PERNAH dipakai untuk kalkulasi — harga
    // sesungguhnya selalu diambil ulang dari tabel `produk` di bawah, supaya
    // request yang dimodifikasi manual tidak bisa mengubah harga jual barang.
    for (const item of items) {
      if (typeof item?.id !== 'number') {
        return c.json({ success: false, error: 'ID produk tidak valid pada salah satu item' }, 400);
      }
      if (!Number.isInteger(item?.qty) || item.qty <= 0) {
        return c.json({ success: false, error: `Qty tidak valid untuk item id=${item?.id} (harus bilangan bulat > 0)` }, 400);
      }
      if (item.catatan != null && typeof item.catatan !== 'string') {
        return c.json({ success: false, error: `catatan harus berupa teks untuk item id=${item?.id}` }, 400);
      }
    }

    // Tautkan transaksi ke shift aktif kasir (kalau ada) supaya kas sistem per-shift
    // bisa direkonsiliasi saat tutup shift. Untuk role 'kasir' ini WAJIB — mencegah
    // transaksi tunai "tidak tercatat" di shift manapun. Role admin tidak diblok
    // (mis. dipakai owner sesekali tanpa disiplin buka/tutup shift formal).
    const shiftAktif = await db
      .prepare("SELECT id FROM shift_kasir WHERE kasir_id = ? AND status = 'buka' ORDER BY id DESC LIMIT 1")
      .bind(kasir_id)
      .first<any>();
    if (!shiftAktif && session.role === 'kasir') {
      return c.json({ success: false, error: 'Belum ada shift aktif — buka shift dulu sebelum mulai transaksi' }, 409);
    }
    const shift_id = shiftAktif?.id ?? null;

    // Idempotency: cegah duplikasi saat sinkronisasi offline mengirim ulang
    if (offline_uuid) {
      const existing = await db
        .prepare('SELECT id, kode_transaksi, nomor_antrian FROM transaksi WHERE offline_uuid = ?')
        .bind(offline_uuid)
        .first<any>();
      if (existing) {
        return c.json({
          success: true,
          id: existing.id,
          message: 'Sudah tersinkronisasi sebelumnya',
          kode_transaksi: existing.kode_transaksi,
          nomor_antrian: existing.nomor_antrian,
        });
      }
    }

    // Ambil harga_jual, stok, status aktif & toko_id TERKINI dari DB untuk
    // semua produk sekaligus (satu query, hindari N+1) — ini SUMBER
    // KEBENARAN, bukan body request. Dipakai untuk validasi DAN kalkulasi
    // harga di bawah.
    const produkIds = [...new Set(items.map((i: any) => i.id))];
    const placeholders = produkIds.map(() => '?').join(',');
    const { results: produkRows } = await db
      .prepare(`SELECT id, nama, harga_jual, stok, is_active, toko_id, tipe FROM produk WHERE id IN (${placeholders})`)
      .bind(...produkIds)
      .all<any>();
    const produkMap = new Map(produkRows.map((p: any) => [p.id, p]));

    // Tolak kalau ada produk yang: tidak ditemukan, sudah dinonaktifkan
    // (soft-deleted), atau ternyata milik toko LAIN (mencegah kasir toko A
    // "membeli" produk toko B lewat request yang dimodifikasi manual).
    const tidakValid = items
      .filter((item: any) => {
        const p = produkMap.get(item.id);
        return !p || p.is_active !== 1 || p.toko_id !== toko_id;
      })
      .map((item: any) => item.id);
    if (tidakValid.length > 0) {
      return c.json(
        { success: false, error: `Produk tidak valid untuk transaksi ini (tidak ditemukan/nonaktif/beda toko): id ${tidakValid.join(', ')}` },
        400
      );
    }

    // Harga selalu diambil dari produk.harga_jual (server-truth) — semua
    // produk bertipe 'simple' sejak fitur ukuran/topping custom dihapus.
    interface HitungItem {
      item: any;
      produk: any;
      hargaSatuan: number;
      ukuranId: null;
      ukuranNama: null;
      toppingList: never[];
    }
    const hitungItems: HitungItem[] = items.map((item: any) => ({
      item,
      produk: produkMap.get(item.id)!,
      hargaSatuan: produkMap.get(item.id)!.harga_jual,
      ukuranId: null,
      ukuranNama: null,
      toppingList: [],
    }));

    // ------------------------------------------------------------------
    // HPP (harga pokok produksi) per item, dihitung dari resep (bahan baku x
    // takaran) yang berlaku SAAT INI, lalu di-SNAPSHOT ke detail_transaksi.
    // Snapshot (bukan dihitung ulang belakangan) supaya laporan margin bulan
    // lalu tidak ikut berubah kalau harga bahan baku naik/turun hari ini.
    // Produk tanpa resep terdaftar dianggap HPP = 0 (owner belum sempat
    // mengisi resepnya — bukan error, cuma belum akurat).
    // ------------------------------------------------------------------
    const refProdukIds = [...new Set(hitungItems.map((h) => h.produk.id))];

    async function ambilHppPerRef(refType: 'produk', ids: number[]): Promise<Map<number, number>> {
      const map = new Map<number, number>();
      if (ids.length === 0) return map;
      const ph = ids.map(() => '?').join(',');
      const { results } = await db
        .prepare(
          `SELECT ri.ref_id, SUM(ri.jumlah * bb.harga_per_satuan) as hpp
           FROM resep_item ri JOIN bahan_baku bb ON bb.id = ri.bahan_baku_id AND bb.is_active = 1
           WHERE ri.ref_type = ? AND ri.ref_id IN (${ph})
           GROUP BY ri.ref_id`
        )
        .bind(refType, ...ids)
        .all<any>();
      for (const row of results) map.set(row.ref_id, row.hpp || 0);
      return map;
    }

    const hppProdukMap = await ambilHppPerRef('produk', refProdukIds);
    const hppPerItem = hitungItems.map((h) => hppProdukMap.get(h.produk.id) ?? 0);

    // Hitung subtotal dari harga yang sudah dihitung server (server-truth), bukan dari body.
    const subtotal = hitungItems.reduce((s, h) => s + h.hargaSatuan * h.item.qty, 0);

    // FIX (integritas keuangan): diskon & pajak sebelumnya dipakai APA ADANYA
    // dari body tanpa validasi — beda dari harga item yang sudah benar diambil
    // ulang dari DB. Client (termasuk kasir, role terendah) bisa mengirim
    // diskon lebih besar dari subtotal sehingga total_bayar negatif, yang
    // membuat hitungSplitPayment menghasilkan "kembalian" raksasa yang
    // tercatat seolah dibayarkan — sementara stok tetap terpotong seperti
    // transaksi normal. Karena semua endpoint /api/laporan/* menjumlah
    // total_bayar langsung dari tabel ini, nilai tak wajar ini akan
    // mengotori omzet harian, produk terlaris, dan rekonsiliasi kas shift.
    const diskonNum = Number(diskon);
    const pajakNum = Number(pajak);
    if (!Number.isFinite(diskonNum) || diskonNum < 0) {
      return c.json({ success: false, error: 'Diskon harus berupa angka >= 0' }, 400);
    }
    if (!Number.isFinite(pajakNum) || pajakNum < 0) {
      return c.json({ success: false, error: 'Pajak harus berupa angka >= 0' }, 400);
    }
    if (diskonNum > subtotal + 0.01) {
      return c.json({ success: false, error: 'Diskon tidak boleh melebihi subtotal belanja' }, 400);
    }

    const total_belanja = subtotal - diskonNum + pajakNum;
    const total_bayar = total_belanja;
    if (total_bayar <= 0) {
      return c.json({ success: false, error: 'Total tagihan harus lebih besar dari 0' }, 400);
    }

    // ------------------------------------------------------------------
    // Preorder / jadwal ambil (opsional). Kalau is_preorder dicentang,
    // waktu_ambil wajib diisi supaya masuk daftar "Pesanan Mendatang".
    // ------------------------------------------------------------------
    const isPreorder = body.is_preorder === true || body.is_preorder === 1;
    let waktuAmbil: string | null = null;
    if (isPreorder) {
      if (!body.waktu_ambil || typeof body.waktu_ambil !== 'string' || isNaN(Date.parse(body.waktu_ambil))) {
        return c.json({ success: false, error: 'Waktu ambil wajib diisi & valid untuk pesanan preorder' }, 400);
      }
      waktuAmbil = new Date(body.waktu_ambil).toISOString();
    }
    const namaPemesan = typeof body.nama_pemesan === 'string' ? body.nama_pemesan.trim().slice(0, 60) || null : null;
    const hpPemesan = typeof body.hp_pemesan === 'string' ? body.hp_pemesan.trim().slice(0, 20) || null : null;

    // Format baru: body.pembayaran = [{ metode, jumlah }, ...] (mendukung split
    // payment, mis. sebagian cash + sebagian QRIS). Tetap menerima format lama
    // (metode_bayar + uang_diterima tunggal) untuk kompatibilitas mundur, mis.
    // antrian offline lama yang belum sempat ter-sync sebelum update ini.
    const pembayaranInput =
      body.pembayaran ??
      (body.metode_bayar
        ? [{ metode: body.metode_bayar, jumlah: body.metode_bayar === 'cash' ? body.uang_diterima ?? total_bayar : total_bayar }]
        : null);

    // ------------------------------------------------------------------
    // Status bayar (khusus preorder): 'lunas' (bayar penuh di muka, default
    // & satu-satunya opsi untuk transaksi BUKAN preorder), 'dp' (bayar
    // sebagian, sisanya dilunasi saat ambil lewat /api/preorder/:id/pelunasan),
    // atau 'belum_bayar' (belum ada yang diterima sama sekali, bayar penuh
    // saat ambil). Transaksi non-preorder dipaksa 'lunas' apa pun yang
    // dikirim client — status bayar cuma masuk akal untuk pesanan yang
    // barangnya belum tentu diambil sekarang.
    // ------------------------------------------------------------------
    let statusBayar: 'lunas' | 'dp' | 'belum_bayar' = 'lunas';
    if (isPreorder && ['lunas', 'dp', 'belum_bayar'].includes(body.status_bayar)) {
      statusBayar = body.status_bayar;
    }

    let splitEntries: PembayaranInput[] = [];
    let cashTotal = 0;
    let kembalian = 0;
    let metodeFinal: string | null = null;
    let jumlahDp = 0;
    let sisaBayar = 0;

    if (statusBayar === 'belum_bayar') {
      // Tidak ada pembayaran diterima sekarang — sisa bayar = seluruh tagihan,
      // dilunasi nanti saat pelanggan ambil pesanan.
      jumlahDp = 0;
      sisaBayar = total_bayar;
    } else if (statusBayar === 'dp') {
      if (!pembayaranInput) {
        return c.json({ success: false, error: 'Rincian pembayaran DP wajib diisi' }, 400);
      }
      const dp = hitungPembayaranSebagian(pembayaranInput, total_bayar);
      if (!dp.ok) {
        return c.json({ success: false, error: dp.error }, 400);
      }
      splitEntries = dp.entries;
      cashTotal = dp.cashTotal;
      metodeFinal = dp.metodeFinal;
      jumlahDp = dp.totalDiterima;
      sisaBayar = total_bayar - jumlahDp;
      // DP yang kebetulan menutup seluruh tagihan otomatis dianggap lunas —
      // supaya tidak ada preorder "lunas beneran" tapi tercatat status 'dp'
      // dengan sisa Rp 0 (ambigu saat ditampilkan di admin).
      if (sisaBayar <= 0.01) {
        statusBayar = 'lunas';
        sisaBayar = 0;
      }
    } else {
      if (!pembayaranInput) {
        return c.json({ success: false, error: 'Rincian pembayaran (pembayaran atau metode_bayar) wajib diisi' }, 400);
      }
      const split = hitungSplitPayment(pembayaranInput, total_bayar);
      if (!split.ok) {
        return c.json({ success: false, error: split.error }, 400);
      }
      splitEntries = split.entries;
      cashTotal = split.cashTotal;
      kembalian = split.kembalian;
      metodeFinal = split.metodeFinal;
      jumlahDp = total_bayar;
      sisaBayar = 0;
    }

    const kode_trx = kodeTransaksi();

    // Nomor antrian harian: jumlah transaksi toko ini hari ini (WIB) + 1,
    // dicetak besar di struk supaya gampang dipanggil ("Nomor 7!"). Catatan:
    // dihitung sesaat sebelum insert (bukan di dalam transaksi DB yang sama)
    // — untuk kasir tunggal 1 outlet risiko dua nomor kembar sangat kecil,
    // tapi kalau nanti ada 2 kasir input bersamaan persis di detik yang sama,
    // nomor bisa dobel. Cukup untuk skala UMKM 1 outlet.
    const antrianRow = await db
      .prepare(`SELECT COUNT(*) as cnt FROM transaksi WHERE toko_id = ? AND ${wibDateExpr('created_at')} = ${wibDateExpr("datetime('now')")}`)
      .bind(toko_id)
      .first<any>();
    const nomor_antrian = (antrianRow?.cnt ?? 0) + 1;

    const statements = [
      db
        .prepare(
          `INSERT INTO transaksi
           (kode_transaksi, toko_id, kasir_id, total_belanja, diskon, pajak, total_bayar, metode_bayar, uang_diterima, kembalian, offline_uuid, shift_id,
            nomor_antrian, is_preorder, waktu_ambil, nama_pemesan, hp_pemesan, status_preorder, status_bayar, jumlah_dp, sisa_bayar)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          kode_trx,
          toko_id,
          kasir_id,
          total_belanja,
          diskonNum,
          pajakNum,
          total_bayar,
          metodeFinal,
          cashTotal > 0 ? cashTotal : null,
          kembalian,
          offline_uuid ?? null,
          shift_id,
          nomor_antrian,
          isPreorder ? 1 : 0,
          waktuAmbil,
          namaPemesan,
          hpPemesan,
          isPreorder ? 'menunggu' : null,
          statusBayar,
          jumlahDp,
          sisaBayar
        ),
    ];

    // Satu baris transaksi_pembayaran per metode yang benar-benar dipakai
    // (idempotency transaksi induknya sudah dijamin lewat offline_uuid di atas;
    // karena statement ini bagian dari batch atomik yang sama, tidak akan ada
    // baris pembayaran yatim jika transaksi gagal disimpan).
    for (const entry of splitEntries) {
      statements.push(
        db
          .prepare(
            `INSERT INTO transaksi_pembayaran (transaksi_id, metode_bayar, jumlah)
             VALUES ((SELECT id FROM transaksi WHERE kode_transaksi = ?), ?, ?)`
          )
          .bind(kode_trx, entry.metode, entry.jumlah)
      );
    }

    // Catatan: bisnis ini tidak melacak stok per-item (disepakati saat setup),
    // jadi transaksi TIDAK memotong kolom produk.stok maupun mencatat
    // riwayat_stok — cukup catat apa yang terjual di detail_transaksi.
    hitungItems.forEach((h, idx) => {
      const { item, produk, hargaSatuan, ukuranId, ukuranNama, toppingList } = h;
      const catatan = typeof item.catatan === 'string' ? item.catatan.slice(0, 200) : null;
      const hppSatuan = hppPerItem[idx];
      statements.push(
        db
          .prepare(
            `INSERT INTO detail_transaksi
             (transaksi_id, produk_id, nama_produk, harga_satuan, qty, subtotal, ukuran_id, ukuran_nama, topping_json, catatan, hpp_satuan)
             VALUES ((SELECT id FROM transaksi WHERE kode_transaksi = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            kode_trx,
            item.id,
            produk.nama,
            hargaSatuan,
            item.qty,
            hargaSatuan * item.qty,
            ukuranId,
            ukuranNama,
            toppingList.length > 0 ? JSON.stringify(toppingList) : null,
            catatan,
            hppSatuan
          )
      );
    });

    // Eksekusi atomik: semua statement sukses, atau semua di-rollback oleh D1
    const batchResults = await db.batch(statements);
    const transaksiId = batchResults[0]?.meta?.last_row_id;

    return c.json(
      {
        success: true,
        id: transaksiId,
        kode_transaksi: kode_trx,
        kembalian,
        metode_bayar: metodeFinal,
        nomor_antrian,
        status_bayar: statusBayar,
        jumlah_dp: jumlahDp,
        sisa_bayar: sisaBayar,
      },
      201
    );
  } catch (err: any) {
    const errMsg = String(err.message ?? '');
    // FIX: sebelumnya semua UNIQUE violation diperlakukan sama — padahal ada
    // dua kolom UNIQUE di tabel transaksi: offline_uuid (idempotency sah) dan
    // kode_transaksi (tabrakan random, jarang tapi mungkin). Keduanya menghasilkan
    // UNIQUE constraint error, tapi artinya sangat berbeda:
    //   - offline_uuid → transaksi SUDAH tersimpan → kembalikan success:true
    //     (sudah ditangani di atas, sebelum try-catch ini)
    //   - kode_transaksi → transaksi BELUM tersimpan → harus success:false
    //     supaya client/kasir tahu perlu coba lagi, BUKAN diam-diam dianggap
    //     sudah sinkron.
    // Dengan format kode baru (ms+rand, ~9 juta variasi/detik) collision ini
    // sangat tidak mungkin, tapi tetap ditangani dengan benar untuk keamanan.
    let msg: string;
    if (errMsg.includes('UNIQUE') && errMsg.toLowerCase().includes('offline_uuid')) {
      msg = 'Transaksi dengan offline_uuid ini sudah pernah masuk';
    } else if (errMsg.includes('UNIQUE') && errMsg.toLowerCase().includes('kode_transaksi')) {
      msg = 'Kode transaksi bentrok — coba kirim ulang (sangat jarang terjadi)';
    } else if (errMsg.includes('UNIQUE')) {
      msg = 'Data duplikat — coba kirim ulang';
    } else {
      msg = 'Gagal menyimpan transaksi';
    }
    return c.json({ success: false, error: msg }, 500);
  }
});

transaksiRoutes.get('/api/transaksi', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const { tanggal, dari, sampai, kasir_id } = c.req.query();

  // FIX (laporan): LIMIT sebelumnya di-hardcode 500 tanpa cara untuk
  // mengambil lebih banyak — export Excel laporan diam-diam kepotong untuk
  // toko dengan >500 transaksi dalam rentang tanggal, tanpa peringatan sama
  // sekali. Sekarang bisa diminta lebih besar lewat ?limit= (dibatasi 5000
  // supaya tidak jadi query tak terbatas), default tetap 500 untuk tampilan
  // UI biasa.
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 500) || 500, 1), 5000);

  let sql = `SELECT t.*,
    (SELECT COUNT(*) FROM detail_transaksi dt WHERE dt.transaksi_id = t.id AND dt.is_batal = 1) as jumlah_item_batal
    FROM transaksi t WHERE 1=1`;
  const params: any[] = [];

  if (session.role === 'kasir') {
    sql += ' AND kasir_id = ?';
    params.push(session.uid);
  } else if (session.role === 'admin_toko') {
    sql += ' AND toko_id = ?';
    params.push(session.toko_id);
  } else if (kasir_id) {
    sql += ' AND kasir_id = ?';
    params.push(kasir_id);
  }

  if (tanggal) {
    sql += ` AND ${wibDateExpr('created_at')} = date(?)`;
    params.push(tanggal);
  }
  if (dari) { sql += ` AND ${wibDateExpr('created_at')} >= date(?)`; params.push(dari); }
  if (sampai) { sql += ` AND ${wibDateExpr('created_at')} <= date(?)`; params.push(sampai); }

  sql += ' ORDER BY created_at DESC LIMIT ' + (limit + 1);

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  // Ambil limit+1 supaya bisa tahu apakah data terpotong (ada baris lebih)
  // tanpa perlu query COUNT(*) terpisah — lalu buang baris ekstranya sebelum dikirim.
  const truncated = results.length > limit;
  const data = truncated ? results.slice(0, limit) : results;
  return c.json({ success: true, data, truncated });
});

// Hapus transaksi secara massal — dipakai untuk bersih-bersih data testing
// sebelum mulai jualan beneran, atau reset total kalau perlu mulai ulang.
// SENGAJA dibatasi super_admin saja & wajib kirim konfirmasi === 'HAPUS'
// (bukan cuma dari tombol UI, tapi juga kalau ada yang coba panggil API ini
// langsung) — ini operasi destruktif & TIDAK BISA dibatalkan lewat aplikasi
// (cuma bisa dipulihkan dari backup manual `wrangler d1 export`).
transaksiRoutes.delete('/api/transaksi/bulk', requireAuth, requireRole('super_admin'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const body = await c.req.json<any>().catch(() => ({}));
    const { dari, sampai, konfirmasi } = body;

    if (konfirmasi !== 'HAPUS') {
      return c.json({ success: false, error: 'Konfirmasi tidak valid — ketik "HAPUS" persis untuk melanjutkan' }, 400);
    }

    let whereSql = 'WHERE 1=1';
    const params: any[] = [];
    if (dari) { whereSql += ` AND ${wibDateExpr('created_at')} >= date(?)`; params.push(dari); }
    if (sampai) { whereSql += ` AND ${wibDateExpr('created_at')} <= date(?)`; params.push(sampai); }

    const countRow = await db.prepare(`SELECT COUNT(*) as cnt FROM transaksi ${whereSql}`).bind(...params).first<any>();
    const jumlah = countRow?.cnt ?? 0;
    if (jumlah === 0) {
      return c.json({ success: true, jumlah_dihapus: 0, message: 'Tidak ada transaksi yang cocok dengan rentang ini' });
    }

    await db.batch([
      db.prepare(`DELETE FROM detail_transaksi WHERE transaksi_id IN (SELECT id FROM transaksi ${whereSql})`).bind(...params),
      db.prepare(`DELETE FROM transaksi ${whereSql}`).bind(...params),
    ]);

    await catatLog(
      db,
      session,
      'hapus',
      'transaksi',
      'bulk',
      `Menghapus ${jumlah} transaksi secara massal${dari || sampai ? ` (rentang ${dari || '...'} s/d ${sampai || '...'})` : ' (SEMUA transaksi)'}`
    );

    return c.json({ success: true, jumlah_dihapus: jumlah });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal menghapus transaksi' }, 400);
  }
});

transaksiRoutes.get('/api/transaksi/:id', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const id = c.req.param('id');
  const trx = await db.prepare('SELECT * FROM transaksi WHERE id = ?').bind(id).first<any>();
  if (!trx) return c.json({ success: false, error: 'Transaksi tidak ditemukan' }, 404);

  // FIX (security/IDOR): sebelumnya endpoint ini tidak mengecek kepemilikan
  // sama sekali — user manapun yang login (termasuk kasir) bisa melihat
  // detail transaksi toko/kasir lain hanya dengan menebak ID. Terapkan aturan
  // yang sama seperti GET /api/transaksi (list): kasir hanya transaksinya
  // sendiri, admin_toko hanya tokonya sendiri, super_admin bebas.
  if (session.role === 'kasir' && trx.kasir_id !== session.uid) {
    return c.json({ success: false, error: 'Transaksi ini bukan milik Anda' }, 403);
  }
  if (session.role === 'admin_toko' && trx.toko_id !== session.toko_id) {
    return c.json({ success: false, error: 'Transaksi ini bukan milik toko Anda' }, 403);
  }

  const { results: items } = await db
    .prepare('SELECT * FROM detail_transaksi WHERE transaksi_id = ?')
    .bind(id)
    .all();

  const { results: pembayaran } = await db
    .prepare('SELECT metode_bayar, jumlah FROM transaksi_pembayaran WHERE transaksi_id = ?')
    .bind(id)
    .all();

  return c.json({ success: true, data: { ...trx, items, pembayaran } });
});

// Batalkan transaksi — SELURUHNYA atau SEBAGIAN ITEM SAJA (mis. pembeli cuma
// batal 1 dari 3 produk yang dipesan). Diizinkan untuk:
//   - kasir : HANYA transaksi miliknya sendiri, DAN masih dalam 30 menit
//             sejak dibuat — cukup untuk kasus "pembeli berubah pikiran
//             begitu selesai bayar", tapi mencegah kasir membatalkan
//             transaksi lama sembarangan (potensi penyalahgunaan/selisih kas).
//   - admin_toko / super_admin : transaksi manapun, kapan saja (dibatasi toko
//             untuk admin_toko, lihat pengecekan di bawah).
//
// body: { item_ids?: number[], alasan?: string }
//   - item_ids diisi  → cuma baris detail_transaksi dengan id itu yang dibatalkan
//     (harus milik transaksi ini & belum batal sebelumnya).
//   - item_ids kosong/tidak dikirim → SEMUA item aktif dibatalkan (setara
//     "batalkan seluruh transaksi", perilaku lama tetap didukung).
// Kalau setelah pembatalan ternyata SEMUA item di transaksi ini sudah batal,
// transaksi.status ikut berubah jadi 'dibatalkan'. Kalau cuma sebagian,
// status transaksi TETAP 'selesai' — laporan (margin, kombinasi terlaris)
// menyaring item yang batal lewat detail_transaksi.is_batal, bukan lewat
// status transaksi.
const BATAS_WAKTU_BATAL_KASIR_MENIT = 30;

transaksiRoutes.post('/api/transaksi/:id/batalkan', requireAuth, async (c) => {
  const db = c.env.DB;
  const session = c.get('session');
  const id = c.req.param('id');

  try {
    const body = await c.req.json<any>().catch(() => ({}));
    const alasan = typeof body.alasan === 'string' ? body.alasan.trim().slice(0, 200) : null;
    const itemIdsDiminta: number[] | null = Array.isArray(body.item_ids) ? body.item_ids.map((x: any) => Number(x)) : null;

    const trx = await db.prepare('SELECT * FROM transaksi WHERE id = ?').bind(id).first<any>();
    if (!trx) return c.json({ success: false, error: 'Transaksi tidak ditemukan' }, 404);
    if (trx.status === 'dibatalkan') {
      return c.json({ success: false, error: 'Transaksi sudah dibatalkan sebelumnya' }, 400);
    }

    if (session.role === 'kasir') {
      if (trx.kasir_id !== session.uid) {
        return c.json({ success: false, error: 'Anda cuma bisa membatalkan transaksi yang Anda buat sendiri' }, 403);
      }
      const menitBerlalu = (Date.now() - new Date(trx.created_at.replace(' ', 'T') + 'Z').getTime()) / 60000;
      if (menitBerlalu > BATAS_WAKTU_BATAL_KASIR_MENIT) {
        return c.json(
          {
            success: false,
            error: `Transaksi ini sudah lewat ${BATAS_WAKTU_BATAL_KASIR_MENIT} menit — minta admin untuk membatalkannya`,
          },
          403
        );
      }
    } else if (session.role === 'admin_toko' && trx.toko_id !== session.toko_id) {
      // FIX (security): admin_toko sebelumnya bisa membatalkan transaksi TOKO
      // LAIN (mengubah laporan keuangan toko lain) karena tidak ada pengecekan
      // kepemilikan toko. super_admin tetap bebas akses semua.
      return c.json({ success: false, error: 'Transaksi ini bukan milik toko Anda' }, 403);
    }

    const { results: itemAktif } = await db
      .prepare('SELECT id, subtotal FROM detail_transaksi WHERE transaksi_id = ? AND is_batal = 0')
      .bind(id)
      .all<any>();
    if (itemAktif.length === 0) {
      return c.json({ success: false, error: 'Tidak ada item aktif untuk dibatalkan' }, 400);
    }

    let itemDibatalkan: any[];
    if (itemIdsDiminta && itemIdsDiminta.length > 0) {
      itemDibatalkan = itemAktif.filter((it: any) => itemIdsDiminta.includes(it.id));
      if (itemDibatalkan.length === 0) {
        return c.json({ success: false, error: 'Item yang dipilih tidak ditemukan atau sudah dibatalkan' }, 400);
      }
    } else {
      itemDibatalkan = itemAktif; // tidak ada item_ids -> batalkan semuanya (perilaku lama)
    }

    const idsDibatalkan = itemDibatalkan.map((it: any) => it.id);
    const totalDikurangi = itemDibatalkan.reduce((s: number, it: any) => s + it.subtotal, 0);
    const jadiBatalTotal = itemDibatalkan.length === itemAktif.length; // semua item aktif ikut kena batal?

    // Catatan: bisnis ini tidak melacak stok (lihat migration 0006), jadi
    // pembatalan TIDAK mengembalikan/mengubah kolom produk.stok.
    // Catatan lain: diskon & pajak nominal transaksi TIDAK ikut disesuaikan
    // proporsional saat batal sebagian (disederhanakan untuk skala UMKM) —
    // cuma subtotal item yang batal yang dikurangkan dari total_belanja &
    // total_bayar.
    //
    // FIX: kalau transaksi ini preorder & DIBATALKAN SELURUHNYA, status_preorder
    // ikut diubah jadi 'dibatalkan' — sebelumnya tetap 'menunggu' selamanya,
    // jadi preorder yang sudah batal masih muncul di tab "Pesanan Mendatang"
    // seolah-olah masih perlu disiapkan. Batal SEBAGIAN item tidak mengubah
    // status_preorder (pesanannya masih perlu disiapkan, cuma lebih sedikit).
    // FIX (uang): sebelumnya pembatalan (total maupun sebagian item) HANYA
    // mengurangi total_belanja/total_bayar, TIDAK ikut menyesuaikan
    // sisa_bayar/status_bayar milik preorder yang sudah DP/belum bayar.
    // Akibatnya kalau preorder senilai 20rb sudah DP 5rb (sisa 15rb), lalu 1
    // item senilai 5rb dibatalkan (total_bayar jadi 15rb), sisa_bayar TETAP
    // 15rb — padahal seharusnya cuma 10rb (15rb dikurangi DP yang sudah
    // diterima). Kalau dibiarkan, kasir bisa MENAGIH KELEBIHAN ke pelanggan
    // saat pengambilan. jumlah_dp (uang yang SUDAH diterima) tidak diubah —
    // itu catatan historis uang yang beneran sudah masuk kas, bukan angka
    // yang boleh "hilang" begitu saja saat pembatalan.
    const ph = idsDibatalkan.map(() => '?').join(',');
    const statements = [
      db
        .prepare(`UPDATE detail_transaksi SET is_batal = 1, alasan_batal = ? WHERE id IN (${ph})`)
        .bind(alasan, ...idsDibatalkan),
      jadiBatalTotal
        ? db
            .prepare(
              `UPDATE transaksi SET status = 'dibatalkan', alasan_batal = ?, total_belanja = total_belanja - ?, total_bayar = total_bayar - ?,
               status_preorder = CASE WHEN is_preorder = 1 THEN 'dibatalkan' ELSE status_preorder END,
               sisa_bayar = CASE WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN 0 ELSE sisa_bayar END,
               status_bayar = CASE WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') THEN 'lunas' ELSE status_bayar END
               WHERE id = ?`
            )
            .bind(alasan, totalDikurangi, totalDikurangi, id)
        : db
            .prepare(
              `UPDATE transaksi SET total_belanja = total_belanja - ?, total_bayar = total_bayar - ?,
               sisa_bayar = CASE WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar')
                                 THEN MAX(0, (total_bayar - ?) - jumlah_dp) ELSE sisa_bayar END,
               status_bayar = CASE WHEN is_preorder = 1 AND status_bayar IN ('dp', 'belum_bayar') AND (total_bayar - ?) - jumlah_dp <= 0
                                   THEN 'lunas' ELSE status_bayar END
               WHERE id = ?`
            )
            .bind(totalDikurangi, totalDikurangi, totalDikurangi, totalDikurangi, id),
    ];
    await db.batch(statements);

    await catatLog(
      db,
      session,
      'batalkan',
      'transaksi',
      trx.id,
      `${jadiBatalTotal ? 'Membatalkan transaksi' : `Membatalkan ${idsDibatalkan.length} item dari transaksi`} ${trx.kode_transaksi} (Rp${totalDikurangi.toLocaleString('id-ID')})${alasan ? ` — alasan: ${alasan}` : ''}`
    );
    return c.json({ success: true, transaksi_dibatalkan_total: jadiBatalTotal, jumlah_item_dibatalkan: idsDibatalkan.length, nominal_dikurangi: totalDikurangi });
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal membatalkan transaksi' }, 500);
  }
});

export default transaksiRoutes;
