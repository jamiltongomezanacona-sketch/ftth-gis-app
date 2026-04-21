/**
 * Service worker — PWA (caché ligera del shell; APIs siempre en red).
 * Bumpear SW_CACHE al cambiar la lista de precache.
 */
const SW_CACHE = 'ftth-gis-pwa-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
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
      fetch(request).catch(() => caches.match('/index.html'))
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
      });
    })
  );
});
