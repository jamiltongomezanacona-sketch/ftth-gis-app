/**
 * Registra el service worker para instalación PWA (Chrome, Edge, Android).
 */
(function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* sin SW la app sigue funcionando; solo no será instalable como PWA */
    });
  });
})();
