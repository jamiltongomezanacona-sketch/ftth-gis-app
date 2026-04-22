/**
 * Registra el service worker para instalación PWA (Chrome, Edge, Android).
 */
(function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    let didRefresh = false;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            // Hay SW nuevo controlando assets: recarga una vez para tomar CSS/JS recientes.
            if (!didRefresh) {
              didRefresh = true;
              window.location.reload();
            }
          }
        });
      });
    }).catch(() => {
      /* sin SW la app sigue funcionando; solo no será instalable como PWA */
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!didRefresh) {
        didRefresh = true;
        window.location.reload();
      }
    });
  });
})();
