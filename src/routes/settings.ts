import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';
import { catatLog } from '../lib/helpers';

const settingsRoutes = new Hono<AppEnv>();

// ==========================================================
// 4c. ROUTES: PENGATURAN APLIKASI (key/value global, mis. judul aplikasi)
// ==========================================================

// PUBLIC (tanpa requireAuth) — sengaja, karena halaman login perlu menampilkan
// judul aplikasi SEBELUM user login.
// Kunci pengaturan struk yang boleh diubah lewat PUT /api/settings, beserta
// nilai default-nya kalau belum pernah diisi di DB (mis. sebelum migrasi
// 0008 dijalankan). Satu sumber kebenaran dipakai baik oleh GET maupun PUT.
const STRUK_SETTING_DEFAULTS: Record<string, string> = {
  struk_footer: 'Terima kasih atas kunjungan Anda',
  struk_catatan: '',
  struk_lebar_kertas: '58',
  struk_tampilkan_alamat: '1',
  struk_tampilkan_antrian: '1',
  struk_footer_ikon: 'tidak',
  struk_qr_data: '',
};

settingsRoutes.get('/api/settings', async (c) => {
  const db = c.env.DB;
  const keys = ['app_title', ...Object.keys(STRUK_SETTING_DEFAULTS)];
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT key, value FROM pengaturan WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<any>();
  const map = new Map(results.map((r: any) => [r.key, r.value]));

  const data: Record<string, string> = { app_title: map.get('app_title') || 'muidsoft' };
  for (const [key, def] of Object.entries(STRUK_SETTING_DEFAULTS)) {
    data[key] = map.get(key) ?? def;
  }
  return c.json({ success: true, data });
});

settingsRoutes.put('/api/settings', requireAuth, requireRole('super_admin'), async (c) => {
  try {
    const db = c.env.DB;
    const session = c.get('session');
    const body = await c.req.json<any>();
    const { app_title } = body;
    if (!app_title || !String(app_title).trim()) {
      return c.json({ success: false, error: 'Judul aplikasi wajib diisi' }, 400);
    }
    const title = String(app_title).trim().slice(0, 60);

    // Kustomisasi struk — semua opsional, dipakai default kalau tidak dikirim.
    const lebarKertas = String(body.struk_lebar_kertas ?? STRUK_SETTING_DEFAULTS.struk_lebar_kertas).trim();
    if (!['58', '80'].includes(lebarKertas)) {
      return c.json({ success: false, error: 'Lebar kertas struk harus 58 atau 80 (mm)' }, 400);
    }
    const footer = String(body.struk_footer ?? STRUK_SETTING_DEFAULTS.struk_footer).trim().slice(0, 120);
    const catatan = String(body.struk_catatan ?? STRUK_SETTING_DEFAULTS.struk_catatan).trim().slice(0, 200);
    const tampilkanAlamat = String(body.struk_tampilkan_alamat ?? '1') === '1' ? '1' : '0';
    const tampilkanAntrian = String(body.struk_tampilkan_antrian ?? '1') === '1' ? '1' : '0';

    const footerIkon = String(body.struk_footer_ikon ?? STRUK_SETTING_DEFAULTS.struk_footer_ikon).trim();
    if (!['tidak', 'qr', 'judul'].includes(footerIkon)) {
      return c.json({ success: false, error: 'Ikon footer struk tidak valid' }, 400);
    }
    const qrData = String(body.struk_qr_data ?? STRUK_SETTING_DEFAULTS.struk_qr_data).trim().slice(0, 300);
    if (footerIkon === 'qr' && !qrData) {
      return c.json({ success: false, error: 'Data QR wajib diisi kalau ikon footer dipilih QR Code' }, 400);
    }

    const values: Record<string, string> = {
      app_title: title,
      struk_footer: footer,
      struk_catatan: catatan,
      struk_lebar_kertas: lebarKertas,
      struk_tampilkan_alamat: tampilkanAlamat,
      struk_tampilkan_antrian: tampilkanAntrian,
      struk_footer_ikon: footerIkon,
      struk_qr_data: qrData,
    };

    const statements = Object.entries(values).map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO pengaturan (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        )
        .bind(key, value)
    );
    await db.batch(statements);

    await catatLog(db, session, 'ubah', 'pengaturan', 'app_title', 'Mengubah pengaturan aplikasi & kustomisasi struk');
    return c.json({ success: true, data: values });
  } catch {
    return c.json({ success: false, error: 'Gagal menyimpan pengaturan' }, 400);
  }
});

export default settingsRoutes;
