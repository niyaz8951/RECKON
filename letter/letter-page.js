/* RECKON — Your week (the page).
   =============================================================================
   Reads the three apps' own data (each optional), builds the facts, and
   shows a letter: from the cache on this device first (it reads offline),
   then — with AI on — the model's version, checked against the facts, else
   the plain version written in code. The numbers it was written from sit
   under it, so nothing is taken on trust. */
(function () {
  'use strict';
  var L = window.TNLetter, $ = function (id) { return document.getElementById(id); }, esc = TN.esc;
  var LABELS = { money: 'Money', time: 'Time', decisions: 'Decisions' };

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function cacheKey(u, wk) { return 'reckon-letter:' + u.id + ':' + wk.key; }
  function readCache(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function writeCache(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked: it still shows */ } }
  function human(k) { return String(k).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

  function paint(v) {
    $('lt-loading').hidden = true;
    $('lt-letter').hidden = false;
    $('lt-letter').innerHTML = String(v.letter).split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    $('lt-sug').textContent = v.suggestion; $('lt-next').hidden = !v.suggestion;
    $('lt-by').hidden = false;
    $('lt-by').textContent = v.by === 'ai' ? 'Worded by AI from the numbers below, and checked: every figure in it is one of them.'
      : v.note || 'Written from the numbers below.';
    var F = v.facts || {}, h = '';
    ['money', 'time', 'decisions'].forEach(function (sec) {
      if (!F[sec]) return;
      h += '<div class="lt-dl__sec"><dt class="lt-dl__h">' + LABELS[sec] + '</dt>' + Object.keys(F[sec]).map(function (k) { return '<div class="lt-dl__row"><dt>' + esc(human(k)) + '</dt><dd>' + esc(F[sec][k]) + '</dd></div>'; }).join('') + '</div>';
    });
    $('lt-dl').innerHTML = h; $('lt-facts').hidden = !h;
  }

  async function load(path) { try { return await TN.api(path); } catch (e) { return null; } }

  async function boot() {
    var u = await TN.guard();
    TN.els('[data-icon]').forEach(function (el) { if (!el.innerHTML) el.innerHTML = TN.icon(el.getAttribute('data-icon'), 18); });
    var t = today(), wk = L.week(t), key = cacheKey(u, wk);
    $('lt-week').textContent = wk.label;
    var cached = readCache(key);
    if (cached) paint(cached);
    if (cached && (cached.by === 'ai' || !(window.TNAI && TNAI.on()))) { document.dispatchEvent(new CustomEvent('letter:ready')); return; }
    var res = await Promise.all([load('/api/kept/bootstrap'), load('/api/spent/bootstrap'), load('/api/decided/bootstrap')]);
    var F = L.facts({
      kept: res[0] && { rows: res[0].transactions, profile: res[0].profile },
      spent: res[1] && { days: res[1].days, profile: res[1].profile },
      decided: res[2] && { list: res[2].decisions }
    }, wk, t);
    var plain = Object.assign(L.plain(F), { by: 'code', facts: F });
    if (!cached) paint(plain);
    if (window.TNAI && TNAI.on() && (F.money || F.time || F.decisions)) {
      try {
        var v = await TNAI.letter(F, wk.key);
        var out = { letter: v.letter, suggestion: v.suggestion, by: 'ai', facts: F };
        writeCache(key, out); paint(out);
      } catch (e) {
        plain.note = 'AI did not answer (' + e.message.replace(/\.$/, '') + '), so this is the plain version, written from the numbers below.';
        paint(plain); writeCache(key, plain);
      }
    } else writeCache(key, plain);
    document.dispatchEvent(new CustomEvent('letter:ready'));
  }
  TN.ready(boot);
})();
