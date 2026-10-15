/**
 * PWA glue: registration, the install prompt, and standalone detection.
 * =============================================================================
 * Loaded on every page after global.js. Everything here degrades to nothing if
 * the browser has no service worker support — the site works exactly as it did
 * before, which is the only acceptable failure mode for a progressive layer.
 */
(function () {
  'use strict';

  // Running from the home screen rather than a browser tab. Used to drop
  // browser-only affordances (an install button you cannot act on) and to let
  // CSS reclaim the space a URL bar used to take.
  var standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (standalone) document.documentElement.setAttribute('data-standalone', 'true');

  /* ── Registration ──────────────────────────────────────────────────── */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // The worker and its scope follow the site's base path, so on a
      // github.io project site it controls /Reckon/ and nothing else.
      navigator.serviceWorker.register(window.TN.url('sw.js'), { scope: window.TN.base }).catch(function (err) {
        // A failed registration is not worth interrupting anyone over: the
        // site is fully functional without it.
        console.log('service worker registration failed:', err && err.message);
      });
    });

    /* Sign-out must empty the cache. The server clears the cookie; it cannot
       clear the Cache API, and a cached stylesheet is harmless while a cached
       anything-else is not. global.js fires this before it navigates. */
    document.addEventListener('tn:signout', function () {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'TN_SIGNED_OUT' });
      }
    });
  }

  /* ── Install prompt ────────────────────────────────────────────────── */
  /* Chrome offers installation through beforeinstallprompt. The event is
     held and the Account page shows an "Install the app" row while it is
     available (the header used to carry a button, which made the phone
     header wider than the screen). iOS never fires it; Account explains
     Share → Add to Home Screen there instead. */

  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferred = ev;
    document.dispatchEvent(new CustomEvent('tn:installable', { detail: { available: true } }));
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    try { localStorage.setItem('tn-installed', '1'); } catch (e) {}
    document.dispatchEvent(new CustomEvent('tn:installable', { detail: { available: false } }));
  });

  function install() {
    if (!deferred) return Promise.resolve('unavailable');
    var ev = deferred;
    ev.prompt();
    return ev.userChoice.then(function (choice) {
      deferred = null;
      document.dispatchEvent(new CustomEvent('tn:installable', { detail: { available: false } }));
      return choice.outcome;
    });
  }

  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.TNPWA = {
    standalone: standalone,
    ios: ios,
    canInstall: function () { return !!deferred; },
    install: install
  };
})();
