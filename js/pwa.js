/* Cosmic Keys — install as an app (home-screen icon, offline play) */
(function () {
  'use strict';

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline play just won't be available */ });
    });
  }

  var installed = false;
  try { installed = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches; } catch (e) { /* ignore */ }
  if (installed || navigator.standalone === true) return;

  var btn = document.getElementById('btn-install'), hint = document.getElementById('install-hint');
  var prompt = null;

  // Android / Chrome / Edge: offer our own Install button.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    prompt = e;
    btn.classList.remove('hidden');
  });
  btn.addEventListener('click', function () {
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.then(function () { prompt = null; btn.classList.add('hidden'); });
  });
  window.addEventListener('appinstalled', function () {
    btn.classList.add('hidden'); hint.classList.add('hidden');
  });

  // iPhone / iPad Safari has no install prompt: point to the Share menu instead.
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) hint.classList.remove('hidden');
})();
