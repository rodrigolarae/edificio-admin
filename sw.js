// Vecinoo Service Worker v1
const CACHE_NAME = 'vecinoo-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Cache básico para que la app funcione offline
self.addEventListener('fetch', e => {
  // Solo cachear recursos del mismo origen (no APIs externas)
  if(!e.request.url.startsWith(self.location.origin)) return;
  if(e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        // Cachear solo respuestas válidas de recursos estáticos
        if(response && response.status === 200 && response.type === 'basic'){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
