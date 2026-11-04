// public/sw.js

const CACHE_NAME = 'tempotrack-pwa-v13'; // Increment on every release that changes cached assets
const OFFLINE_URL = '/offline';

const PRECACHE_ASSETS = [
  '/',
  OFFLINE_URL,
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// --- INSTALL EVENT (Correct and Unchanged) ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(self.skipWaiting())
  );
});

// --- ACTIVATE EVENT (Correct and Unchanged) ---
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
    }).then(cachesToDelete => {
      return Promise.all(cachesToDelete.map(cacheToDelete => {
        return caches.delete(cacheToDelete);
      }));
    }).then(() => self.clients.claim())
  );
});

// --- FETCH EVENT (DEFINITIVELY SIMPLIFIED AND CORRECTED) ---
self.addEventListener('fetch', (event) => {
  // We only handle GET requests.
  if (event.request.method !== 'GET') {
    return;
  }

  // --- THIS IS THE CRITICAL FIX ---
  // Only handle requests for assets on our own domain.
  // Ignore all other requests (e.g., to Google APIs, Firebase, etc.).
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  // --- END OF FIX ---


  // STRATEGY 1: Network falling back to Cache for Page Navigations
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // STRATEGY 2: Cache First for all other local assets (JS, CSS, etc.)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Return from cache if found.
      if (cachedResponse) {
        return cachedResponse;
      }
      // If not in cache, go to the network and cache the result.
      return fetch(event.request).then(networkResponse => {
        if (networkResponse.ok) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});