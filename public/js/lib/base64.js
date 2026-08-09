// ==========================================================
// base64.js — Konversi ArrayBuffer <-> base64, dipakai untuk simpan/muat
// data biner (database SQLite, gambar produk) lewat IndexedDB/JSON.
// Dipisah ke sini karena sebelumnya persis sama duplikat di
// local-backup.js dan local-images.js.
// Pakai chunking (bukan String.fromCharCode.apply langsung ke seluruh
// array) supaya tidak overflow call stack untuk file besar.
//
// Classic script (bukan ES module) — dimuat via <script src="...">
// biasa sebelum local-images.js/local-backup.js, sama pola dengan
// idb-helper.js. Diekspos lewat window.Base64Util.
// ==========================================================

(function () {

function toBase64(arrayBuffer) {
  let bin = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

window.Base64Util = { toBase64, fromBase64 };

})();
