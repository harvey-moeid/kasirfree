// ==========================================================
// crypto.js — Helper hash password (PBKDF2) murni Web Crypto API,
// dipakai di browser (mode lokal), tidak butuh library eksternal.
// Catatan: versi lama file ini (dipakai src/index.ts, backend cloud yang
// sekarang nonaktif) juga punya signToken/verifyToken untuk JWT cookie
// session. Di mode lokal tidak ada JWT/cookie sama sekali (lihat
// local-auth.js — sesi cuma flag di sessionStorage), jadi fungsi itu
// dibuang di sini karena memang tidak pernah dipanggil.
// ==========================================================
const PBKDF2_ITERATIONS = 100000;
function toBase64(bytes) {
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
}
function fromBase64(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function toHex(bytes) {
    return Array.from(new Uint8Array(bytes))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/** Bandingkan dua string hex secara timing-safe (mencegah timing attack). */
function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
/**
 * Hash password baru untuk disimpan ke DB (dipakai saat membuat/reset user).
 * Mengembalikan { hash, salt } — keduanya disimpan sebagai kolom terpisah.
 */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePBKDF2(password, salt);
    return { hash, salt: toBase64(salt) };
}
/** Verifikasi password saat login, membandingkan dengan hash+salt yang tersimpan. */
export async function verifyPassword(password, storedHash, storedSalt) {
    if (!storedHash || !storedSalt)
        return false;
    const salt = fromBase64(storedSalt);
    const computedHash = await derivePBKDF2(password, salt);
    return timingSafeEqual(computedHash, storedHash);
}
async function derivePBKDF2(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, keyMaterial, 256);
    return toHex(derivedBits);
}

