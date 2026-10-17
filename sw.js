/**
 * RECKON service worker (GitHub Pages + Supabase).
 *
 * Supabase is another origin, so every data request passes straight through
 * this worker untouched (see "Someone else's origin" below): the worker can
 * only ever hold the site's own empty pages and its scripts, never a byte of
 * anyone's data.
 * =============================================================================
 * What this caches, and what it refuses to.
 *
 * Two kinds of thing come off this origin:
 *
 *   1. The shell — HTML pages, CSS, JS, fonts, icons. None of it contains a
 *      single byte about the signed-in person: every page is an empty frame
 *      that asks Supabase for its data after it loads, and every page is behind
 *      TN.guard(), which sends a signed-out visitor to the sign-in page.
 *      So the shell is cached, and the app opens from the home screen in
 *      one frame instead of waiting for the network.
 *
 *   2. The data — everything from Supabase. Account-specific, several routes
 *      single-use, and a cached copy would outlive the session that fetched
 *      it (clearing a cookie does not clear the Cache API). Never cached,
 *      never even looked at here.
 *
 * Pages are served stale-while-revalidate: the cached copy answers at once,
 * the network copy replaces it in the background for next time. Assets are
 * cache-first because the markup versions them with ?v= — a changed file
 * arrives under a new URL. Sign-out empties every cache, which is what keeps
 * a shared device honest even though the shell holds nothing personal.
 */

const VERSION = 'ssd-hub-v13';   // runs under a sub-path (GitHub project site)

/* Where the site lives: '/' on its own domain, '/Reckon/' on a GitHub
   project site. The worker sits at the site root, so its own folder is the
   base. Every path below is written site-relative and resolved with U(). */
const BASE = new URL('./', self.location).pathname;
const U = (p) => BASE + String(p).replace(/^\/+/, '');
/* Other sites can share this origin (every github.io project of one account
   does), so this worker only ever deletes caches it made itself. */
const OURS = (k) => k.indexOf('ssd-hub-') === 0 || k.indexOf('tn-hub-') === 0 || k.indexOf('ssd-dict-') === 0;
const STATIC = VERSION + '-static';
const PAGES = VERSION + '-pages';
const OFFLINE_URL = U('offline.html');

/* Enough to open every app cold. Each entry is added on its own so one
   miss costs only that file, not the whole install. */
const PRECACHE = [
  '/offline.html',
  '/', '/kept/', '/kept/settings/', '/spent/', '/decided/', '/letter/', '/account/',
  // Exactly as the pages reference them, ?v= included, so the cache key
  // matches. The shell test fails if one of these drifts from the markup.
  '/assets/css/global.css?v=37',
  '/assets/js/config.js?v=2',
  '/assets/vendor/supabase.js?v=1',
  '/assets/js/db.js?v=3',
  '/assets/js/routes-core.js?v=4',
  '/assets/js/global.js?v=39',
  '/assets/js/pwa.js?v=5',
  '/assets/js/deck.js?v=2',
  '/assets/js/cards.js?v=1',
  '/assets/js/ai.js?v=1',
  '/assets/js/letter.js?v=1',
  '/supabase/functions/_shared/ai-contract.js?v=1',
  '/kept/kept-recur.js?v=1',
  '/letter/letter-page.js?v=1',
  '/kept/kept.css?v=5',
  '/kept/kept-engine.js?v=1',
  '/kept/kept-core.js?v=1',
  '/kept/kept-data.js?v=2',
  '/kept/kept-store.js?v=1',
  '/kept/kept-import.js?v=2',
  '/kept/kept.js?v=6',
  '/spent/spent.css?v=4',
  '/spent/spent-engine.js?v=2',
  '/spent/spent-model.js?v=1',
  '/spent/spent-data.js?v=3',
  '/spent/spent.js?v=4',
  '/decided/decided.css?v=3',
  '/decided/decided-engine.js?v=2',
  '/decided/decided-data.js?v=1',
  '/decided/decided.js?v=2',
  '/assets/icons/icon-192.png'
].map(U);

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC).then((cache) => Promise.all(
        PRECACHE.filter((u) => /\.[a-z0-9]+(\?|$)/i.test(u) || u === OFFLINE_URL)
          .map((url) => cache.add(url).catch(() => null))
      )),
      caches.open(PAGES).then((cache) => Promise.all(
        PRECACHE.filter((u) => !/\.[a-z0-9]+(\?|$)/i.test(u) && u !== OFFLINE_URL)
          .map((url) => fetch(url, { credentials: 'same-origin' })
            .then((res) => { if (cacheablePage(res)) return cache.put(url, res); })
            .catch(() => null))
      ))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => OURS(k) && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Sign-out has to empty the cache. A cookie is cleared by the server; the
   Cache API is not. assets/js/global.js posts this before it navigates. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TN_SIGNED_OUT') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(OURS).map((k) => caches.delete(k)))));
  }
});

