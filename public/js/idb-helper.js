// ==========================================================
// idb-helper.js — Wrapper tipis di atas IndexedDB, dipakai untuk
// menyimpan file SQLite biner, gambar produk, dan data kecil lain
// SEPENUHNYA LOKAL di HP ini (tidak pernah dikirim ke server mana pun).
// ==========================================================

// PENTING: IDB_NAME adalah nama database IndexedDB SUNGGUHAN di browser —
// BUKAN teks branding. JANGAN PERNAH diubah walau brand/nama produk
// berganti (lihat rebrand ke "muidsoft") — mengubah string ini akan
// membuat SEMUA instalasi yang sudah pernah dipakai kehilangan akses ke
// data lama mereka (browser akan buat database baru yang kosong di bawah
// nama baru, data lama jadi orphan / tidak terbaca lagi).
const IDB_NAME = 'kasir_harvey_local';
const IDB_VERSION = 1;

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let idbPromise = null;
function getIdb() {
  if (!idbPromise) idbPromise = openIdb();
  return idbPromise;
}

async function idbGet(storeName, key) {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(storeName, key, value) {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAllKeys(storeName) {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(storeName) {
  const db = await getIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.IdbHelper = { idbGet, idbSet, idbDelete, idbAllKeys, idbClear };
