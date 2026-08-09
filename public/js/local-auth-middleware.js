// ==========================================================
// local-auth-middleware.js — Pengganti lib/auth-middleware.ts (Cloudflare
// cookie+JWT) untuk versi lokal. Tidak ada cookie/JWT/jaringan sama sekali:
// "sesi login" cuma flag di sessionStorage HP ini (lihat local-auth.js).
// BISA ADA LEBIH DARI 1 akun per HP (kelola lewat Admin → Kelola User),
// role beneran ditegakkan di sini (super_admin/admin_toko/kasir) — sama
// persis perilakunya dengan versi cloud (lib/auth-middleware.ts).
// ==========================================================
export async function requireAuth(c, next) {
    const unlocked = window.LocalAuth.isUnlocked();
    if (!unlocked) {
        return c.json({ success: false, error: 'Sesi tidak ditemukan, silakan login kembali' }, 401);
    }
    const session = await window.LocalAuth.getSession();
    if (!session) {
        return c.json({ success: false, error: 'Akun belum disiapkan' }, 401);
    }
    c.set('session', session);
    await next();
}
/** Tolak akses kalau role user yang sedang login tidak ada di daftar `roles`. */
export function requireRole(...roles) {
    return async (c, next) => {
        const session = c.get('session');
        if (!session || !roles.includes(session.role)) {
            return c.json({ success: false, error: 'Anda tidak memiliki akses untuk aksi ini' }, 403);
        }
        await next();
    };
}
