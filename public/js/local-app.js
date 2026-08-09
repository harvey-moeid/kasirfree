import { Hono } from './mini-hono.js';

import authRoutes from './routes/auth.js';
import produkRoutes from './routes/produk.js';
import bahanBakuRoutes from './routes/bahan-baku.js';
import uploadRoutes from './routes/upload.js';
import tokoRoutes from './routes/toko.js';
import settingsRoutes from './routes/settings.js';
import shiftRoutes from './routes/shift.js';
import transaksiRoutes from './routes/transaksi.js';
import laporanRoutes from './routes/laporan.js';
import preorderRoutes from './routes/preorder.js';
import usersRoutes from './routes/users.js';
import logAktivitasRoutes from './routes/log-aktivitas.js';

const app = new Hono();

// ==========================================================
// MIDDLEWARE GLOBAL
// ==========================================================
// (CORS & geo-restriction dibuang di versi lokal — semuanya jalan di dalam
// browser yang sama, tidak ada request lintas-origin maupun jaringan.)

// ==========================================================
// ROUTES (per domain, lihat public/js/routes/*.js)
// ==========================================================
// Setiap modul di routes/ adalah sub-router Hono independen; helper
// bersama (validasi split payment, format tanggal WIB, audit log, dst) ada
// di lib/helpers.js. local-app.js ini murni tempat merakit routernya.

app.route('/', authRoutes);
app.route('/', produkRoutes);
app.route('/', bahanBakuRoutes); // /api/bahan-baku, /api/resep
app.route('/', uploadRoutes); // /api/upload/produk, /api/gambar/*
app.route('/', tokoRoutes);
app.route('/', settingsRoutes); // /api/settings, /api/kategori
app.route('/', shiftRoutes);
app.route('/', transaksiRoutes);
app.route('/', laporanRoutes); // /api/laporan/harian, produk-terlaris, tren-penjualan, stok-menipis, margin, kombinasi-terlaris, jam-ramai, per-kasir
app.route('/', preorderRoutes); // /api/preorder, /api/laporan/piutang
app.route('/', usersRoutes);
app.route('/', logAktivitasRoutes);

// ==========================================================
// FALLBACK
// ==========================================================

app.notFound((c) => c.json({ success: false, error: 'Endpoint tidak ditemukan' }, 404));
app.onError((err, c) => {
    console.error(err);
    return c.json({ success: false, error: 'Kesalahan server internal' }, 500);
});

window.LocalApp = app;
window.dispatchEvent(new Event('local-app-loaded'));
