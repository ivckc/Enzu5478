// ANZU background: theme gradient + stars + raven constellation + the section planets of the home screen.
// Follows the active color theme and the raven's state (thinking, listening, alert, offline...).
(function () {
  if (window.anzuStars) return;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.createElement('canvas');
  canvas.id = 'anzu-stars';
  document.body.prepend(canvas);
  var ctx = canvas.getContext('2d');
  var tmp = document.createElement('canvas').getContext('2d');

  var W = 0, H = 0, DPR = 1;
  var stars = [];
  var shoot = null, nextShoot = 6;
  var accent = [193, 97, 58, 1];
  var glow = [193, 97, 58, 0.14];
  var bg = [[6, 3, 2, 1], [11, 5, 4, 1], [26, 13, 8, 1]];
  var speed = 1, speedTarget = 1;
  var dim = 1, dimTarget = 1;
  var boostNow = 1, boostTarget = 1;
  var mx = 0, my = 0, px = 0, py = 0;
  var t = 0, last = 0;
  var cAlpha = 0.18;
  var curState = '';

  // raven state -> how fast the sky moves, how bright it is, how strong the glow is
  var STATE = {
    idle:      { s: 1,   d: 1,    b: 1 },
    ok:        { s: 1.6, d: 1,    b: 1.2 },
    think:     { s: 3.5, d: 1,    b: 1.25 },
    thinking:  { s: 3.5, d: 1,    b: 1.25 },
    working:   { s: 3.5, d: 1,    b: 1.25 },
    listening: { s: 2.2, d: 1,    b: 1.15 },
    speaking:  { s: 2.6, d: 1,    b: 1.2 },
    alert:     { s: 4.2, d: 1,    b: 1.6 },
    error:     { s: 1.2, d: 0.8,  b: 1 },
    sleep:     { s: 0.4, d: 0.55, b: 0.7 },
    off:       { s: 0.2, d: 0.3,  b: 0.5 },
    net:       { s: 0.2, d: 0.3,  b: 0.5 }
  };

  // ---- raven constellation (perched raven, head to the left, one wing raised) ----
  var CP = [
    [0.05, 0.36], // 0 beak
    [0.17, 0.28], // 1 head (the eye, brightest)
    [0.30, 0.33], // 2 nape
    [0.45, 0.38], // 3 shoulder
    [0.62, 0.50], // 4 back
    [0.78, 0.66], // 5 tail
    [0.94, 0.82], // 6 tail tip
    [0.60, 0.68], // 7 belly rear
    [0.40, 0.64], // 8 belly
    [0.25, 0.52], // 9 chest
    [0.14, 0.43], // 10 throat
    [0.36, 0.88], // 11 foot
    [0.52, 0.88], // 12 foot
    [0.68, 0.20], // 13 wing tip
    [0.50, 0.24]  // 14 wing top
  ];
  var CE = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [0, 10], [10, 9], [9, 8], [8, 7], [7, 5],
    [3, 14], [14, 13], [13, 4],
    [8, 11], [7, 12]
  ];

  function parseColor(v, fb) {
    if (!v) return fb;
    tmp.fillStyle = '#010203';
    tmp.fillStyle = v;
    var h = tmp.fillStyle;
    if (h === '#010203' && v.replace(/\s/g, '').toLowerCase() !== '#010203') return fb;
    if (h.charAt(0) === '#') {
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
    }
    var m = h.match(/[\d.]+/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : fb;
  }

  function cssVar(names) {
    var cs = getComputedStyle(document.documentElement);
    for (var i = 0; i < names.length; i++) {
      var v = cs.getPropertyValue(names[i]).trim();
      if (v) return v;
    }
    return '';
  }

  function readTheme() {
    accent = parseColor(cssVar(['--a-accent', '--ac']), accent);
    glow = parseColor(cssVar(['--a-glow']), glow);
    bg = [
      parseColor(cssVar(['--a-bg-1']), bg[0]),
      parseColor(cssVar(['--a-bg-2']), bg[1]),
      parseColor(cssVar(['--a-bg-3']), bg[2])
    ];
  }

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + Math.max(0, Math.min(1, a)) + ')';
  }

  // read the raven's state: the status chip first (it also knows listening/speaking), then body[data-st]
  function readState() {
    var el = document.querySelector('.anzu-status[data-state]');
    var v = el && el.getAttribute('data-state');
    if (v && STATE[v]) return v;
    var st = document.body && document.body.dataset && document.body.dataset.st;
    return st && STATE[st] ? st : 'idle';
  }

  function applyState(name) {
    if (name === curState) return;
    var prev = curState;
    curState = name;
    document.documentElement.setAttribute('data-anzu-state', name); // the ring styles in anzu-theme.css read this
    var m = STATE[name] || STATE.idle;
    speedTarget = m.s;
    dimTarget = m.d;
    boostTarget = m.b;
    if ((name === 'ok' || name === 'alert') && prev !== name) nextShoot = 0; // celebrate with a shooting star
  }

  function checkState() { applyState(readState()); }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var n = Math.min(Math.round((W * H) / (W < 700 ? 7000 : 5500)), 320);
    stars = [];
    for (var i = 0; i < n; i++) {
      var d = 0.25 + Math.random() * 0.75;
      var r = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        d: d,
        r: (0.35 + Math.random() * 1.0) * (0.6 + d * 0.8),
        a: 0.35 + Math.random() * 0.6,
        tw: 0.6 + Math.random() * 2.2,
        ph: Math.random() * 6.28,
        glow: r > 0.93,
        tint: r > 0.8
      });
    }
    if (reduce) { t = 20; frame(0); }
  }

  // where the constellation sits: bottom-left corner on desktop (clear of the planets), top center on phones
  function constellationBox() {
    if (W < 700) {
      var s = W * 0.5;
      return { x: (W - s * 1.2) / 2, y: H * 0.07, sx: s * 1.2, sy: s * 0.8 };
    }
    var u = Math.min(W, H) * 0.26;
    return { x: W * 0.05, y: H * 0.60, sx: u * 1.25, sy: u * 0.95 };
  }

  function drawConstellation(dt) {
    var home = document.body.classList.contains('home');
    var target = home ? 1 : 0.16;
    cAlpha += (target - cAlpha) * Math.min(dt * 2, 1);
    var A = cAlpha * dim;
    if (A < 0.01) return;

    var box = constellationBox();
    var prog = reduce ? CE.length : Math.max(0, Math.min((t - 1) / 4, 1)) * CE.length; // draw-in on load
    var bob = reduce ? 0 : Math.sin(t * 0.5) * 2;
    var live = Math.max(0, Math.min((speed - 1) / 2.5, 1)); // brighter when the raven is busy

    function pt(i) {
      return [
        box.x + CP[i][0] * box.sx + px * 8,
        box.y + CP[i][1] * box.sy + py * 8 + bob
      ];
    }

    // lines
    ctx.lineWidth = 1;
    for (var e = 0; e < CE.length; e++) {
      var k = Math.max(0, Math.min(prog - e, 1));
      if (k <= 0) continue;
      var a = pt(CE[e][0]), b = pt(CE[e][1]);
      ctx.strokeStyle = rgba(accent, (0.16 + 0.16 * live) * A * k);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
      ctx.stroke();
    }

    // stars of the constellation
    for (var i = 0; i < CP.length; i++) {
      var shown = 0;
      for (var q = 0; q < CE.length; q++) {
        if (CE[q][0] === i || CE[q][1] === i) shown = Math.max(shown, Math.max(0, Math.min(prog - q, 1)));
      }
      if (shown <= 0) continue;
      var p = pt(i);
      var eye = i === 1;
      var tw = reduce ? 1 : (0.7 + 0.3 * Math.sin(t * (eye ? 2.4 : 1.3) + i * 1.7));
      var r = eye ? 2.6 : 1.7;
      var al = (eye ? 0.95 : 0.7) * tw * A * shown;
      var rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 6);
      rg.addColorStop(0, rgba(accent, al * 0.6));
      rg.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(p[0] - r * 6, p[1] - r * 6, r * 12, r * 12);
      ctx.fillStyle = eye ? rgba([255, 214, 170], al) : rgba([243, 231, 220], al);
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 6.2832);
      ctx.fill();
    }

    // a spark that runs along the lines while the raven is busy
    if (!reduce && speed > 1.8 && prog >= CE.length) {
      var u = t * 2.2;
      var ei = Math.floor(u) % CE.length;
      var f = u - Math.floor(u);
      var sa = pt(CE[ei][0]), sb = pt(CE[ei][1]);
      var sx = sa[0] + (sb[0] - sa[0]) * f, sy = sa[1] + (sb[1] - sa[1]) * f;
      var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 9);
      sg.addColorStop(0, rgba([255, 235, 205], 0.9 * A));
      sg.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 9, sy - 9, 18, 18);
    }
  }

  // ---------- section planets (home screen) ----------
  // Each section is a planet on its own orbit around the raven, like a small solar system.
  // Hover = the planet slows down and its name shows. Click = opens the section (same as the old sidebar).
  var ICON = function (p) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  };
  var PLANETS = [
    { id: 'chat',     name: 'أنزو',      size: 40, off: 0,   icon: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>' },
    { id: 'tasks',    name: 'المهام',    size: 48, off: 14,  icon: '<rect x="2.5" y="2.5" width="11" height="11"/><path d="m5.2 8.2 2 2 3.6-4"/>' },
    { id: 'habits',   name: 'العادات',   size: 44, off: -14, icon: '<path d="M3 8a5 5 0 0 1 8.7-3.3L13 6M13 8a5 5 0 0 1-8.7 3.3L3 10M13 3v3h-3M3 13v-3h3"/>' },
    { id: 'goals',    name: 'الأهداف',   size: 52, off: 26,  icon: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/>' },
    { id: 'health',   name: 'الصحة',     size: 46, off: -26, icon: '<path d="M8 13.2S2.6 9.8 2.6 6.1a2.9 2.9 0 0 1 5.4-1.4 2.9 2.9 0 0 1 5.4 1.4C13.4 9.8 8 13.2 8 13.2z"/>' },
    { id: 'inbox',    name: 'الإشعارات', size: 42, off: 8,  icon: '<path d="M8 2.2a3.8 3.8 0 0 0-3.8 3.8v2.6L3 10.6V12h10v-1.4l-1.2-2V6A3.8 3.8 0 0 0 8 2.2zM6.5 13.4a1.6 1.6 0 0 0 3 0"/>' },
    { id: 'settings', name: 'الإعدادات', size: 50, off: -6,  ring: true, icon: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>' }
  ];
  var homeEl = null, plBuilt = false, plA = 0, plShown = false, plKey = '';
  var pcx = 0, pcy = 0, havePc = false;
  var plOrb = null;
  var PHI = -0.12; // slight tilt of the whole orbit plane

  function openSection(id) {
    var item = document.querySelector('.anzu-side-item[data-id="' + id + '"]');
    if (item) { item.click(); return; }
    if (typeof window.go === 'function') window.go(id === 'chat' ? 'anzu' : id);
  }

  function buildPlanets() {
    if (plBuilt) return;
    homeEl = document.getElementById('home-view');
    if (!homeEl) return;
    plBuilt = true;
    PLANETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'anzu-planet' + (p.ring ? ' anzu-planet--ring' : '');
      b.setAttribute('aria-label', p.name);
      b.dataset.planet = p.id;
      b.style.width = b.style.height = p.size + 'px';
      b.style.visibility = 'hidden';
      b.innerHTML = ICON(p.icon) + '<span class="pl-name">' + p.name + '</span>';
      b.addEventListener('click', function () { openSection(p.id); });
      b.addEventListener('pointerenter', function () { p.hov = true; });
      b.addEventListener('pointerleave', function () { p.hov = false; });
      b.addEventListener('focus', function () { p.hov = true; });
      b.addEventListener('blur', function () { p.hov = false; });
      homeEl.appendChild(b);
      p.el = b;
      p.th = i * 2.4 + 0.7; // spread the planets around their orbits
      p.mult = 1; p.h = 0; p.z = 0; p.hov = false;
    });
    plKey = '';
    paintPlanets();
  }

  // planet colors come from the active theme color, shifted in hue so each planet is different
  function paintPlanets() {
    if (!plBuilt) return;
    var key = accent.join(',');
    if (key === plKey) return;
    plKey = key;
    var r = accent[0] / 255, g = accent[1] / 255, b = accent[2] / 255;
    var mxv = Math.max(r, g, b), mnv = Math.min(r, g, b), l = (mxv + mnv) / 2, h = 0, sat = 0, d = mxv - mnv;
    if (d) {
      sat = l > 0.5 ? d / (2 - mxv - mnv) : d / (mxv + mnv);
      h = mxv === r ? ((g - b) / d + (g < b ? 6 : 0)) : (mxv === g ? (b - r) / d + 2 : (r - g) / d + 4);
      h *= 60;
    }
    sat = Math.round(Math.max(0.5, Math.min(sat, 0.9)) * 100);
    PLANETS.forEach(function (p) {
      var hh = Math.round((h + p.off + 360) % 360);
      var st = p.el.style;
      st.setProperty('--pl-hi', 'hsl(' + hh + ',' + sat + '%,72%)');
      st.setProperty('--pl-mid', 'hsl(' + hh + ',' + sat + '%,50%)');
      st.setProperty('--pl-lo', 'hsl(' + hh + ',' + Math.round(sat * 0.9) + '%,18%)');
      st.setProperty('--pl-glow', 'hsla(' + hh + ',' + sat + '%,55%,0.45)');
      st.setProperty('--pl-ring', 'hsla(' + hh + ',' + sat + '%,78%,0.7)');
    });
  }

  function layoutPlanets(dt) {
    if (!plBuilt) { buildPlanets(); if (!plBuilt) return; }
    var onHome = document.body.classList.contains('home') && homeEl.dataset.mode !== 'focus';
    if (reduce) plA = onHome ? 1 : 0;
    else plA += ((onHome ? 1 : 0) - plA) * Math.min(dt * 4, 1);

    if (plA < 0.02) {
      plOrb = null;
      if (plShown) { PLANETS.forEach(function (p) { p.el.style.visibility = 'hidden'; }); plShown = false; }
      return;
    }
    plShown = true;

    // center = the raven (it moves up while a reply is open, the planets follow smoothly)
    var rv = homeEl.querySelector('[data-anzu-raven]');
    var rr = rv ? rv.getBoundingClientRect() : null;
    var tx = rr && rr.width ? rr.left + rr.width / 2 : W / 2;
    var ty = rr && rr.height ? rr.top + rr.height / 2 : H * 0.46;
    if (!havePc) { pcx = tx; pcy = ty; havePc = true; }
    else { var k = Math.min(dt * 5, 1) || 1; pcx += (tx - pcx) * k; pcy += (ty - pcy) * k; }
    var hr = homeEl.getBoundingClientRect();

    var n = PLANETS.length, narrow = W < 700;
    var r0 = narrow ? W * 0.27 : Math.max(210, Math.min(W * 0.18, 280));
    var r1 = narrow ? W * 0.39 : Math.min(W * 0.40, 560);
    var ratio = Math.min(narrow ? 0.5 : 0.30, (H * 0.27) / r1);
    var gm = Math.pow(Math.max(speed, 0.2), 0.6); // planets speed up while ANZU is busy, slow down when offline
    var cosP = Math.cos(PHI), sinP = Math.sin(PHI);
    var orbits = [];

    for (var i = 0; i < n; i++) {
      var p = PLANETS[i];
      var rx = r0 + (r1 - r0) * i / (n - 1), ry = rx * ratio;
      orbits.push([rx, ry]);
      if (!reduce) {
        p.mult += ((p.hov ? 0.02 : 1) - p.mult) * Math.min(dt * 8, 1);
        p.h += ((p.hov ? 1 : 0) - p.h) * Math.min(dt * 8, 1);
        var period = 42 * Math.pow(rx / r0, 1.5); // seconds, outer planets are slower (like Kepler)
        p.th += (6.2832 / period) * dt * gm * p.mult;
      } else {
        p.h = p.hov ? 1 : 0;
      }
      var ex = Math.cos(p.th) * rx, ey = Math.sin(p.th) * ry;
      var x = pcx + ex * cosP - ey * sinP, y = pcy + ex * sinP + ey * cosP;
      var dep = (Math.sin(p.th) + 1) / 2;                 // 0 = far side, 1 = near side
      var sc = (0.8 + 0.4 * dep) * (1 + 0.15 * p.h) * (narrow ? 0.8 : 1);
      var z = p.h > 0.5 ? 6 : (dep > 0.5 ? 4 : 2);        // far side passes behind the raven, near side in front
      var el = p.el;
      el.style.transform = 'translate(' + (x - hr.left - p.size / 2).toFixed(1) + 'px,' + (y - hr.top - p.size / 2).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      var op = 0.55 + 0.45 * dep;
      el.style.opacity = ((op + (1 - op) * p.h) * plA).toFixed(3);
      if (p.z !== z) { el.style.zIndex = z; p.z = z; }
      el.style.visibility = 'visible';
    }
    plOrb = { cx: pcx, cy: pcy, list: orbits, a: plA };
  }

  function drawOrbits() {
    if (!plOrb) return;
    ctx.save();
    ctx.translate(plOrb.cx, plOrb.cy);
    ctx.rotate(PHI);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 7]);
    ctx.strokeStyle = rgba(accent, 0.38 * plOrb.a * dim);
    for (var i = 0; i < plOrb.list.length; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, plOrb.list[i][0], plOrb.list[i][1], 0, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame(ts) {
    var dt = Math.min(((ts - last) / 1000) || 0, 0.05);
    last = ts;
    t += dt;
    var ease = Math.min(dt * 2, 1);
    speed += (speedTarget - speed) * ease;
    dim += (dimTarget - dim) * ease;
    boostNow += (boostTarget - boostNow) * ease;
    px += (mx - px) * Math.min(dt * 3, 1);
    py += (my - py) * Math.min(dt * 3, 1);

    layoutPlanets(reduce ? 0 : dt);

    // base: same gradient the theme uses
    var base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, rgba(bg[0], 1));
    base.addColorStop(0.55, rgba(bg[1], 1));
    base.addColorStop(1, rgba(bg[2], 1));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // theme glow behind the raven (breathes a little, stronger when the raven is busy)
    var pulse = 0.5 + 0.5 * Math.sin(t * 0.4);
    var ga = Math.min(glow[3] * (0.85 + 0.15 * pulse) * boostNow * (0.4 + 0.6 * dim), 1);
    var cx = W * 0.5, cy = H * 0.46;
    var gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
    gg.addColorStop(0, rgba(glow, ga));
    gg.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, H);

    drawOrbits();

    // stars
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (!reduce) {
        s.x -= 4 * s.d * speed * dt;
        s.y += 1.2 * s.d * speed * dt;
        if (s.x < -6) s.x = W + 6;
        if (s.y > H + 6) s.y = -6;
      }
      var x = s.x + px * s.d * 14;
      var y = s.y + py * s.d * 14;
      var tw = reduce ? 1 : (0.55 + 0.45 * Math.sin(t * s.tw * (0.6 + 0.4 * Math.min(speed, 2)) + s.ph));
      var al = s.a * tw * dim;
      var col = s.tint ? accent : [232, 224, 208];

      if (s.glow) {
        var rg = ctx.createRadialGradient(x, y, 0, x, y, s.r * 7);
        rg.addColorStop(0, rgba(accent, al * 0.55));
        rg.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(x - s.r * 7, y - s.r * 7, s.r * 14, s.r * 14);
      }
      ctx.fillStyle = rgba(col, al);
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.2832);
      ctx.fill();
    }

    drawConstellation(dt);

    // shooting star (not while offline or asleep)
    if (!reduce) {
      nextShoot -= dt;
      if (!shoot && nextShoot <= 0 && dim > 0.6) {
        shoot = {
          x: W * (0.4 + Math.random() * 0.6),
          y: Math.random() * H * 0.4,
          vx: -(520 + Math.random() * 300),
          vy: 200 + Math.random() * 120,
          life: 0,
          max: 0.9
        };
        nextShoot = 7 + Math.random() * 10;
      } else if (nextShoot <= 0) {
        nextShoot = 3;
      }
      if (shoot) {
        shoot.life += dt;
        shoot.x += shoot.vx * dt;
        shoot.y += shoot.vy * dt;
        var k = shoot.life / shoot.max;
        var a = Math.sin(Math.PI * Math.min(k, 1));
        var hyp = Math.sqrt(shoot.vx * shoot.vx + shoot.vy * shoot.vy);
        var tx = shoot.x - (shoot.vx / hyp) * 90;
        var ty = shoot.y - (shoot.vy / hyp) * 90;
        var lg = ctx.createLinearGradient(shoot.x, shoot.y, tx, ty);
        lg.addColorStop(0, 'rgba(255,240,220,' + a + ')');
        lg.addColorStop(1, rgba(accent, 0));
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(shoot.x, shoot.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        if (k >= 1) shoot = null;
      }
      requestAnimationFrame(frame);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', function (e) {
    mx = e.clientX / W - 0.5;
    my = e.clientY / H - 0.5;
  });

  readTheme();
  buildPlanets();
  setInterval(function () { readTheme(); paintPlanets(); }, 1500); // follows theme changes
  if (reduce) setInterval(function () { layoutPlanets(0); }, 250);

  // follow the raven's state: instantly through attribute changes, plus a light safety check
  if (window.MutationObserver) {
    new MutationObserver(checkState).observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-state', 'data-st']
    });
  }
  setInterval(checkState, 500);
  checkState();

  resize();
  if (!reduce) requestAnimationFrame(frame);

  // debugging helper: anzuStars.state() in the browser console shows the current raven state
  window.anzuStars = {
    state: function () { return curState; }
  };
})();