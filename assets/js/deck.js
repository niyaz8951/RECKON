/* RECKON — deck.js: one full-screen card at a time.
   =============================================================================
   Shared by every app that asks a few quick questions (SPENT's check-in
   first). A stack of cards; the top one is the only thing on screen.

     question   swipe right = yes, left = no, up = skip — and three equal
                buttons that do the same, for anyone who would rather tap
     dial       a number on a ring you drag round, three presets, Set / Skip
     info       a line to read; Done
     action     an offer; Not now / the action

   It never decides anything: every answer goes to the page through
   onAnswer, which may add cards (a "no" opens a dial). When the stack runs
   out, onDone returns the one-line summary card. Reduced motion: cards fade
   instead of flying. Haptics: a short tick where the device has them.

     var deck = TNDeck.open({
       label: 'Check in',
       cards: [{ id, kind: 'question', title, reason }],
       onAnswer: function (card, answer, deck) {},   // 'yes' | 'no' | 'skip' | {value} | 'action' | 'dismiss'
       onDone: function (deck) { return { title, body, actions: [{ label, value, primary }] } },
       onClose: function (how, deck) {}            // 'done' | 'closed'
     });
     deck.insertNext(card); deck.push(card); deck.clear(); deck.close();

   No framework, no dependency beyond TN.icon/TN.esc when present. */
