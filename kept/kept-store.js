/* KEPT — the on-device snapshot.
   =============================================================================
   The last bootstrap payload this browser received, kept in IndexedDB under
   the user's id. On the next open the page draws from it in the same frame
   it appears, then asks the server and repaints only if something changed.
   That is the difference between "loading your record…" and an app that is
   simply there.

   Rules it follows:
   - keyed by user id, so a different account on the same browser never sees
     another's copy;
   - deleted on sign-out and on a forced sign-out (global.js clears every
     IndexedDB database as part of TN.clearLocal());
   - best effort throughout: a browser that blocks storage (private mode,
     cleared site data) simply gets the network path, never an error.
   The record of truth is still D1; this is a cache, not a store. */
(function (root) {
  'use strict';

  var DB = 'tn-kept', STORE = 'snapshots', VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('no indexedDB'));
      var req;
      try { req = root.indexedDB.open(DB, VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('open failed')); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function withStore(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), out;
        try { out = fn(st); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('transaction failed')); };
        tx.onabort = tx.onerror;
      });
    });
  }

  /* Resolves with the snapshot or null; never rejects. */
  function read(userId) {
    if (!userId) return Promise.resolve(null);
    return withStore('readonly', function (st) { return st.get(userId); })
      .then(function (v) { return v && v.savedAt ? v : null; })
      .catch(function () { return null; });
  }
  /* Fire-and-forget. */
  function write(userId, snap) {
    if (!userId || !snap) return Promise.resolve();
    var copy = Object.assign({}, snap, { savedAt: new Date().toISOString() });
    return withStore('readwrite', function (st) { return st.put(copy, userId); }).catch(function () {});
  }
  function clear() {
    return new Promise(function (resolve) {
      try { var r = root.indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = function () { resolve(); }; }
      catch (e) { resolve(); }
    });
  }

  root.KeptStore = { read: read, write: write, clear: clear, DB: DB };
})(typeof window !== 'undefined' ? window : globalThis);
