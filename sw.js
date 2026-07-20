// sw.js — service worker for offline use.
//
// Strategy: network-first with cache fallback. Online users always get the
// latest deployed files (no stale-version headaches); offline users get the
// last version this worker cached. Every successful fetch refreshes the cache.

const CACHE = 'kicad-sch-v1';

const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/sexpr.js',
  'js/model.js',
  'js/history.js',
  'js/library.js',
  'js/parts.js',
  'js/stdlib.js',
  'js/hershey.js',
  'js/strokefont.js',
  'js/renderer.js',
  'js/fprenderer.js',
  'js/fpeditor.js',
  'js/sample.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        // Navigations fall back to the cached app shell.
        return hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined);
      });
    })
  );
});