(function (root) {
  'use strict';
  var doc = root.document;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function icon(n, s) { return root.TN && root.TN.icon ? root.TN.icon(n, s || 20) : ''; }
  function reduced() { try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function tick(ms) { try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(ms || 8); } catch (e) {} }
  function hm(min) {
    min = Math.round(Number(min) || 0);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h' + (m ? ' ' + (m < 10 ? '0' : '') + m + 'm' : '') : m + 'm';
  }

  var THRESH_X = 0.28;      // share of card width that commits a sideways swipe
  var THRESH_Y = 0.2;       // share of card height that commits an up swipe
  var FLICK = 0.55;         // px/ms that commits regardless of distance

  function open(o) {
    o = o || {};
    var queue = (o.cards || []).slice(), done = [], current = null, closed = false, busy = false;
    var lastFocus = doc.activeElement;
    var motion = !reduced();

    var el = doc.createElement('div');
    el.className = 'deck' + (motion ? '' : ' deck--reduced');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', o.label || 'Questions');
    el.innerHTML = '<div class="deck__top"><div class="deck__dots" aria-hidden="true"></div>' +
      '<button type="button" class="deck__close" data-deck="close" aria-label="Close">' + (icon('x', 22) || '×') + '</button></div>' +
      '<div class="deck__stage"></div><div class="deck__foot"></div>' +
      '<p class="deck__live sr-only" aria-live="polite"></p>';
    doc.body.appendChild(el);
    doc.documentElement.classList.add('deck-open');
    var stage = el.querySelector('.deck__stage'), foot = el.querySelector('.deck__foot'), dots = el.querySelector('.deck__dots'), live = el.querySelector('.deck__live');

    var api = {
      el: el, answers: [],
      insertNext: function (card) { queue.unshift(card); paintDots(); },
      push: function (card) { queue.push(card); paintDots(); },
      /* Drop every card still waiting (a "yes, usual day" ends the deck). */
      clear: function () { queue.length = 0; paintDots(); },
      close: function () { finish('closed'); },
      get current() { return current; }
    };

    function paintDots() {
      var n = done.length + (current ? 1 : 0) + queue.length;
      var h = '';
      for (var i = 0; i < n; i++) h += '<i class="' + (i < done.length ? 'is-done' : i === done.length ? 'is-on' : '') + '"></i>';
      dots.innerHTML = n > 1 ? h : '';
    }

    function cardHTML(c) {
      var h = '<article class="deck-card deck-card--' + esc(c.kind) + '" data-id="' + esc(c.id || '') + '" tabindex="-1" aria-labelledby="deck-t">';
      if (c.kind === 'question') h += '<span class="deck-card__hint deck-card__hint--yes" aria-hidden="true">' + esc(c.yes || 'Yes') + '</span><span class="deck-card__hint deck-card__hint--no" aria-hidden="true">' + esc(c.no || 'No') + '</span><span class="deck-card__hint deck-card__hint--skip" aria-hidden="true">Skip</span>';
      h += '<div class="deck-card__body">';
      if (c.icon) h += '<span class="deck-card__icon" aria-hidden="true">' + icon(c.icon, 28) + '</span>';
      if (c.eyebrow) h += '<p class="deck-card__eyebrow">' + esc(c.eyebrow) + '</p>';
      h += '<h2 id="deck-t" class="deck-card__title">' + esc(c.title) + '</h2>';
      if (c.body) h += '<p class="deck-card__text">' + esc(c.body) + '</p>';
      if (c.kind === 'dial') h += dialHTML(c);
      h += '</div>';
      if (c.reason) h += '<p class="deck-card__reason">' + esc(c.reason) + '</p>';
      return h + '</article>';
    }
    function footHTML(c) {
      if (c.kind === 'question') return '<button type="button" class="deck-btn deck-btn--no" data-deck="no">' + esc(c.no || 'No') + '</button>' +
        '<button type="button" class="deck-btn deck-btn--skip" data-deck="skip">Skip</button>' +
        '<button type="button" class="deck-btn deck-btn--yes" data-deck="yes">' + esc(c.yes || 'Yes') + '</button>';
      if (c.kind === 'dial') return '<button type="button" class="deck-btn deck-btn--skip" data-deck="skip">Skip</button><button type="button" class="deck-btn deck-btn--yes" data-deck="set">Set</button>';
      if (c.kind === 'action') return '<button type="button" class="deck-btn deck-btn--skip" data-deck="dismiss">' + esc(c.dismiss || 'Not now') + '</button><button type="button" class="deck-btn deck-btn--yes" data-deck="action">' + esc(c.action || 'Do it') + '</button>';
      var acts = c.actions && c.actions.length ? c.actions : [{ label: 'Done', value: 'done', primary: true }];
      return acts.map(function (a, i) { return '<button type="button" class="deck-btn ' + (a.primary ? 'deck-btn--yes' : 'deck-btn--skip') + '" data-deck="info" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('');
    }

    /* ------------------------------------------------------------ dial */
    var R = 42, C = 2 * Math.PI * R;
    function dialHTML(c) {
      var p = (c.presets || []).slice(0, 3);
      return '<div class="deck-dial">' +
        '<div class="deck-dial__ring" role="slider" tabindex="0" aria-label="' + esc(c.title) + '" aria-valuemin="0" aria-valuemax="' + c.max + '" aria-valuenow="' + c.value + '" aria-valuetext="' + esc(fmt(c, c.value)) + '">' +
        '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="deck-dial__track" cx="50" cy="50" r="' + R + '"/>' +
        '<circle class="deck-dial__fill" cx="50" cy="50" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" transform="rotate(-90 50 50)"/>' +
        '<circle class="deck-dial__knob" r="5" cx="50" cy="' + (50 - R) + '"/></svg>' +
        '<output class="deck-dial__v"></output></div>' +
        (p.length ? '<div class="deck-dial__presets">' + p.map(function (m) { return '<button type="button" class="deck-chip" data-preset="' + m + '">' + esc(fmt(c, m)) + '</button>'; }).join('') + '</div>' : '') + '</div>';
    }
    function fmt(c, v) { return c.format ? c.format(v) : hm(v); }
    function setDial(card, v, quiet) {
      var c = card.data, step = c.step || 5;
      v = Math.max(c.min || 0, Math.min(c.max, Math.round(v / step) * step));
      var prev = c.value; c.value = v;
      var ring = card.node.querySelector('.deck-dial__ring');
      var f = c.max ? v / c.max : 0, ang = f * 2 * Math.PI;
      card.node.querySelector('.deck-dial__fill').setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(2));
      var k = card.node.querySelector('.deck-dial__knob');
      k.setAttribute('cx', (50 + R * Math.sin(ang)).toFixed(2)); k.setAttribute('cy', (50 - R * Math.cos(ang)).toFixed(2));
      card.node.querySelector('.deck-dial__v').textContent = fmt(c, v);
      ring.setAttribute('aria-valuenow', v); ring.setAttribute('aria-valuetext', fmt(c, v));
      card.node.querySelectorAll('[data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-preset') === v)); });
      // A tick on each whole hour crossed, the way a picker clicks.
      if (!quiet && Math.floor(prev / 60) !== Math.floor(v / 60)) tick(5);
    }
    function wireDial(card) {
      var ring = card.node.querySelector('.deck-dial__ring'), c = card.data, drag = null;
      function angleAt(e) {
        var r = ring.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var a = Math.atan2(e.clientX - cx, cy - e.clientY);   // 0 at the top, clockwise
        return a < 0 ? a + 2 * Math.PI : a;
      }
      ring.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        drag = { a: angleAt(e), v: c.value };
        // A tap on the ring jumps there; a drag goes round from there.
        setDial(card, angleAt(e) / (2 * Math.PI) * c.max);
        drag.v = c.value; drag.a = angleAt(e);
        try { ring.setPointerCapture(e.pointerId); } catch (x) {}
      });
      ring.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var a = angleAt(e), d = a - drag.a;
        if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;   // unwrap: no jump at the top
        drag.a = a; drag.v = Math.max(0, Math.min(c.max, drag.v + d / (2 * Math.PI) * c.max));
        setDial(card, drag.v);
      });
      var stop = function () { drag = null; };
      ring.addEventListener('pointerup', stop); ring.addEventListener('pointercancel', stop);
      ring.addEventListener('keydown', function (e) {
        var step = c.step || 5, big = 60;
        var m = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big };
        if (e.key in m) { e.preventDefault(); e.stopPropagation(); setDial(card, c.value + m[e.key]); }
        else if (e.key === 'Home') { e.preventDefault(); setDial(card, 0); }
        else if (e.key === 'End') { e.preventDefault(); setDial(card, c.max); }
      });
      card.node.querySelectorAll('[data-preset]').forEach(function (b) {
        b.addEventListener('click', function () { setDial(card, +b.getAttribute('data-preset')); tick(6); });
      });
      setDial(card, c.value || 0, true);
    }

    /* ----------------------------------------------------------- swipe */
    function wireSwipe(card) {
      var n = card.node, g = null;
      n.addEventListener('pointerdown', function (e) {
        if (busy || (e.button != null && e.button > 0)) return;
        g = { x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0, id: e.pointerId };
        n.classList.add('is-dragging');
        try { n.setPointerCapture(e.pointerId); } catch (x) {}
      });
      n.addEventListener('pointermove', function (e) {
        if (!g) return;
        g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
        var dir = intent(g, n);
        if (motion) n.style.transform = 'translate(' + g.dx + 'px,' + Math.min(g.dy, 40) + 'px) rotate(' + (g.dx * 0.04) + 'deg)';
        n.setAttribute('data-intent', dir.dir || '');
        n.style.setProperty('--p', dir.p.toFixed(2));
      });
      function end(e) {
        if (!g) return;
        var gg = g; g = null;
        n.classList.remove('is-dragging');
        var dir = intent(gg, n), dt = Math.max(1, Date.now() - gg.t);
        var vx = gg.dx / dt, vy = gg.dy / dt;
        var commit = dir.p >= 1 ? dir.dir : Math.abs(vx) > FLICK && Math.abs(gg.dx) > 24 ? (vx > 0 ? 'yes' : 'no') : (-vy > FLICK && -gg.dy > 24 ? 'skip' : null);
        if (commit && e.type !== 'pointercancel') answer(commit, { dx: gg.dx, dy: gg.dy });
        else { n.removeAttribute('data-intent'); n.style.removeProperty('--p'); n.classList.add('is-springing'); n.style.transform = ''; setTimeout(function () { n.classList.remove('is-springing'); }, 380); }
      }
      n.addEventListener('pointerup', end);
      n.addEventListener('pointercancel', end);
    }
    function intent(g, n) {
      var r = n.getBoundingClientRect(), w = r.width || 320, h = r.height || 420;
      var px = Math.abs(g.dx) / (w * THRESH_X), py = -g.dy / (h * THRESH_Y);
      if (py > px && g.dy < 0) return { dir: 'skip', p: Math.min(1, py) };
      if (Math.abs(g.dx) > 4) return { dir: g.dx > 0 ? 'yes' : 'no', p: Math.min(1, px) };
      return { dir: null, p: 0 };
    }

    /* ---------------------------------------------------------- answer */
    function answer(a, from) {
      if (busy || !current || closed) return;
      busy = true;
      var card = current, c = card.data;
      var value = a;
      if (c.kind === 'dial') value = a === 'skip' ? 'skip' : { value: c.value };
      else if (c.kind === 'info') value = a;
      tick(a === 'skip' || a === 'dismiss' ? 4 : 10);
      api.answers.push({ id: c.id, card: c, answer: value });
      live.textContent = typeof value === 'string' ? value : fmt(c, value.value);
      leave(card, a, from, function () {
        done.push(c); current = null;
        var ret;
        try { if (o.onAnswer && c.kind !== 'summary') ret = o.onAnswer(c, value, api); } catch (err) { if (root.console) console.error(err); }
        Promise.resolve(ret).then(function () { busy = false; next(); });
      });
    }
    function leave(card, a, from, then) {
      var n = card.node;
      if (!motion) { n.classList.add('is-leaving'); setTimeout(function () { n.remove(); then(); }, 120); return; }
      var w = (root.innerWidth || 400) * 1.3, h = (root.innerHeight || 800);
      var to = a === 'yes' || a === 'set' || a === 'action' ? 'translate(' + w + 'px,' + ((from && from.dy) || 0) + 'px) rotate(18deg)'
        : a === 'no' ? 'translate(' + (-w) + 'px,' + ((from && from.dy) || 0) + 'px) rotate(-18deg)'
        : a === 'skip' ? 'translate(' + ((from && from.dx) || 0) + 'px,' + (-h) + 'px)' : 'scale(.9)';
      n.classList.add('is-flying');
      n.style.transform = to; n.style.opacity = '0';
      setTimeout(function () { n.remove(); then(); }, 260);
    }

    function show(c) {
      var node = doc.createElement('div');
      node.innerHTML = cardHTML(c);
      node = node.firstChild;
      stage.appendChild(node);
      current = { data: c, node: node };
      foot.innerHTML = footHTML(c);
      foot.setAttribute('data-kind', c.kind);
      if (c.kind === 'question') wireSwipe(current);
      if (c.kind === 'dial') wireDial(current);
      paintDots();
      // Enter: a spring up from the stack; reduced motion fades in.
      node.classList.add('is-entering');
      root.requestAnimationFrame ? root.requestAnimationFrame(function () { node.classList.remove('is-entering'); }) : node.classList.remove('is-entering');
      var focusTo = c.kind === 'dial' ? node.querySelector('.deck-dial__ring') : foot.querySelector('.deck-btn--yes') || node;
      try { focusTo.focus({ preventScroll: true }); } catch (e) {}
    }
    function next() {
      if (closed) return;
      if (queue.length) { show(queue.shift()); return; }
      var s = o.onDone ? o.onDone(api) : null;
      Promise.resolve(s).then(function (sum) {
        if (closed) return;
        if (!sum) { finish('done'); return; }
        show({ kind: 'info', id: 'summary', summary: true, title: sum.title, body: sum.body, icon: sum.icon || 'check', actions: sum.actions });
      });
    }
    function finish(how) {
      if (closed) return;
      closed = true;
      el.classList.add('is-closing');
      doc.removeEventListener('keydown', onKey, true);
      setTimeout(function () {
        el.remove();
        doc.documentElement.classList.remove('deck-open');
        try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) {}
      }, motion ? 180 : 0);
      if (o.onClose) o.onClose(how, api);
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-deck]');
      if (!b) return;
      var k = b.getAttribute('data-deck');
      if (k === 'close') { finish('closed'); return; }
      if (!current) return;
      if (k === 'info') {
        var acts = current.data.actions || [{ value: 'done' }], act = acts[+b.getAttribute('data-i')] || acts[0];
        if (current.data.summary) { if (o.onSummary) o.onSummary(act.value, api); finish('done'); return; }
        answer(act.value || 'done');
        return;
      }
      answer(k);
    });
    function onKey(e) {
      if (closed) return;
      if (e.key === 'Escape') { e.preventDefault(); finish('closed'); return; }
      if (!current || current.data.kind !== 'question' || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      var k = { ArrowRight: 'yes', ArrowLeft: 'no', ArrowUp: 'skip' }[e.key];
      if (k) { e.preventDefault(); answer(k); }
    }
    doc.addEventListener('keydown', onKey, true);

    next();
    return api;
  }

  root.TNDeck = { open: open, hm: hm };
})(typeof window !== 'undefined' ? window : globalThis);
