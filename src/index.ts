import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './lib/auth-middleware';

import authRoutes from './routes/auth';
import produkRoutes from './routes/produk';
import bahanBakuRoutes from './routes/bahan-baku';
import uploadRoutes from './routes/upload';
import tokoRoutes from './routes/toko';
import settingsRoutes from './routes/settings';
import shiftRoutes from './routes/shift';
import transaksiRoutes from './routes/transaksi';
import laporanRoutes from './routes/laporan';
import preorderRoutes from './routes/preorder';
import usersRoutes from './routes/users';
import logAktivitasRoutes from './routes/log-aktivitas';

const app = new Hono<AppEnv>();

// ==========================================================
// 1. MIDDLEWARE GLOBAL
// ==========================================================

// CORS harus di urutan PALING ATAS, sebelum middleware lain, agar preflight
// (OPTIONS) request tidak ikut diblokir oleh geo-restriction di bawah.
app.use('/*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.ALLOWED_ORIGIN ? c.env.ALLOWED_ORIGIN.split(',') : ['http://localhost:8787'],
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// Geo-Restriction (PRD Bagian 9) — dikontrol lewat env var ENFORCE_GEO agar
// bisa dimatikan saat testing/dev tanpa ubah kode. `cf` object hanya tersedia
// di edge Cloudflare sungguhan (undefined saat `wrangler dev` lokal), jadi
// tetap aman dipakai lokal walau ENFORCE_GEO="true".
app.use('/*', async (c, next) => {
  if (c.env.ENFORCE_GEO === 'true') {
    const country = (c.req.raw as any).cf?.country;
    if (country !== undefined && country !== 'ID') {
      return c.json({ success: false, error: 'Akses ditolak (restriksi geografis)' }, 403);
    }
  }
  await next();
});

// Root "/" tidak match file statis apa pun (html_handling = "none" sengaja
// mematikan auto-serve index.html di root, lihat catatan di wrangler.toml),
// jadi tanpa route eksplisit ini request ke domain polos jatuh ke
// app.notFound() dan menampilkan JSON "Endpoint tidak ditemukan" alih-alih
// membuka halaman login. Redirect biasa (bukan file dari cache SW) sehingga
// aman dari isu "redirected response" yang disebutkan di sw.js.
app.get('/', (c) => c.redirect('/login.html', 302));

// ==========================================================
// 2. ROUTES (per domain, lihat src/routes/*.ts)
// ==========================================================
// Setiap modul di src/routes/ adalah sub-router Hono independen; helper
// bersama (validasi split payment, format tanggal WIB, audit log, dst) ada
// di src/lib/helpers.ts. index.ts ini murni tempat merakit + middleware global.

// Mount di root: setiap modul route SUDAH mendefinisikan path absolutnya
// sendiri (mis. '/api/produk/:id'), jadi tidak ada prefix tambahan di sini
// (mencegah double-prefix seperti /api/produk/api/produk).
app.route('/', authRoutes);
app.route('/', produkRoutes);
app.route('/', bahanBakuRoutes); // /api/bahan-baku, /api/resep
app.route('/', uploadRoutes); // /api/upload/produk, /api/gambar/*
app.route('/', tokoRoutes); // /api/toko, /api/kategori
app.route('/', settingsRoutes);
app.route('/', shiftRoutes);
app.route('/', transaksiRoutes);
app.route('/', laporanRoutes);
app.route('/', preorderRoutes);
app.route('/', usersRoutes);
app.route('/', logAktivitasRoutes);

// ==========================================================
// 3. FALLBACK
// ==========================================================

app.notFound((c) => c.json({ success: false, error: 'Endpoint tidak ditemukan' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: 'Kesalahan server internal' }, 500);
});

export default app;
