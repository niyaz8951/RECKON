/* RECKON — account.js
   The Account page: a settings list. Profile (name, photo), the per-app
   settings each app owns (KEPT's live at /kept/settings/), theme, password,
   this device (install, clear local copies), admin, sign out.
   Sign-out is the delegated [data-signout] handler in global.js. */
(function () {
  'use strict';
  var el = TN.el, els = TN.els, esc = TN.esc;
  var user = null;

  function open(d) { if (!d.open) d.showModal(); }
  function close(d) { if (d.open) d.close(); }
  els('dialog.sheet').forEach(function (d) {
    els('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { close(d); }); });
    d.addEventListener('click', function (e) { if (e.target === d) close(d); });
  });

  function paint() {
    el('#hello').textContent = user.name || user.email.split('@')[0];
    el('#sub').textContent = user.email;
    el('#val-name').textContent = user.name || 'Add';
    el('#val-email').textContent = user.email;
    el('#val-photo').textContent = user.avatar_url ? 'Change' : 'Add';
    el('#photo-slot').innerHTML = TN.avatarHTML(user, 'avatar--lg');
    el('#photo-remove').hidden = !user.avatar_url;
    el('#admin-group').hidden = user.role !== 'admin';
    el('#role-note').textContent = user.role === 'admin' ? 'Signed in as an administrator.' : '';
    el('#ai-on').checked = !!user.ai_on;
    el('#ai-state').textContent = user.ai_on ? 'On — suggestions only; you decide what is kept' : 'Off — everything works without it';
  }
  /* AI on/off: optimistic, put back if the save fails. */
  el('#ai-on').addEventListener('change', async function () {
    var want = this.checked;
    user = Object.assign({}, user, { ai_on: want }); paint();
    try { var r = await TN.api('/api/auth/profile', { method: 'PUT', body: { ai_on: want } }); adopt(r.user); TN.toast(want ? 'AI suggestions on.' : 'AI suggestions off.', 'success'); }
    catch (e) { user = Object.assign({}, user, { ai_on: !want }); paint(); TN.toast(e.message, 'error'); }
  });
  /* The header, the cached hint and this page all show the same person. */
  function adopt(u) {
    user = u;
    TN.session.user = Object.assign({}, TN.session.user || {}, u);
    TN.rememberUser(TN.session.user);
    TN.repaintChrome();
    paint();
  }

  TN.ready(async function () {
    var u = await TN.guard();
    user = u; paint();
    paintTheme(); paintDevice();
  });

  /* ------------------------------------------------------------ name */
  el('#row-name').addEventListener('click', function () {
    el('#name-in').value = user.name || '';
    open(el('#name-sheet'));
    setTimeout(function () { el('#name-in').focus(); }, 60);
  });
  el('#name-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    try {
      var r = await TN.api('/api/auth/profile', { method: 'PUT', body: { name: el('#name-in').value } });
      adopt(r.user); close(el('#name-sheet')); TN.toast('Name saved', 'success');
    } catch (err) { TN.toast(err.message, 'error'); }
  });

  /* ----------------------------------------------------------- photo */
  /* The photo is cropped to a centred square and resized to 256px here,
     in the browser, so what goes to the server is ~20 KB however large the
     camera's file was. */
  function pickPhoto() { close(el('#photo-sheet')); el('#photo-file').click(); }
  el('#photo-btn').addEventListener('click', function () { user && user.avatar_url ? open(el('#photo-sheet')) : pickPhoto(); });
  el('#row-photo').addEventListener('click', function () { user && user.avatar_url ? open(el('#photo-sheet')) : pickPhoto(); });
  el('#photo-pick').addEventListener('click', pickPhoto);
  el('#photo-remove').addEventListener('click', async function () {
    try { var r = await TN.api('/api/auth/profile', { method: 'PUT', body: { avatar: null } }); adopt(r.user); close(el('#photo-sheet')); TN.toast('Photo removed', 'success'); }
    catch (err) { TN.toast(err.message, 'error'); }
  });
  el('#photo-file').addEventListener('change', async function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { TN.toast('Pick an image file.', 'error'); return; }
    try {
      var dataUrl = await squareJpeg(f, 256);
      var r = await TN.api('/api/auth/profile', { method: 'PUT', body: { avatar: dataUrl } });
      adopt(r.user); TN.toast('Photo saved', 'success');
    } catch (err) { TN.toast(err.message || 'Could not use that photo.', 'error'); }
  });
  function squareJpeg(file, size) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(img.naturalWidth, img.naturalHeight);
        var c = document.createElement('canvas'); c.width = size; c.height = size;
        var g = c.getContext('2d');
        if (!g) { URL.revokeObjectURL(url); reject(new Error('This browser cannot resize photos.')); return; }
        g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That photo could not be read.')); };
      img.src = url;
    });
  }

  /* ----------------------------------------------------------- theme */
  function paintTheme() {
    var pref = TN.themePref();
    els('#theme-seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-t') === pref)); });
  }
  els('#theme-seg button').forEach(function (b) {
    b.addEventListener('click', function () { TN.applyTheme(b.getAttribute('data-t')); paintTheme(); });
  });

  /* -------------------------------------------------------- password */
  el('#row-pw').addEventListener('click', function () {
    el('#cur').value = ''; el('#nw').value = '';
    open(el('#pw-sheet'));
    setTimeout(function () { el('#cur').focus(); }, 60);
  });
  el('#pwform').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    try {
      var r = await TN.api('/api/auth/password', { method: 'POST', body: {
        current_password: el('#cur').value, new_password: el('#nw').value } });
      TN.toast(r.message, 'success');
      TN.clearLocal();
      setTimeout(function () { location.href = TN.url('login/'); }, 1200);
    } catch (err) { TN.toast(err.message, 'error'); }
  });

  /* ---------------------------------------------------------- device */
  function paintDevice() {
    var P = window.TNPWA || {};
    el('#row-installed').hidden = !P.standalone;
    el('#row-install').hidden = !!P.standalone || !(P.canInstall && P.canInstall());
    el('#row-ios').hidden = !!P.standalone || !P.ios;
  }
  document.addEventListener('tn:installable', paintDevice);
  el('#row-install').addEventListener('click', function () {
    if (window.TNPWA && TNPWA.install) TNPWA.install().then(paintDevice);
  });
  el('#row-clear').addEventListener('click', function () {
    if (!confirm('Clear the copies kept on this device? Your data on the server is not touched; apps load it again next time.')) return;
    TN.clearLocal();
    TN.rememberUser(TN.session.user);   // keep the header's name: you are still signed in
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'TN_SIGNED_OUT' });
    TN.toast('Cleared. Apps will load fresh from the server.', 'success');
  });
})();
