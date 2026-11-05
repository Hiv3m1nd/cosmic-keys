/* Cosmic Keys — offline cache so the installed app opens without a connection */
'use strict';
var CACHE = 'cosmic-keys-v1';
var FILES = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'css/style.css',
  'fonts/cinzel-latin.woff2', 'fonts/jersey10-latin.woff2', 'fonts/lobster-latin.woff2', 'fonts/outfit-latin.woff2',
  'js/util.js', 'js/motion.js', 'js/view3d.js', 'js/theory.js', 'js/content.js', 'js/levels.js', 'js/audio.js',
  'js/pitch.js', 'js/portraits.js', 'js/world.js', 'js/glworld.js', 'js/titleart.js', 'js/monster.js',
  'js/hands.js', 'js/glhands.js', 'js/glmonsters.js', 'js/scene.js', 'js/game.js', 'js/ui.js', 'js/main.js',
  'js/pwa.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Serve from the cache straight away, and refresh it in the background so updates arrive on the next launch.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) c.put(req, res.clone()).catch(function () {});
        return res;
      });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net.catch(function () { return req.mode === 'navigate' ? c.match('index.html') : Response.error(); });
    });
  }));
});
