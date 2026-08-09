import { Hono } from 'hono';
import { requireAuth, requireRole, type AppEnv } from '../lib/auth-middleware';

const uploadRoutes = new Hono<AppEnv>();

// ==========================================================
// 4a2. ROUTES: UPLOAD & SERVE FOTO PRODUK (Cloudflare R2)
//
// Admin bisa upload foto langsung dari perangkat (bukan cuma tempel URL
// eksternal). File disimpan di R2, lalu diserve lewat GET /api/gambar/:key
// dari Worker yang sama — jadi tidak perlu setup akses publik R2 terpisah
// (r2.dev subdomain / custom domain) dan tidak kena masalah CORS.
// ==========================================================

const GAMBAR_MIME_VALID: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const GAMBAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB — cukup besar untuk foto produk terkompresi, cukup kecil untuk edge cepat

// Kalau gambar_url mengarah ke foto yang kita simpan sendiri di R2
// (path /api/gambar/xxx), ambil key R2-nya. Kalau itu URL eksternal
// (https://...dari luar), return null — tidak ada yang perlu dibersihkan.
export function r2KeyDariGambarUrl(gambarUrl: string | null | undefined): string | null {
  if (!gambarUrl) return null;
  const m = gambarUrl.match(/^\/api\/gambar\/(.+)$/);
  return m ? m[1] : null;
}

uploadRoutes.post('/api/upload/produk', requireAuth, requireRole('super_admin', 'admin_toko'), async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!(file instanceof File)) {
      return c.json({ success: false, error: 'File tidak ditemukan (field "file" wajib diisi)' }, 400);
    }
    const ext = GAMBAR_MIME_VALID[file.type];
    if (!ext) {
      return c.json({ success: false, error: 'Format tidak didukung. Pakai JPG, PNG, atau WEBP.' }, 400);
    }
    if (file.size > GAMBAR_MAX_BYTES) {
      return c.json({ success: false, error: `Ukuran file maksimal 2MB (file ini ${(file.size / 1024 / 1024).toFixed(1)}MB)` }, 400);
    }

    const key = `produk/${crypto.randomUUID()}.${ext}`;
    await c.env.IMAGES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    return c.json({ success: true, gambar_url: `/api/gambar/${key}` }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: 'Gagal upload gambar' }, 500);
  }
});

// Publik (tanpa requireAuth) — supaya foto produk gampang ditampilkan lewat
// tag <img> biasa di mana saja (termasuk halaman cetak struk di tab baru)
// tanpa perlu ikut kirim cookie sesi. Key R2 sendiri sudah acak (UUID) jadi
// tidak bisa ditebak/di-enumerasi, dan isinya cuma foto produk, bukan data
// sensitif — jadi ini aman dipublikasikan.
uploadRoutes.get('/api/gambar/*', async (c) => {
  const key = c.req.path.replace(/^\/api\/gambar\//, '');
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ success: false, error: 'Gambar tidak ditemukan' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      // Immutable: key selalu UUID baru per upload, jadi aman di-cache lama-lama di browser/edge.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
      // FIX (defense-in-depth): cegah browser "menebak" tipe konten lain dari
      // Content-Type yang sudah eksplisit di atas (mis. kalau ada file yang lolos
      // whitelist MIME saat upload tapi isinya bukan gambar sungguhan).
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default uploadRoutes;
