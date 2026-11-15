/* ANZU notification center (browser side).
   The server keeps each user's notices (inbox.json). The page polls /api/state, and this file
   shows whatever is new, on whatever device has the page open:
     - a pop-up (toast) with sound and vibration
     - a bell in the side bar with an unread counter, and a panel with the list
     - the tab title "(2) ..." and, if you allow it, a system notification while the page is hidden
   Settings (this device only) live in localStorage: toast, sound, vibe, os.
   API: window.AnzuInbox = { update(state), open(), close(), toggle(), prefs(), setPref(k, on), test() } */
(function (global) {
  'use strict';
  var TOKEN = "__TOKEN__";
  var KEY = { toast: 'anzu.in.toast', sound: 'anzu.in.sound', vibe: 'anzu.in.vibe', os: 'anzu.in.os', seen: 'anzu.in.seen' };

  var S = { items: [], unread: 0, panel: null, panelOpen: false, toasts: null, baseTitle: document.title, blink: null, audio: null, readTimer: null };

  function store(k, v) {
    try {
      if (v === undefined) return global.localStorage.getItem(k);
      global.localStorage.setItem(k, v);
    } catch (e) { /* private mode */ }
    return null;
  }
  function flag(k, def) { var v = store(k); return v === null ? def : v === '1'; }
  function osReady() { return typeof global.Notification !== 'undefined' && global.Notification.permission === 'granted'; }

  function prefs() {
    return { toast: flag(KEY.toast, true), sound: flag(KEY.sound, true), vibe: flag(KEY.vibe, true), os: flag(KEY.os, false) && osReady() };
  }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('ain-css')) return;
    var st = document.createElement('style');
    st.id = 'ain-css';
    st.textContent = [
      '.ain-toasts{position:fixed;top:76px;right:16px;width:min(360px,calc(100vw - 32px));z-index:80;display:flex;flex-direction:column;gap:8px;pointer-events:none;}',
      'body.home .ain-toasts{top:124px;}',
      '.ain-toast{pointer-events:auto;cursor:pointer;box-sizing:border-box;padding:10px 14px;background:var(--a-card,var(--a-bar-bg,#150b08));border:1px solid var(--a-line-strong,#5a3a28);border-inline-start:3px solid var(--a-accent,#d98a60);color:var(--a-text,#f1e4d8);font:400 14px/1.7 var(--a-font-body,inherit);box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;transform:translateX(18px);transition:opacity .28s ease,transform .28s ease;position:relative;}',
      '.ain-toast[data-show="1"]{opacity:1;transform:none;}',
      '.ain-toast b{display:block;font-weight:600;padding-inline-end:18px;}',
      '.ain-toast span{display:block;color:var(--a-muted,#a88a76);white-space:pre-wrap;max-height:5.1em;overflow:hidden;}',
      '.ain-toast i{position:absolute;top:6px;inset-inline-end:10px;font-style:normal;color:var(--a-muted,#a88a76);cursor:pointer;}',
      '.ain-toast[data-p="5"],.ain-toast[data-p="4"]{border-inline-start-color:#ffb347;}',
      '.ain-ov{position:fixed;inset:0;z-index:84;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .25s ease;}',
      '.ain-ov[data-show="1"]{opacity:1;pointer-events:auto;}',
      '.ain-panel{position:fixed;top:0;bottom:0;right:0;width:min(400px,100vw);z-index:85;box-sizing:border-box;display:flex;flex-direction:column;background:var(--a-card,#150b08);border-inline-start:1px solid var(--a-line-strong,#5a3a28);color:var(--a-text,#f1e4d8);font:400 14px/1.7 var(--a-font-body,inherit);transform:translateX(105%);transition:transform .32s var(--a-ease,ease);}',
      '.ain-panel[data-show="1"]{transform:none;}',
      '.ain-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--a-line,#3a2418);}',
      '.ain-head h3{margin:0;font:600 16px var(--a-font-body,inherit);flex:1;}',
      '.ain-head button{background:transparent;border:1px solid var(--a-line,#3a2418);color:var(--a-muted,#a88a76);padding:4px 10px;cursor:pointer;font:400 12px var(--a-font-body,inherit);}',
      '.ain-head button:hover{color:var(--a-accent-2,#e8a98a);border-color:var(--a-line-strong,#5a3a28);}',
      '.ain-list{flex:1;overflow:auto;padding:8px 0;}',
      '.ain-item{padding:10px 16px;border-bottom:1px solid var(--a-line,#3a2418);position:relative;}',
      '.ain-item[data-unread="1"]{background:var(--a-glow,rgba(217,138,96,.10));}',
      '.ain-item[data-unread="1"]::before{content:"";position:absolute;top:16px;inset-inline-end:8px;width:7px;height:7px;border-radius:50%;background:var(--a-accent,#d98a60);}',
      '.ain-item b{display:block;font-weight:600;}',
      '.ain-item span{display:block;color:var(--a-muted,#a88a76);white-space:pre-wrap;}',
      '.ain-item small{display:block;margin-top:2px;color:var(--a-muted,#a88a76);opacity:.75;font-size:11px;}',
      '.ain-empty{padding:30px 16px;text-align:center;color:var(--a-muted,#a88a76);}',
      /* the bell in the side bar */
      '.anzu-side-item[data-id="inbox"]{position:relative;}',
      '.anzu-side-item[data-id="inbox"][data-unread]::after{content:attr(data-unread);position:absolute;top:3px;inset-inline-start:22px;min-width:15px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--a-accent,#d98a60);color:var(--a-on-accent,#000);font:700 10px/15px var(--a-font-body,inherit);text-align:center;}',
      '.anzu-side-item[data-id="inbox"][data-unread] svg{color:var(--a-accent-2,#e8a98a);}',
      '@media (prefers-reduced-motion:reduce){.ain-toast,.ain-panel,.ain-ov{transition:none;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toLocaleString(); }
  }
  function send(text) {
    return fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Anzu-Token': TOKEN },
      credentials: 'same-origin',
      body: JSON.stringify({ text: text })
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* ---------- sound + vibration ---------- */
  function beep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      if (!S.audio) S.audio = new AC();
      var ctx = S.audio;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      [[880, 0], [660, 0.16]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + n[1];
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + 0.3);
      });
    } catch (e) { /* the browser did not allow sound yet */ }
  }
  function buzz() { try { if (global.navigator && global.navigator.vibrate) global.navigator.vibrate([120, 60, 120]); } catch (e) {} }

  /* ---------- toasts ---------- */
  function toastBox() {
    if (!S.toasts) { S.toasts = el('div', 'ain-toasts'); S.toasts.setAttribute('aria-live', 'polite'); document.body.appendChild(S.toasts); }
    return S.toasts;
  }
  function toast(title, message, priority) {
    var box = toastBox();
    var t = el('div', 'ain-toast');
    t.dataset.p = String(priority || 3);
    var x = el('i', '', '×');
    t.appendChild(x);
    t.appendChild(el('b', '', title));
    if (message) t.appendChild(el('span', '', message));
    function close() { t.dataset.show = '0'; setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320); }
    x.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    t.addEventListener('click', function () { close(); open(); });
    box.appendChild(t);
    while (box.childNodes.length > 4) box.removeChild(box.firstChild);
    requestAnimationFrame(function () { t.dataset.show = '1'; });
    setTimeout(close, (priority || 3) >= 4 ? 12000 : 7000);
  }

  /* ---------- panel ---------- */
  function build() {
    if (S.panel) return;
    var ov = el('div', 'ain-ov');
    var p = el('div', 'ain-panel');
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'الإشعارات');
    var head = el('div', 'ain-head');
    head.appendChild(el('h3', '', 'الإشعارات'));
    var rd = el('button', '', 'تعليم الكل كمقروء');
    rd.type = 'button';
    rd.addEventListener('click', function () { markRead(); });
    var cl = el('button', '', 'إغلاق');
    cl.type = 'button';
    cl.addEventListener('click', close);
    head.appendChild(rd); head.appendChild(cl);
    var list = el('div', 'ain-list');
    p.appendChild(head); p.appendChild(list);
    ov.addEventListener('click', close);
    document.body.appendChild(ov); document.body.appendChild(p);
    S.panel = { ov: ov, p: p, list: list };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.panelOpen) close(); });
  }
  function renderList() {
    if (!S.panel) return;
    var l = S.panel.list;
    while (l.firstChild) l.removeChild(l.firstChild);
    if (!S.items.length) { l.appendChild(el('div', 'ain-empty', 'ما اكو إشعارات بعد.')); return; }
    S.items.forEach(function (i) {
      var d = el('div', 'ain-item');
      d.dataset.unread = i.read ? '0' : '1';
      d.appendChild(el('b', '', i.title));
      if (i.message) d.appendChild(el('span', '', i.message));
      d.appendChild(el('small', '', when(i.time)));
      l.appendChild(d);
    });
  }
  function open() {
    build(); renderList();
    S.panelOpen = true;
    S.panel.ov.dataset.show = '1'; S.panel.p.dataset.show = '1';
    clearTimeout(S.readTimer);
    S.readTimer = setTimeout(function () { if (S.panelOpen && S.unread > 0) markRead(); }, 1500);
  }
  function close() {
    S.panelOpen = false;
    clearTimeout(S.readTimer);
    if (S.panel) { S.panel.ov.dataset.show = '0'; S.panel.p.dataset.show = '0'; }
  }
  function toggle() { if (S.panelOpen) close(); else open(); }
  function markRead() {
    S.items.forEach(function (i) { i.read = true; });
    S.unread = 0; badge(); renderList(); title();
    return send('inbox read').then(function () { if (typeof global.poll === 'function') global.poll(); });
  }

  /* ---------- bell + title ---------- */
  function badge() {
    var b = document.querySelector('.anzu-side-item[data-id="inbox"]');
    if (!b) return;
    if (S.unread > 0) b.setAttribute('data-unread', S.unread > 9 ? '9+' : String(S.unread)); else b.removeAttribute('data-unread');
  }
  function title() {
    clearInterval(S.blink); S.blink = null;
    if (S.unread > 0 && document.hidden) {
      var on = false;
      S.blink = setInterval(function () {
        on = !on;
        document.title = on ? '🔔 (' + S.unread + ') ' + S.baseTitle : S.baseTitle;
      }, 1200);
    } else {
      document.title = S.baseTitle;
    }
  }
  document.addEventListener('visibilitychange', title);

  /* ---------- new items ---------- */
  function announce(fresh) {
    var p = prefs();
    var many = fresh.length > 3;
    if (p.toast) {
      if (many) toast(fresh.length + ' إشعار جديد', 'افتح الجرس لتشوفهم.', 3);
      else fresh.forEach(function (i) { toast(i.title, i.message, i.priority); });
    }
    if (p.sound) beep();
    if (p.vibe) buzz();
    if (p.os && document.hidden) {
      try {
        (many ? [{ title: fresh.length + ' إشعار جديد من أنزو', message: '' }] : fresh).slice(0, 3).forEach(function (i) {
          var n = new global.Notification(i.title, { body: i.message || '', tag: 'anzu-' + (i.id || 'many'), dir: 'rtl', lang: 'ar' });
          n.onclick = function () { try { global.focus(); } catch (e) {} open(); n.close(); };
        });
      } catch (e) { /* not allowed here */ }
    }
  }

  function update(state) {
    var box = state && state.inbox;
    if (!box || !Array.isArray(box.items)) return;
    css();
    S.items = box.items;
    S.unread = box.unread || 0;
    badge(); title();
    if (S.panelOpen) renderList();
    var top = 0;
    S.items.forEach(function (i) { if (i.id > top) top = i.id; });
    var raw = store(KEY.seen);
    if (raw === null) { store(KEY.seen, String(top)); return; }   /* first time on this device: do not flood */
    var seen = Number(raw) || 0;
    var fresh = S.items.filter(function (i) { return i.id > seen && !i.read; }).sort(function (a, b) { return a.id - b.id; });
    if (top > seen) store(KEY.seen, String(top));
    if (fresh.length) announce(fresh);
  }

  /* ---------- settings of this device ---------- */
  function setPref(k, on) {
    if (!KEY[k] || k === 'seen') return Promise.resolve(prefs());
    if (k === 'os' && on) {
      if (typeof global.Notification === 'undefined') { toast('إشعارات النظام', 'هذا المتصفح ما يدعمها.', 3); return Promise.resolve(prefs()); }
      return Promise.resolve(global.Notification.requestPermission()).then(function (r) {
        store(KEY.os, r === 'granted' ? '1' : '0');
        if (r !== 'granted') toast('إشعارات النظام', 'المتصفح ما سمح. غيّر الإذن من إعدادات الموقع.', 3);
        return prefs();
      });
    }
    store(KEY[k], on ? '1' : '0');
    if (on && k === 'sound') beep();
    return Promise.resolve(prefs());
  }
  function test() {
    return send('inbox test').then(function () { if (typeof global.poll === 'function') global.poll(); });
  }

  global.AnzuInbox = { update: update, open: open, close: close, toggle: toggle, prefs: prefs, setPref: setPref, test: test };
  css();
})(window);
