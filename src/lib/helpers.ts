// Kumpulan helper murni (tanpa dependensi Hono context) dipakai lintas modul routes/.
// Dipindah dari src/index.ts (sebelumnya semua route + helper ada dalam 1 file).

function kodeTransaksi(): string {
  const now = new Date();
  const tgl = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const rand = Math.floor(1000 + Math.random() * 9000); // 4 digit
  return `TRX-${tgl}-${rand}`;
}

const METODE_BAYAR_VALID = ['cash', 'transfer', 'qris', 'debit'] as const;
type MetodeBayar = (typeof METODE_BAYAR_VALID)[number];

interface PembayaranInput {
  metode: MetodeBayar;
  jumlah: number;
}

/**
 * Validasi & hitung ringkasan split payment (bisa 1 metode atau lebih).
 * Aturan bisnis: kelebihan bayar (kembalian) HANYA sah untuk metode 'cash',
 * karena QRIS/transfer/debit adalah nominal digital yang pasti (tidak ada
 * "kembalian" fisik). Jadi non-cash tidak boleh melebihi sisa tagihan
 * setelah dikurangi metode non-cash lain; cash yang menutup sisanya.
 */
function hitungSplitPayment(
  pembayaran: any,
  totalBayar: number
): { ok: true; entries: PembayaranInput[]; cashTotal: number; kembalian: number; metodeFinal: string } | { ok: false; error: string } {
  if (!Array.isArray(pembayaran) || pembayaran.length === 0) {
    return { ok: false, error: 'Rincian pembayaran wajib diisi (minimal 1 metode)' };
  }

  const entries: PembayaranInput[] = [];
  for (const p of pembayaran) {
    const metode = p?.metode;
    const jumlah = Number(p?.jumlah);
    if (!METODE_BAYAR_VALID.includes(metode)) {
      return { ok: false, error: `Metode pembayaran tidak valid: ${metode}` };
    }
    if (!Number.isFinite(jumlah) || jumlah <= 0) {
      return { ok: false, error: 'Setiap jumlah pembayaran harus berupa angka lebih besar dari 0' };
    }
    entries.push({ metode, jumlah });
  }

  const cashTotal = entries.filter((e) => e.metode === 'cash').reduce((s, e) => s + e.jumlah, 0);
  const nonCashTotal = entries.filter((e) => e.metode !== 'cash').reduce((s, e) => s + e.jumlah, 0);

  if (nonCashTotal > totalBayar + 0.01) {
    return {
      ok: false,
      error: 'Pembayaran non-tunai melebihi total tagihan — kembalian hanya berlaku untuk pembayaran tunai',
    };
  }

  const sisaSetelahNonCash = totalBayar - nonCashTotal;
  if (cashTotal < sisaSetelahNonCash - 0.01) {
    const kurang = sisaSetelahNonCash - cashTotal;
    return { ok: false, error: `Total pembayaran kurang Rp ${Math.ceil(kurang).toLocaleString('id-ID')}` };
  }

  const kembalian = Math.round((cashTotal - sisaSetelahNonCash) * 100) / 100;
  const metodeUnik = new Set(entries.map((e) => e.metode));
  const metodeFinal = metodeUnik.size > 1 ? 'split' : entries[0].metode;

  return { ok: true, entries, cashTotal, kembalian, metodeFinal };
}

/**
 * Versi ringan dari hitungSplitPayment() untuk pembayaran SEBAGIAN (DP preorder
 * atau pelunasan sisa preorder) — beda dari transaksi normal, di sini nominal
 * yang diterima BOLEH lebih kecil dari total tagihan (itu memang tujuannya:
 * baru bayar sebagian dulu). Tidak ada konsep "kembalian" karena kasir hanya
 * menerima persis sejumlah yang diinput (bukan uang pas/lebih untuk ditukar).
 * Validasi utamanya cuma: metode valid, tiap jumlah > 0, dan totalnya tidak
 * boleh melebihi batas atas (total tagihan untuk DP, atau sisa tagihan untuk
 * pelunasan) — supaya tidak ada nominal "nyasar" yang tercatat berlebih.
 */
