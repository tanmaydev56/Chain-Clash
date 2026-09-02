const CACHE = 'chain-clash-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then(hit => hit || caches.match('/'))));
});
