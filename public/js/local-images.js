// ==========================================================
// local-images.js — Pengganti Cloudflare R2 (bucket gambar) sepenuhnya
// lokal di HP ini, memakai IndexedDB. API method-nya sengaja dibuat
// mirip R2Bucket (put/get/delete) supaya kode di local-app.js (hasil
// port src/index.ts) hampir tidak perlu diubah.
// ==========================================================

(function () {
const { idbGet, idbSet, idbDelete, idbAllKeys } = window.IdbHelper;
const { toBase64, fromBase64 } = window.Base64Util;

class LocalImages {
  async put(key, arrayBuffer, options) {
    const contentType = options?.httpMetadata?.contentType || 'application/octet-stream';
    await idbSet('images', key, { contentType, data: arrayBuffer, savedAt: Date.now() });
    return { key };
  }

  async get(key) {
    const row = await idbGet('images', key);
    if (!row) return null;
    return {
      body: row.data, // ArrayBuffer — dipakai langsung sebagai body Response
      httpMetadata: { contentType: row.contentType },
      httpEtag: `"${key}"`,
    };
  }

  async delete(key) {
    await idbDelete('images', key);
  }

  /** Dipakai fitur backup: ambil semua gambar sebagai base64 untuk dimasukkan ke file ekspor. */
  async exportAll() {
    const keys = await idbAllKeys('images');
    const out = [];
    for (const key of keys) {
      const row = await idbGet('images', key);
      if (!row) continue;
      out.push({ key, contentType: row.contentType, base64: toBase64(row.data) });
    }
    return out;
  }

  /** Dipakai fitur restore: tulis ulang semua gambar dari hasil exportAll(). */
  async importAll(images) {
    for (const img of images) {
      await idbSet('images', img.key, { contentType: img.contentType, data: fromBase64(img.base64), savedAt: Date.now() });
    }
  }
}

window.LocalImages = new LocalImages();

})();