function hitungPembayaranSebagian(
  pembayaran: any,
  batasAtas: number
): { ok: true; entries: PembayaranInput[]; cashTotal: number; metodeFinal: string; totalDiterima: number } | { ok: false; error: string } {
  if (!Array.isArray(pembayaran) || pembayaran.length === 0) {
    return { ok: false, error: 'Rincian pembayaran wajib diisi (minimal 1 metode)' };
  }
  const entries: PembayaranInput[] = [];
  for (const p of pembayaran) {
    const metode = p?.metode;
    const jumlah = Number(p?.jumlah);
    if (!METODE_BAYAR_VALID.includes(metode)) {
      return { ok: false, error: `Metode pembayaran tidak valid: ${metode}` };
    }
    if (!Number.isFinite(jumlah) || jumlah <= 0) {
      return { ok: false, error: 'Setiap jumlah pembayaran harus berupa angka lebih besar dari 0' };
    }
    entries.push({ metode, jumlah });
  }
  const totalDiterima = entries.reduce((s, e) => s + e.jumlah, 0);
  if (totalDiterima > batasAtas + 0.01) {
    return { ok: false, error: `Jumlah pembayaran melebihi batas (maks Rp ${Math.floor(batasAtas).toLocaleString('id-ID')})` };
  }
  const cashTotal = entries.filter((e) => e.metode === 'cash').reduce((s, e) => s + e.jumlah, 0);
  const metodeUnik = new Set(entries.map((e) => e.metode));
  const metodeFinal = metodeUnik.size > 1 ? 'split' : entries[0].metode;
  return { ok: true, entries, cashTotal, metodeFinal, totalDiterima };
}

// WIB = UTC+7. Semua kolom created_at disimpan UTC oleh SQLite/D1
// (datetime('now')). Helper ini menggeser waktu ke WIB SEBELUM dibandingkan
// per-tanggal, supaya laporan "hari ini"/filter tanggal tidak meleset untuk
// transaksi yang terjadi jam 00:00–06:59 WIB (yang secara UTC masih "kemarin").
// Catatan: hardcode +7 jam karena PRD fokus Indonesia (geo-restriction ID).
// Kalau nanti ekspansi ke zona waktu lain (WITA/WIT), ini perlu dibuat dinamis.
function wibDateExpr(column: string): string {
  return `date(datetime(${column}, '+7 hours'))`;
}

function todayWIB(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Jam (00-23) dalam WIB dari kolom datetime UTC — dipakai laporan jam ramai. */
function wibHourExpr(column: string): string {
  return `strftime('%H', datetime(${column}, '+7 hours'))`;
}

/**
 * Ambil produk berdasarkan ID, sekaligus validasi kepemilikan toko untuk
 * role admin_toko (agar admin toko A tidak bisa mengubah produk toko B).
 * super_admin bisa akses semua toko.
 */
async function getProdukAtauTolak(
  db: D1Database,
  id: string | number | undefined,
  session: { role: string; toko_id: number | null }
): Promise<{ produk: any } | { error: Response }> {
  if (!id) {
    return { error: Response.json({ success: false, error: 'ID produk tidak valid' }, { status: 400 }) };
  }
  const produk = await db.prepare('SELECT * FROM produk WHERE id = ?').bind(id).first<any>();
  if (!produk) {
    return { error: Response.json({ success: false, error: 'Produk tidak ditemukan' }, { status: 404 }) };
  }
  if (session.role !== 'super_admin' && produk.toko_id !== session.toko_id) {
    return { error: Response.json({ success: false, error: 'Produk ini bukan milik toko Anda' }, { status: 403 }) };
  }
  return { produk };
}

/**
 * Catat satu baris audit trail ke `log_aktivitas`. Dipanggil "fire and forget"
 * (tidak di-await secara blocking terhadap response) untuk aksi CRUD non-kritis
 * (produk/user/toko/kategori/pembatalan transaksi) — beda dari riwayat_stok yang
 * WAJIB atomik dengan mutasi stok. Gagal mencatat log TIDAK BOLEH menggagalkan
 * aksi utamanya, jadi errornya cukup di-swallow (di-log ke console saja).
 */
async function catatLog(
  db: D1Database,
  session: { uid: number; role: string; toko_id: number | null },
  aksi: 'tambah' | 'ubah' | 'nonaktifkan' | 'batalkan' | 'hapus' | 'lunasi',
  entitas: 'produk' | 'user' | 'toko' | 'kategori' | 'transaksi' | 'pengaturan',
  entitas_id: number | string | null | undefined,
  keterangan: string,
  usernamePelaku?: string
): Promise<void> {
  try {
    let username = usernamePelaku;
    if (!username) {
      const u = await db.prepare('SELECT username FROM users WHERE id = ?').bind(session.uid).first<any>();
      username = u?.username ?? `user#${session.uid}`;
    }
    await db
      .prepare(
        `INSERT INTO log_aktivitas (user_id, username, toko_id, aksi, entitas, entitas_id, keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(session.uid, username, session.toko_id ?? null, aksi, entitas, entitas_id ?? null, keterangan)
      .run();
  } catch (err) {
    console.error('Gagal mencatat log_aktivitas:', err);
  }
}
