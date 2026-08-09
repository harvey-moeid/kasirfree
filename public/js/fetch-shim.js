// ==========================================================
// fetch-shim.js — Jantung dari mode "full lokal". Semua kode lama di
// index.html/admin.html/login.html memanggil fetch('/api/...') seperti
// biasa (tidak diubah sama sekali) — script ini mencegat panggilan itu
// SEBELUM sampai ke jaringan dan mengarahkannya ke LocalApp (router yang
// jalan di browser, membaca/menulis IndexedDB HP ini). Request ke URL lain
// (font, cdn, dsb) tetap lewat jaringan seperti biasa.
// ==========================================================

const realFetch = window.fetch.bind(window);

function waitForLocalApp() {
  if (window.LocalApp) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener('local-app-loaded', () => resolve(), { once: true });
  });
}

window.LocalAppReady = (async () => {
  await window.LocalDBReady;
  await waitForLocalApp();
  const needsSetup = await window.LocalAuth.needsSetup();
  window.dispatchEvent(new CustomEvent('localapp-ready', { detail: { needsSetup } }));
  return { needsSetup };
})();

window.fetch = async function patchedFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  let pathname;
  try {
    pathname = new URL(url, window.location.href).pathname;
  } catch {
    pathname = '';
  }

  if (!pathname.startsWith('/api/')) {
    return realFetch(input, init);
  }

  await window.LocalAppReady;

  const request = input instanceof Request ? input : new Request(new URL(url, window.location.href).href, init);
  const env = { DB: window.LocalDB, IMAGES: window.LocalImages };
  return window.LocalApp.fetch(request, env);
};
