/* KEPT — settings (/kept/settings/, reached from Account → App settings).
   =============================================================================
   Currency, the keep-rate target and ramp, and the data tools (upload,
   export, sample). Everything saves as it changes. An upload
   replaces the record only after the confirmation sheet, as before, and
   then drops this device's KEPT snapshot so the app cannot show the old
   record for a moment on its next open. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = TN.esc, IM = window.KeptImport;
  var S = { profile: null, rows: null };
  var IMP = { rows: null };

  function open(d) { if (!d.open) d.showModal(); }
  function close(d) { if (d.open) d.close(); }
  TN.els('dialog.sheet').forEach(function (d) {
    TN.els('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { close(d); }); });
    d.addEventListener('click', function (e) { if (e.target === d) close(d); });
  });

  /* Back goes back when we came from Account, so the slide runs the right
     way and Account keeps its scroll; a direct link still lands on Account. */
  var back = document.querySelector('[data-back]');
  back.addEventListener('click', function (e) {
    var ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === location.origin && ref.pathname === TN.url('account/') && history.length > 1) { e.preventDefault(); history.back(); }
  });

  function monthShort(ym) {
    var d = new Date(ym + '-01T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function paint() {
    var p = S.profile;
    $('set-cur').value = p.currency;
    $('set-target').value = Math.round(p.target_keep_bp / 100);
    $('set-ramp').value = p.ramp_months;
    var r = S.rows || [];
    var first = r.length ? r[0].d : null, last = r.length ? r[r.length - 1].d : null;
    $('data-info').innerHTML = '<b>' + r.length + '</b> transactions stored' + (first ? '<small>' + monthShort(first.slice(0, 7)) + ' → ' + monthShort(last.slice(0, 7)) + '</small>' : '');
  }

  async function load() {
    var b = await TN.api('/api/kept/bootstrap');
    S.profile = b.profile; S.rows = b.transactions;
    $('ks-loading').hidden = true; $('ks-body').hidden = false;
    paint();
  }

  async function save(patch, label) {
    try {
      var r = await TN.api('/api/kept/profile', { method: 'PUT', body: patch });
      S.profile = r.profile; paint();
      // The app's snapshot holds the old profile; the next open refetches.
      if (window.KeptStore) KeptStore.clear();
      TN.toast(label + ' saved', 'success');
    } catch (e) { TN.toast(e.message, 'error'); paint(); }
  }
  $('set-cur').addEventListener('change', function () { save({ currency: $('set-cur').value }, 'Currency'); });
  $('set-target').addEventListener('change', function () {
    var v = Math.round(+$('set-target').value || 0);
    if (!(v >= 1 && v <= 80)) { TN.toast('Pick a target between 1% and 80%.', 'error'); paint(); return; }
    save({ target_keep_bp: v * 100 }, 'Target');
  });
  $('set-ramp').addEventListener('change', function () {
    var v = Math.round(+$('set-ramp').value || 0);
    if (!(v >= 1 && v <= 36)) { TN.toast('Pick 1 to 36 months.', 'error'); paint(); return; }
    save({ ramp_months: v }, 'Ramp');
  });

  $('data-export').addEventListener('click', function () {
    if (!S.rows || !S.rows.length) { TN.toast('Nothing to export yet.', 'error'); return; }
    IM.exportAll(S.rows);
  });
  $('data-sample').addEventListener('click', function () { IM.sample(); });
  $('data-file').addEventListener('change', function (e) { handleUpload(e.target.files && e.target.files[0]); });
  $('imp-go').addEventListener('click', confirmImport);

  async function handleUpload(file) {
    if (!file) return;
    try {
      var parsed = await IM.readFile(file);
      var preview = await TN.api('/api/kept/import', { method: 'POST', body: { rows: parsed.rows, confirm: false } });
      IMP.rows = parsed.rows;
      var map = Object.keys(parsed.mapping).map(function (k) { return '<li>' + k + ' ← <b>' + esc(parsed.mapping[k]) + '</b></li>'; }).join('');
      $('imp-body').innerHTML = '<div class="notice notice--danger"><div>The file becomes the single source of truth: your current <b>' + (S.rows || []).length + '</b> transactions are replaced and the path baseline resets. EMIs, rules, budgets and settings stay. Export first if you want a copy.</div></div>' +
        '<div class="kp-row"><span>Rows in file</span><b>' + preview.preview.rows + '</b></div><div class="kp-row"><span>Identical rows collapsed</span><b>' + preview.preview.collapsed + '</b></div><div class="kp-row"><span>Skipped (no date / amount)</span><b>' + (preview.preview.invalid + parsed.skipped) + '</b></div><div class="kp-row"><span>Period</span><b>' + preview.preview.from + ' → ' + preview.preview.to + '</b></div>' +
        '<p class="kp-muted-sm" style="margin-top:var(--space-2)">Columns matched:</p><ul class="kp-list">' + map + '</ul>';
      open($('imp-sheet'));
    } catch (e) { TN.toast(e.message, 'error'); }
    $('data-file').value = '';
  }
  async function confirmImport() {
    if (!IMP.rows) return;
    var b = $('imp-go'); b.disabled = true; b.textContent = 'Replacing…';
    try {
      var r = await TN.api('/api/kept/import', { method: 'POST', body: { rows: IMP.rows, confirm: true } });
      IMP.rows = null; close($('imp-sheet'));
      if (window.KeptStore) await KeptStore.clear();
      await load();
      TN.toast('Record replaced: ' + r.added + ' rows written' + (r.updated ? ', ' + r.updated + ' matched existing' : '') + '.', 'success');
    } catch (e) { TN.toast(e.message, 'error'); }
    b.disabled = false; b.textContent = 'Replace everything';
  }

  async function boot() {
    await TN.guard();
    try { await load(); }
    catch (e) { $('ks-loading').className = 'notice notice--danger'; $('ks-loading').textContent = 'Could not load KEPT settings: ' + e.message; }
    document.dispatchEvent(new CustomEvent('kept-settings:ready'));
  }
  if (TN.session.loaded) boot(); else document.addEventListener('tn:ready', boot, { once: true });
})();