/* Static: anything under /assets/, and an app's own scripts and styles
   (/kept/kept.js?v=6) — those are versioned by ?v= in the markup like
   everything under /assets/, so a changed file arrives under a new URL. */
function isStaticAsset(url) {
  if (!/\.(css|js|mjs|png|svg|jpg|jpeg|webp|ico|woff2?|ttf)$/i.test(url.pathname)) return false;
  if (url.pathname === U('sw.js')) return false;
  return url.pathname.startsWith(U('assets/')) || /(^|&)v=\d+/.test(url.search.slice(1));
}

/* A page is cacheable only when it is the page itself: a 200, HTML, and
   not the result of a redirect. A signed-out request for /kept/ redirects
   to the sign-in form — caching that under /kept/ would pin the sign-in
   page onto an app URL. */
function cacheablePage(res) {
  return !!res && res.ok && res.status === 200 && !res.redirected && res.type === 'basic' &&
    /text\/html/i.test(res.headers.get('Content-Type') || '');
}

/* Pages are keyed by path alone: ?next=… and #screen do not change the
   shell that is served. */
function pageKey(url) { return url.origin + url.pathname; }

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET. A cached POST would be a replayed action, which is worse than
  // a failed one.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Someone else's origin is not ours to cache or to reason about.
  if (url.origin !== self.location.origin) return;
  // Nor is a neighbouring site on the same origin (another github.io project).
  if (!url.pathname.startsWith(BASE)) return;

  // Never touch the API. Every response under it is account-specific, and
  // several are single-use.
  if (url.pathname.startsWith(U('api/'))) return;

  if (isStaticAsset(url)) {
    // Cache-first: these are versioned by ?v= in the markup, so a changed file
    // arrives under a new URL rather than needing revalidation.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if (req.mode === 'navigate') {
    // The sign-in pages are always live: they are where the server says
    // "pending", "suspended" or "already signed in elsewhere" in words.
    if (url.pathname.startsWith(U('login/')) || url.pathname.startsWith(U('signup/'))) {
      event.respondWith(fetch(req).catch(() => offline()));
      return;
    }
    // Stale-while-revalidate: answer from the cache if we have the page,
    // and refresh the cached copy from the network either way.
    event.respondWith(
      caches.open(PAGES).then(async (cache) => {
        const key = pageKey(url);
        const hit = await cache.match(key);
        const refresh = fetch(req).then((res) => {
          if (cacheablePage(res)) cache.put(key, res.clone());
          return res;
        });
        if (hit) { event.waitUntil(refresh.catch(() => null)); return hit; }
        return refresh.catch(() => offline());
      })
    );
  }
});

/* The offline page is served in place of whatever page failed, so its
   relative links (assets/css/global.css) would resolve against that page's
   folder. A <base> pointing at the site root puts them back. */
function offline() {
  return caches.match(OFFLINE_URL).then(
    (hit) => hit ? hit.text().then((html) => new Response(
      html.replace(/<head>/i, '<head><base href="' + BASE + '">'),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    )) : new Response(
      '<h1>Offline</h1><p>Reconnect and try again.</p>',
      { headers: { 'Content-Type': 'text/html' }, status: 503 }
    )
  );
}
