/**
 * Registro PWA (service worker) con activación inmediata.
 * No altera la lógica de la app; solo habilita caché/offline controlado.
 */
(function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // La nueva versión queda lista; no forzamos recarga para no interrumpir flujos.
            console.info('[PWA] Nueva versión disponible.');
          }
        });
      });
    } catch (err) {
      console.warn('[PWA] No se pudo registrar service worker:', err);
    }
  });
})();
