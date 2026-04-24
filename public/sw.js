/**
 * Service worker — PWA (cacheo controlado para evitar assets stale).
 * Bumpear SW_CACHE al cambiar estrategia o precache.
 */
const SW_CACHE = 'ftth-gis-pwa-v14';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/editor.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/branding/login-logo.png',
  '/icons/pwa/icon-192.png',
  '/icons/pwa/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SW_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              /* un recurso opcional puede fallar en entornos sin ese archivo */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SW_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(SW_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            const path = url.pathname;
            const isEditor = path === '/editor.html' || path.endsWith('/editor.html');
            if (isEditor) {
              return caches.match('/editor.html', { ignoreSearch: true }).then((ed) => ed || caches.match('/index.html'));
            }
            return caches.match('/index.html');
          })
        )
    );
    return;
  }

  // Solo CSS/JS en “caliente”: si incluimos destination=document, editor.html (iframe, preview, etc.)
  // cae aquí, la red falla y no hay caché → 503 Offline en consola. El HTML sigue la rama general (caché + red).
  const isHotAsset = request.destination === 'style' || request.destination === 'script';
  if (isHotAsset) {
    // Red siempre; no guardar CSS/JS en caché (evita panel “atascado” con estilos viejos).
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        caches.match(request).then(
          (cached) => cached || new Response('', { status: 503, statusText: 'Offline' })
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const ok =
          response &&
          response.status === 200 &&
          (response.type === 'basic' || response.type === 'cors');
        if (!ok) return response;
        try {
          const copy = response.clone();
          caches.open(SW_CACHE).then((cache) => cache.put(request, copy));
        } catch {
          /* */
        }
        return response;
      }).catch(() => {
        /* Evita promesa rechazada en consola cuando la red falla. */
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
