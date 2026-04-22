/**
 * PWA deshabilitada temporalmente:
 * - desregistra service workers existentes
 * - limpia caches creadas por SW
 */
(function disablePwa() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => {
        reg.unregister().catch(() => {});
      });
    }).catch(() => {});

    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys
          .filter((key) => key.startsWith('ftth-gis-pwa-'))
          .forEach((key) => {
            caches.delete(key).catch(() => {});
          });
      }).catch(() => {});
    }
  });
})();
