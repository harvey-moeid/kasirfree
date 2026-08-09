// ==========================================================
// register-sw.js — Registrasi Service Worker untuk app-shell offline
// (PWA). Sebelumnya inline script yang PERSIS SAMA diduplikasi di
// admin.html, index.html, dan login.html; sekarang satu file dipakai
// bertiga.
// ==========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Gagal mendaftarkan service worker:', err);
    });
  });
}
