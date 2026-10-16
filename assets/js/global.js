/* RECKON — global.js (v7, GitHub Pages + Supabase)
   Shared chrome for the app hub: header, footer, tab bar, theme, session,
   the app registry and TN.* helpers. Loaded on every page.

   Adding an app = one folder + one entry in APPS below + one tile on the
   home page (the home page reads APPS, so the tile is free). */
(function () {
  'use strict';

  // ---------------------------------------------------------- where the site lives
  // '/' on its own domain, '/Reckon/' on a GitHub project site. Read
  // from this script's own address (it sits at <base>assets/js/global.js),
  // so the same files work at either without a setting to keep in step.
  var BASE = (function () {
    var s = document.currentScript;
    try { return s && s.src ? new URL('../../', s.src).pathname : '/'; } catch (e) { return '/'; }
  })();
  /* A site path → a real URL path: url('kept/') is '/Reckon/kept/'. */
  function url(p) { return BASE + String(p || '').replace(/^\/+/, ''); }
  /* This page's path inside the site, always starting '/': '/kept/'. */
  function sitePath() {
    var p = location.pathname;
    return p.indexOf(BASE) === 0 ? '/' + p.slice(BASE.length) : p;
  }
  /* The sign-in page, with a way back to where we are. */
  function loginURL(extra) {
    return url('login/') + '?next=' + encodeURIComponent(location.pathname + location.search) + (extra || '');
  }

  // ---------------------------------------------------------- icons
  // Line icons, 1.5px stroke, currentColor. Add new keys here, never inline.
  var P = {
    // Lucide geometry, 24x24, stroke-only so they inherit currentColor.
    'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
    'git-branch': '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 1-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2z"/>',
    wind: '<path d="M3 8h9a3 3 0 1 0-3-3"/><path d="M3 12h13a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    'book-open': '<path d="M12 6.5S10 4 3 4v14c7 0 9 2.5 9 2.5S14 18 21 18V4c-7 0-9 2.5-9 2.5z"/><path d="M12 6.5v14"/>',
    'file-check': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/>',
    calculator: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    feather: '<path d="M20.2 3.8a5 5 0 0 0-7 0L4 13v7h7l9.2-9.2a5 5 0 0 0 0-7z"/><path d="M16 8L2 22"/>',
    'graduation-cap': '<path d="M22 9L12 5 2 9l10 4 10-4z"/><path d="M6 11v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
    type: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.7-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.6 1.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
    'pen-line': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    // The RECKON mark: a tally of five — four strokes and the one that counts them.
    tally: '<path d="M5 5v14M9.5 5v14M14.5 5v14M19 5v14"/><path d="M2.5 17.5l19-9" opacity=".75"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'chevron-up': '<path d="M18 15l-6-6-6 6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    scale: '<path d="M12 3v18"/><path d="M5 7l-3 7a4 4 0 0 0 6 0z"/><path d="M19 7l-3 7a4 4 0 0 0 6 0z"/><path d="M5 7h14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    volume: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    up: '<path d="M18 15l-6-6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    thermometer: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    droplet: '<path d="M12 2.7l5 5.3a7 7 0 1 1-10 0z"/>',
    fan: '<path d="M12 12a3 3 0 1 0 0-.01"/><path d="M12 12c0-4 1-7 3.5-7S19 7 17 9s-5 3-5 3"/><path d="M12 12c4 0 7 1 7 3.5S17 19 15 17s-3-5-3-5"/><path d="M12 12c0 4-1 7-3.5 7S5 17 7 15s5-3 5-3"/><path d="M12 12c-4 0-7-1-7-3.5S7 5 9 7s3 5 3 5"/>',
    gauge: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l4.5-4.5"/><circle cx="12" cy="12" r="1.5"/>',
    ruler: '<path d="M15.5 2.5l6 6L8.5 21.5l-6-6z"/><path d="M7 12l2 2"/><path d="M10.5 8.5l2 2"/><path d="M14 5l2 2"/>',
    'pipe': '<path d="M3 8h12a4 4 0 0 1 4 4v8"/><path d="M3 5v6"/><path d="M16 20h6"/>',
    snowflake: '<path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17"/><path d="M12 6l-2.2-2.2M12 6l2.2-2.2M12 18l-2.2 2.2M12 18l2.2 2.2"/>',
    home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    container: '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M7 7v10M12 7v10M17 7v10"/>',
    // App hub additions (v4). Lucide geometry as above.
    wallet: '<path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2"/><path d="M18 13h-3a1.5 1.5 0 0 0 0 3h3"/>',
    'book-a': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M9.5 13l2.5-6 2.5 6"/><path d="M10.4 11h3.2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
    'arrow-up-right': '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
    'arrow-down-right': '<path d="M7 7l10 10"/><path d="M17 8v9H8"/>',
    'trending-up': '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'pie-chart': '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    'bar-chart': '<path d="M12 20V10M18 20V4M6 20v-4"/>',
    'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h22"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    languages: '<path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>',
    'alert-triangle': '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    'refresh-cw': '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 9.9A6 6 0 1 1 10 18.1"/><path d="M7 6h1v4"/><path d="M16.7 13.3l.7.7-2.8 2.8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'chevron-right': '<path d="M9 18l6-6-6-6"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M17 6l3 3M14.5 8.5l2 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    'trash-2': '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    lightbulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    'sliders': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    // KEPT category icons (kept- prefix). Same line style; the category
    // list in /kept/kept-core.js (DEFAULT_CATEGORIES) names them.
    'kept-fuel': '<path d="M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3 21h13M14 9h2a2 2 0 0 1 2 2v5a1.6 1.6 0 0 0 3.2 0V9.5L18 6M6.5 7h6"/>',
    'kept-food': '<path d="M6 3v7M4 3v4a2 2 0 0 0 4 0V3M6 12v9M15 3c-1.7 1.5-2.5 4-2.5 6.5 0 2 1 3 2.5 3V21M15 3c1.7 1.5 2.5 4 2.5 6.5"/>',
    'kept-grocery': '<path d="M3 4h2l2.4 12.2A2 2 0 0 0 9.4 18h8.2a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="21" r="1"/><circle cx="17" cy="21" r="1"/>',
    'kept-transport': '<path d="M5 17h-1a1 1 0 0 1-1-1v-4l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 6l2 6v4a1 1 0 0 1-1 1h-1M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M5 17h10M4 11h16"/>',
    'kept-home': '<path d="M3 11 12 4l9 7M6 9.5V20h12V9.5M10 20v-6h4v6"/>',
    'kept-utilities': '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
    'kept-medicine': '<path d="M8 3h8M10 3v5.5L4.8 17a3 3 0 0 0 2.6 4.5h9.2a3 3 0 0 0 2.6-4.5L14 8.5V3M7 15h10"/>',
    'kept-shopping': '<path d="M6 8h12l1.2 12.2a1.6 1.6 0 0 1-1.6 1.8H6.4a1.6 1.6 0 0 1-1.6-1.8L6 8zM9 10V6a3 3 0 0 1 6 0v4"/>',
    'kept-clothing': '<path d="m9 4-5 3 2 3.5L8 9v11h8V9l2 1.5L20 7l-5-3a3 3 0 0 1-6 0z"/>',
    'kept-entertainment': '<path d="M4 8h16v12H4zM4 8l2-4 3 1.5L11 4l3 1.5L16 4l2 1.5L20 8M10 12l5 3-5 3v-6z"/>',
    'kept-phone': '<path d="M8 2h8a1.5 1.5 0 0 1 1.5 1.5v17A1.5 1.5 0 0 1 16 22H8a1.5 1.5 0 0 1-1.5-1.5v-17A1.5 1.5 0 0 1 8 2zM10 19h4"/>',
    'kept-salary': '<path d="M12 3v18M8 7.5C8 6 9.7 5 12 5s4 1 4 2.5S14.3 10 12 10s-4 1-4 2.5S9.7 15 12 15s4-1 4-2.5"/><circle cx="12" cy="12" r="10"/>',
    'kept-bank': '<path d="M3 9 12 3l9 6M4 9h16M6 9v8M10 9v8M14 9v8M18 9v8M3 20h18M4 17h16"/>',
    'kept-invest': '<path d="M3 21h18M5 21V13M10 21V9M15 21v-8M20 21V5M13 8l7-3M17.5 4.4 20 5l-.6 2.5"/>',
    'kept-travel': '<path d="M10.5 13.5 3 11l1.5-1.5L11 10l4.5-4.5a1.8 1.8 0 0 1 2.5 2.5L13.5 12l.5 6.5L12.5 20l-2-6.5L7 16l.2 2.3L5.7 19 4.5 16 2 14.8l1.5-1.3z"/>',
    'kept-car': '<path d="M5 16h-2v-4l2.2-5A2 2 0 0 1 7 5.8h10a2 2 0 0 1 1.8 1.2L21 12v4h-2M5 16a2 2 0 1 0 4 0m6 0a2 2 0 1 0 4 0M9 16h6M4.5 12h15"/>',
    'kept-laundry': '<path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 6h.01M11 6h.01M12 15a4 4 0 1 0 0-.01M9.5 14a3 3 0 0 1 5 0"/>',
    'kept-fees': '<path d="M5 19 19 5M7.5 8.5a2 2 0 1 0 0-.01M16.5 17.5a2 2 0 1 0 0-.01"/>',
    'kept-misc': '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
    'kept-education': '<path d="M2 9.5 12 5l10 4.5-10 4.5L2 9.5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5M22 9.5V15"/>',
    'kept-shield': '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 7.8 7.5 9.5 4.3-1.7 7.5-5 7.5-9.5V6L12 3zM9 12l2 2 4-4"/>'
  };

  /* Static markup cannot call TN.icon(), so an element may ask for one with
     data-icon="name"; this fills every such element in `root`. Runs once at
     mount and is exposed as TN.fillIcons for markup added later. */
  function fillIcons(root) {
    els('[data-icon]', root).forEach(function (node) {
      if (node.children.length) return;
      node.innerHTML = icon(node.getAttribute('data-icon'), node.getAttribute('data-icon-size') || 18);
    });
  }

  function icon(name, size) {
    var d = P[name] || P.square;
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  // ------------------------------------------------------- utilities
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* Every page asks for data with TN.api('/api/…', { method, body }). There
     is no server behind those paths any more: db.js routes each one to a
     handler running in this browser, which reads and writes Supabase under
     row-level security. Anything not under /api/ is an ordinary fetch. */
  async function api(path, options) {
    var opts = options || {};
    if (String(path).indexOf('/api/') === 0 && window.TNData) {
      try {
        return await window.TNData.handle(opts.method || 'GET', path, opts.body);
      } catch (err) {
        // The session ended (signed in on another device, or expired): go
        // to the sign-in page, which explains, rather than letting each
        // caller paint its own confusing failure.
        if (err && err.status === 401 && err.signedOut && !isAuthPage()) {
          clearLocal();
          location.replace(loginURL());
          // Never settles: the navigation is already under way.
          return new Promise(function () {});
        }
        throw err;
      }
    }
    var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
    if (!res.ok) { var e = new Error('Request failed (' + res.status + ')'); e.status = res.status; throw e; }
    return res;
  }

  function isAuthPage() {
    return sitePath().indexOf('/login/') === 0 || sitePath().indexOf('/signup/') === 0;
  }

  /* Loads a script once, on demand, and resolves when it has run. The
     vendored libraries (Chart.js, SheetJS — 1.1 MB together) are loaded
     this way by the screen that needs them instead of on every page open. */
  var loading = {};
  function loadScript(src) {
    // Site paths ('/assets/…' or 'assets/…') are resolved against BASE, so
    // callers never need to know where the site is mounted.
    if (!/^[a-z]+:/i.test(src)) src = url(src);
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete loading[src]; reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return loading[src];
  }

  /* What this browser remembers about the signed-in person, so the chrome
     can paint their name before the server has answered. Nothing beyond
     id, name, email and role; cleared on sign-out and whenever the server
     says the session is gone. */
  var USER_KEY = 'tn-user';
  function cachedUser() {
    try { var raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function rememberUser(u) {
    try {
      if (u) localStorage.setItem(USER_KEY, JSON.stringify({ id: u.id, name: u.name, email: u.email, role: u.role, avatar_url: u.avatar_url || null }));
      else localStorage.removeItem(USER_KEY);
    } catch (e) { /* storage unavailable */ }
  }
  /* Everything an app may have kept on this device: the user hint above and
     every IndexedDB database (apps keep per-user snapshots there). Called on
     sign-out and on a forced sign-out, before the page navigates away. */
  function clearLocal() {
    rememberUser(null);
    try {
      if (window.indexedDB) {
        var known = ['tn-kept'];
        known.forEach(function (n) { try { indexedDB.deleteDatabase(n); } catch (e) {} });
        if (typeof indexedDB.databases === 'function') {
          indexedDB.databases().then(function (list) {
            (list || []).forEach(function (d) { if (d.name && known.indexOf(d.name) < 0) try { indexedDB.deleteDatabase(d.name); } catch (e) {} });
          }).catch(function () {});
        }
      }
    } catch (e) { /* nothing to clear */ }
  }

  function toast(message, kind) {
    var region = el('#toast-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast--' + kind : '');
    t.textContent = message;
    region.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }


  // ------------------------------------------------------- the app registry
  // Every app on the hub, in nav order. slug is the folder, the data-app
  // value and the nav key. accent names the token pair global.css maps onto
  // --color-primary for that app; omit it for the default blue.
  var APPS = [
    { slug: 'kept',       title: 'KEPT',       short: 'KEPT',  href: url('kept/'), icon: 'wallet',
      tagline: 'How much of your money stays yours.', accent: 'kept' },
    { slug: 'spent',      title: 'SPENT',      short: 'SPENT', href: url('spent/'), icon: 'clock',
      tagline: 'How much of your time stays yours.', accent: 'spent' },
    { slug: 'decided',    title: 'DECIDED',    short: 'DECIDED', href: url('decided/'), icon: 'compass',
      tagline: 'Decide, predict, look back, get better at it.', accent: 'decided' }
  ];

  function appBySlug(slug) {
    for (var i = 0; i < APPS.length; i++) if (APPS[i].slug === slug) return APPS[i];
    return null;
  }

  /* "Are we inside this app" — true on the app's home and any page under
     it. /kept/settings/ counts as KEPT. */
  function inApp(app) {
    var p = location.pathname;
    return p === app.href || p.indexOf(app.href) === 0;
  }

  function currentApp() {
    for (var i = 0; i < APPS.length; i++) if (inApp(APPS[i])) return APPS[i];
    return null;
  }

  // ---------------------------------------------------------- chrome
  var session = { user: null, loaded: false, mounting: null };
  var TN_largeTitle = function () {};

  /* Initials when there is no photo: first letters of the first two words
     of the name, or of the email's local part. */
  function initials(u) {
    var src = (u && (u.name || (u.email || '').split('@')[0])) || '?';
    var parts = String(src).trim().split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function avatarHTML(u, cls) {
    var c = 'avatar' + (cls ? ' ' + cls : '');
    if (u && u.avatar_url) return '<img class="' + c + '" src="' + esc(u.avatar_url) + '" alt="">';
    return '<span class="' + c + '" aria-hidden="true">' + esc(initials(u)) + '</span>';
  }

  /* What the header calls this page on a phone: the app's name, or the
     page's own (body data-title), or the hub's. */
  function pageTitle() {
    var app = currentApp();
    if (app) return app.title;
    var t = document.body && document.body.getAttribute('data-title');
    return t || 'RECKON';
  }

  function headerHTML() {
    var links = APPS.map(function (a) {
      var current = inApp(a) ? ' aria-current="page"' : '';
      return '<a href="' + esc(a.href) + '"' + current + '>' + esc(a.title) + '</a>';
    }).join('');
    var u = session.user;
    // Sign-out lives in Account now. A header with a name, an admin link and
    // a sign-out button was wider than a phone, and the whole page slid
    // sideways to make room for it.
    var actions = u
      ? (u.role === 'admin' ? '<a class="btn btn--ghost btn--sm header-admin" href="' + url('admin/') + '">Admin</a>' : '') +
        '<a class="header-avatar" href="' + url('account/') + '" aria-label="Account — ' + esc(u.name || u.email) + '">' + avatarHTML(u) + '</a>'
      // Reachable only on the sign-in pages, or if the session ended between
      // the page load and this render (the api() 401 handler is navigating).
      : (isAuthPage() ? '' : '<a class="btn btn--primary btn--sm" href="' + url('login/') + '">Sign in</a>');
    return '<div class="site-header__inner">' +
      '<a class="brand" href="' + BASE + '" aria-label="RECKON — all apps"><span class="brand__mark">' + icon('tally', 16) + '</span><span class="brand__name">RECKON</span></a>' +
      '<span class="site-header__title"><span data-t="app">' + esc(pageTitle()) + '</span><span data-t="page" aria-hidden="true"></span></span>' +
      '<nav class="site-nav" aria-label="Apps">' + links + '</nav>' +
      '<div class="header-actions">' +
      '<button class="btn btn--quiet btn--sm" data-theme-toggle aria-label="Switch colour theme">' + icon('moon', 18) + '</button>' +
      actions + '</div></div>';
  }

  /**
   * The mobile tab bar: Home · one tab per app · Account. Fixed to the
   * bottom under the thumb; hidden above 640px where the header nav is
   * already comfortable. An app that needs its own in-app tabs (KEPT does)
   * sets body.has-app-bar and the site bar steps aside — see global.css.
   */
  function tabBarHTML() {
    if (!session.user) return '';
    var tabs = APPS.map(function (a) {
      // aria-current, not a class: the accessible state and the visual state
      // should be the same fact, so they cannot disagree.
      return '<a href="' + esc(a.href) + '"' + (inApp(a) ? ' aria-current="page"' : '') + (a.accent ? ' data-accent="' + esc(a.accent) + '"' : '') + '>' +
        icon(a.icon, 20) + '<span>' + esc(a.short || a.title) + '</span></a>';
    });
    tabs.unshift('<a href="' + BASE + '"' + (sitePath() === '/' ? ' aria-current="page"' : '') + '>' +
      icon('home', 20) + '<span>Home</span></a>');
    tabs.push('<a href="' + url('account/') + '"' +
      (sitePath().indexOf('/account/') === 0 ? ' aria-current="page"' : '') + '>' +
      icon('user', 20) + '<span>Account</span></a>');
    return '<nav class="tab-bar" aria-label="Main">' + tabs.join('') + '</nav>';
  }

  function footerHTML() {
    var links = APPS.map(function (a) {
      return '<a href="' + esc(a.href) + '">' + esc(a.title) + '</a>';
    }).join('');
    return '<div class="site-footer__inner">' +
      '<div>RECKON — count it, judge it. Money, time, decisions.</div>' +
      '<nav aria-label="Footer"><a href="' + BASE + '">Home</a>' + links + '<a href="' + url('account/') + '">Account</a></nav>' +
      '</div>';
  }

  /* Theme preference: 'light', 'dark' or 'system' (no key stored). The
     resolved value always lands on data-theme, because the dark tokens are
     keyed on it. The inline script in every page's <head> does the same
     before first paint, so there is no light flash on a dark phone. */
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function themePref() {
    var m = null;
    try { m = localStorage.getItem('tn-theme'); } catch (e) {}
    return m === 'light' || m === 'dark' ? m : 'system';
  }
  function resolvedTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function applyTheme(mode) {
    var pref = mode === 'light' || mode === 'dark' ? mode : 'system';
    try {
      if (pref === 'system') localStorage.removeItem('tn-theme');
      else localStorage.setItem('tn-theme', pref);
    } catch (e) {}
    setTheme(resolvedTheme(pref));
  }
  function setTheme(value) {
    if (document.documentElement.getAttribute('data-theme') !== value) document.documentElement.setAttribute('data-theme', value);
    // The browser's own bars (Android status bar, the iOS overscroll) take
    // the page's surface colour, so they follow the theme too.
    try {
      var c = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
      if (c) TN_els('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', c); });
    } catch (e) {}
  }
  function TN_els(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function initTheme() {
    setTheme(resolvedTheme(themePref()));
    if (darkQuery) {
      var follow = function () { if (themePref() === 'system') setTheme(resolvedTheme('system')); };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', follow);
      else if (darkQuery.addListener) darkQuery.addListener(follow);
    }
  }

  /* The accent follows the page, not the markup author's memory: a page
     under /kept/ gets data-app="kept" even if the HTML forgot it. */
  function applyAppAccent() {
    var app = currentApp();
    if (app && app.accent && !document.documentElement.getAttribute('data-app')) {
      document.documentElement.setAttribute('data-app', app.accent);
    }
  }

  /* Paints header, footer and tab bar from what is already known. Runs
     synchronously at script time, before any request, so the chrome is on
     screen with the first frame and never pops in later. Idempotent: the
     server's answer repaints only if something differs. */
  function paintChrome() {
    var header = el('[data-site-header]');
    var footer = el('[data-site-footer]');
    if (header) {
      header.className = 'site-header';
      var html = headerHTML();
      if (header.innerHTML !== html) header.innerHTML = html;
    }
    if (footer) {
      footer.className = 'site-footer';
      var fhtml = footerHTML();
      if (footer.innerHTML !== fhtml) footer.innerHTML = fhtml;
    }
    // Appended to <body>, not inside the footer: it is fixed to the viewport,
    // and nesting it in a scrolled container makes position:fixed behave
    // differently under a CSS transform ancestor.
    var bar = el('.tab-bar');
    if (header && session.user && !bar) {
      var holder = document.createElement('div');
      holder.innerHTML = tabBarHTML();
      document.body.appendChild(holder.firstChild);
      document.body.classList.add('has-tab-bar');
    } else if (bar && !session.user) {
      bar.remove();
      document.body.classList.remove('has-tab-bar');
    }
    fillIcons(document);
    addGrabs(document);
  }

  async function mountChrome() {
    if (session.mounting) return session.mounting;
    var header = el('[data-site-header]');
    var footer = el('[data-site-footer]');
    if (!header && !footer) {
      session.loaded = true;
      session.readyDetail = { user: null, apps: APPS };
      document.dispatchEvent(new CustomEvent('tn:ready', { detail: session.readyDetail }));
      return;
    }
    // First frame: the person this browser last saw, or nobody on the
    // sign-in pages. Every other page is behind TN.guard(), so assuming
    // "signed in" here is right far more often than not — and when it is
    // wrong the server's answer below sends them to the sign-in page.
    session.user = isAuthPage() ? null : cachedUser();
    paintChrome();

    session.mounting = (async function () {
      var data = null;
      try { data = await api('/api/auth/me'); } catch (e) { data = { user: null }; }
      session.user = data.user || null;
      session.maintenance = !!data.maintenance;
      session.loaded = true;
      rememberUser(session.user);
      data.apps = APPS;
      paintChrome();
      if (data.announcement && !el('[data-announcement]')) {
        var note = document.createElement('div');
        note.className = 'wrap';
        note.setAttribute('data-announcement', '');
        note.style.paddingTop = 'var(--space-3)';
        note.innerHTML = '<div class="notice">' + icon('activity', 18) + '<div>' + esc(data.announcement) + '</div></div>';
        document.body.insertBefore(note, el('main'));
      }
      session.readyDetail = data;
      document.dispatchEvent(new CustomEvent('tn:ready', { detail: data }));
    })();
    return session.mounting;
  }
  /* Run fn once the chrome is mounted and the session known. The event
     alone is a race: with a cached session and cached scripts, /api/auth/me
     can answer before a page's later <script> has even been parsed, so a
     listener added then would wait forever ("Opening the book…"). */
  function ready(fn) {
    var ev = { detail: session.readyDetail || { user: session.user, apps: APPS } };
    if (session.loaded) { Promise.resolve().then(function () { fn(ev); }); return; }
    document.addEventListener('tn:ready', fn, { once: true });
  }

  // The chrome is repainted, so its buttons are bound once, on the document.
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (toggle) {
      var now = document.documentElement.getAttribute('data-theme');
      applyTheme(now === 'dark' ? 'light' : 'dark');
      return;
    }
    var out = e.target.closest && e.target.closest('[data-signout]');
    if (out) {
      out.disabled = true;
      api('/api/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        // The server clears the cookie; it cannot clear this device. The
        // user hint, every app snapshot and (via pwa.js) the worker's cache
        // go before the page does.
        clearLocal();
        document.dispatchEvent(new CustomEvent('tn:signout'));
        location.href = url('login/');
      });
    }
  });

  /* Swipe a bottom sheet down to close it (phones). The grab handle and
     the sheet's head are the drag area, so scrolling the form inside the
     sheet never fights the gesture. Closing goes through dialog.close(),
     the same path as the Cancel button, so app code sees one kind of close. */
  (function sheetSwipe() {
    var drag = null;
    function panelOf(t) { return t && t.closest && t.closest('dialog.sheet[open] .sheet__panel'); }
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || window.innerWidth > 640) return;
      var handle = e.target.closest && e.target.closest('.sheet__grab, .sheet__head');
      if (!handle || (e.target.closest('button, a, input, select, textarea') && !e.target.closest('.sheet__grab'))) return;
      var panel = panelOf(handle);
      if (!panel) return;
      drag = { panel: panel, y0: e.clientY, dy: 0, t0: Date.now() };
      panel.classList.add('is-dragging');
    }, { passive: true });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      drag.panel.style.transform = 'translateY(' + drag.dy + 'px)';
    }, { passive: true });
    function end() {
      if (!drag) return;
      var d = drag; drag = null;
      d.panel.classList.remove('is-dragging');
      var fast = d.dy > 40 && (Date.now() - d.t0) < 250;
      d.panel.classList.add('is-settling');
      if (d.dy > 110 || fast) {
        d.panel.style.transform = 'translateY(100%)';
        setTimeout(function () {
          var dlg = d.panel.closest('dialog');
          d.panel.classList.remove('is-settling'); d.panel.style.transform = '';
          if (dlg && dlg.open) dlg.close();
        }, 200);
      } else {
        d.panel.style.transform = '';
        setTimeout(function () { d.panel.classList.remove('is-settling'); }, 220);
      }
    }
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  })();

  /* The large title collapses into the bar (phones). While the page's big
     <h1> is on screen the bar says the app's name; once it has scrolled
     under the bar, the bar says the title instead — the iOS navigation bar.
     A hairline appears under the bar once anything has scrolled beneath it. */
  (function largeTitle() {
    var queued = false;
    function bigTitle() {
      var hs = els('main h1');
      for (var i = 0; i < hs.length; i++) if (hs[i].offsetParent !== null || hs[i].getClientRects().length) return hs[i];
      return null;
    }
    function update() {
      queued = false;
      var header = el('.site-header'); if (!header) return;
      var h = bigTitle(), hb = header.getBoundingClientRect().bottom;
      var collapsed = !!(h && h.getBoundingClientRect().bottom < hb + 2);
      var slot = header.querySelector('[data-t="page"]');
      if (slot && h && slot.textContent !== h.textContent) slot.textContent = h.textContent;
      header.classList.toggle('is-collapsed', collapsed);
      header.classList.toggle('is-scrolled', (window.scrollY || 0) > 2);
    }
    function queue() { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(update); } }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    document.addEventListener('tn:ready', queue);
    TN_largeTitle = queue;
  })();

  /* Adds the grab handle to every bottom sheet, so no page has to. */
  function addGrabs(root) {
    els('dialog.sheet .sheet__panel', root).forEach(function (p) {
      if (!p.querySelector(':scope > .sheet__grab')) {
        var g = document.createElement('div'); g.className = 'sheet__grab'; g.setAttribute('aria-hidden', 'true');
        p.insertBefore(g, p.firstChild);
      }
    });
  }

  /* Every app page calls this once. Resolves with the signed-in user, or
     sends the visitor to the sign-in page with a return path and never
     resolves (the navigation is already under way). The middleware already
     redirects signed-out page loads; this is the belt to that brace, and it
     is also what hands the page its user without a second request. */
  async function guard(role) {
    if (!session.loaded) await mountChrome();
    var u = session.user;
    // Signed out, not approved yet, suspended, or not an admin on an admin
    // page: the sign-in page explains which.
    if (!u || u.status !== 'active' || (role === 'admin' && u.role !== 'admin')) {
      var why = !u ? '' : u.status === 'pending' ? '&why=pending' : u.status === 'suspended' ? '&why=suspended' : '';
      if (u && u.status !== 'active') { try { await window.TNData.auth.signOut('local'); } catch (e) {} clearLocal(); }
      location.replace(loginURL(why));
      return new Promise(function () {});
    }
    // Maintenance: the data is closed (row-level security) to everyone but
    // admins; say so instead of showing empty apps.
    if (session.maintenance && u.role !== 'admin') {
      var main = el('main');
      if (main) main.innerHTML = '<div class="wrap" style="padding-top:var(--space-6)"><div class="notice notice--warning"><div><b>Down for maintenance.</b> RECKON is being worked on. Try again shortly.</div></div></div>';
      return new Promise(function () {});
    }
    return u;
  }

  /* Number formatting shared by apps that show money. Minor units in, text
     out; the currency code is whatever the record says. */
  function money(minor, currency, opts) {
    var o = opts || {};
    var n = (Number(minor) || 0) / 100;
    var digits = o.compact ? 0 : 2;
    var s;
    try {
      s = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
    } catch (e) { s = Math.abs(n).toFixed(digits); }
    return (n < 0 ? '−' : '') + (currency ? currency + ' ' : '') + s;
  }

  var TN = {
    icon: icon, esc: esc, el: el, els: els, api: api, toast: toast,
    session: session, guard: guard, requireRole: guard, mountChrome: mountChrome, ready: ready,
    apps: APPS, app: appBySlug, currentApp: currentApp, money: money, fillIcons: fillIcons,
    base: BASE, url: url, sitePath: sitePath,
    loadScript: loadScript, cachedUser: cachedUser, clearLocal: clearLocal,
    avatarHTML: avatarHTML, initials: initials, themePref: themePref, applyTheme: applyTheme,
    rememberUser: rememberUser, repaintChrome: function () { paintChrome(); TN_largeTitle(); },
    /* Pages call this after changing their <h1> (a screen switch). */
    titleChanged: function () { TN_largeTitle(); }
  };
  window.TN = TN;

  initTheme();
  applyAppAccent();
  // The script sits at the end of <body>, so the header and footer slots
  // already exist and the chrome paints in the same frame as the page.
  if (document.readyState === 'loading' && !el('[data-site-footer]')) {
    document.addEventListener('DOMContentLoaded', mountChrome);
  } else {
    mountChrome();
  }
})();
