/**
 * SIH26074 - GramMausam
 * Service Worker for PWA Offline Caching & Network-First Forecast Sync
 */

const CACHE_NAME = 'gram-mausam-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './privacy.html',
  './manifest.json',
  './icon.svg',
  './css/tokens.css',
  './css/glass.css',
  './css/layout.css',
  './js/config.js',
  './js/i18n.js',
  './js/auth.js',
  './js/weather-api.js',
  './js/downscale.js',
  './js/advice.js',
  './js/panchayats.js',
  './js/map.js',
  './js/theme.js',
  './js/sky.js',
  './js/router.js',
  './js/app.js',
  './i18n/en.json',
  './i18n/hi.json',
  './data/panchayats.json',
  './data/elevation_grid.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Forecast API data: network-first with cache fallback
  if (e.request.url.includes('api.open-meteo.com')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, respClone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell & static assets: cache-first with network fallback
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => cached))
  );
});
