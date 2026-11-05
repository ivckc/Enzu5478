/* ==========================================================================
   ANZU UI controller
   - Home: raven centered. Say/type "شعندي مهام هذا الشهر" -> raven shrinks to
     the top-right corner and a card with the tasks appears.
   - Same pattern for habits and goals.
   - Card style + color theme are switchable and remembered.

   Usage:
     AnzuUI.init({
       root: '#home-view',
       data: {
         tasks:  async () => [...],   // [{ title, done, due }]
         habits: async () => [...],   // [{ title, streak, doneToday }]
         goals:  async () => [...]    // [{ title, progress }]  (progress 0..100)
       },
       onUnknown: (text) => { location.hash = '#anzu'; }  // anything that is not a card request
     });
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = { card: 'anzu.cardStyle', theme: 'anzu.theme', side: 'anzu.sideOpen' };
  var CARD_STYLES = ['feather', 'tech'];
  var THEMES = ['copper', 'crimson', 'blue'];
  var S = { root: null, cards: null, grid: null, cfg: {}, data: {}, mode: 'home', timer: null, status: 'idle', section: 'home' };
  var LABELS = { idle: 'جاهز', listening: 'يسمع', thinking: 'يفكر', working: 'يعمل', speaking: 'يحچي', error: 'صار خطأ',
    /* states used by the real page (web/index.html -> state()) */
    think: 'يفكر', alert: 'تذكير', ok: 'تم', off: 'منقطع', net: 'بلا إنترنت', sleep: 'نايم' };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .trim();
  }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x) ? '' : x.getDate() + '/' + (x.getMonth() + 1);
  }

  /* ---------- data normalisation (tolerant to different field names) ---------- */
  function normTask(t) {
    return {
      title: t.title || t.text || t.name || '',
      done: !!(t.done || t.completed || t.status === 'done'),
      due: t.due || t.dueAt || t.dueDate || t.deadline || null
    };
  }
  function normHabit(h) {
    return {
      title: h.title || h.name || '',
      streak: h.streak || h.currentStreak || 0,
      done: !!(h.doneToday || h.completedToday || h.done)
    };
  }
  function normGoal(g) {
    var p = g.progress;
    if (p == null && g.tasksTotal) p = (g.tasksDone / g.tasksTotal) * 100;
    return { title: g.title || g.name || '', progress: Math.max(0, Math.min(100, Number(p) || 0)) };
  }

  /* ---------- intent detection ---------- */
  function detect(text) {
    var t = norm(text);
    if (!t) return null;
    if (/رجوع|ارجع|الرئيسيه|اغلق|اخفي/.test(t)) return { section: 'home' };
    if (/اعدادات|الاعدادات|ثيم|مظهر/.test(t)) return { section: 'settings' };
    if (/ضيف|اضف|احذف|امسح|اكمل|انجز|عدل|add |delete|remove/.test(t)) return null;

    var section = null;
    if (/مهام|مهمه|task/.test(t)) section = 'tasks';
    else if (/عادات|عاده|habit/.test(t)) section = 'habits';
    else if (/اهداف|هدف|goal/.test(t)) section = 'goals';
    if (!section) return null;

    var period = 'all';
    if (/الشهر|شهر/.test(t)) period = 'month';
    else if (/اليوم/.test(t)) period = 'today';
    else if (/اسبوع/.test(t)) period = 'week';
    return { section: section, period: period };
  }

  function inPeriod(due, period) {
    if (!due) return false;
    var d = new Date(due), n = new Date();
    if (isNaN(d)) return false;
    if (period === 'month') return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    if (period === 'today') return d.toDateString() === n.toDateString();
    if (period === 'week') {
      var start = new Date(n.getFullYear(), n.getMonth(), n.getDate());
      var end = new Date(start); end.setDate(start.getDate() + 7);
      return d >= start && d <= end;
    }
    return true;
  }

  /* ---------- card builders ---------- */
  function row(text, done, meta, r) {
    return '<li class="acard-row" data-done="' + (done ? 1 : 0) + '" style="--r:' + r + '">' +
      '<span class="acard-check"></span><span class="acard-text">' + esc(text) + '</span>' +
      (meta ? '<span class="acard-meta">' + esc(meta) + '</span>' : '') + '</li>';
  }
  function card(o, i) {
    var body = o.html
      ? o.html
      : (o.rows && o.rows.length
          ? '<ul class="acard-rows">' + o.rows.join('') + '</ul>'
          : '<div class="acard-empty">' + esc(o.empty || '') + '</div>');
    return '<article class="acard-wrap" style="--i:' + i + '"><div class="acard"><div class="acard-in">' +
      '<header><span class="acard-label">' + esc(o.label) + '</span>' +
      '<div class="acard-titlebar">' +
      (o.num === '' ? '' : '<span class="acard-num">' + esc(o.num) + '</span>') +
      '<h3 class="acard-title">' + esc(o.title) + '</h3></div>' +
      '<p class="acard-sub">' + esc(o.sub) + '</p></header>' +
      (o.p == null ? '' : '<div class="acard-bar"><i style="--p:' + o.p + '"></i></div>') +
      '<div class="acard-body">' + body + '</div>' +
      '</div></div></article>';
  }

  function tasksCards(list, period) {
    var P = {
      month: ['MONTH', 'مهام هذا الشهر'],
      today: ['TODAY', 'مهام اليوم'],
      week: ['WEEK', 'مهام هذا الأسبوع'],
      all: ['ALL', 'كل المهام']
    }[period];
    var main = period === 'all' ? list : list.filter(function (t) { return inPeriod(t.due, period); });
    main = main.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (new Date(a.due || 8.64e15)) - (new Date(b.due || 8.64e15));
    });
    var done = main.filter(function (t) { return t.done; }).length;
    var und = period === 'all' ? [] : list.filter(function (t) { return !t.due && !t.done; });

    var rows = main.map(function (t, r) { return row(t.title, t.done, fmtDate(t.due), r); });
    if (!main.length) rows.push('<li class="acard-empty">ما أكو مهام بهذي الفترة. ارتاح شوية.</li>');
    if (und.length) {
      rows.push('<li class="acard-sep">// بلا موعد</li>');
      und.forEach(function (t, k) { rows.push(row(t.title, false, '', main.length + k)); });
    }

    return [card({
      label: 'TASKS // ' + P[0], title: P[1], num: (main.length - done) + und.length,
      sub: done + ' من ' + main.length + ' منجزة' + (und.length ? ' · ' + und.length + ' بلا موعد' : ''),
      p: main.length ? done / main.length : 0,
      rows: rows
    }, 0)];
  }

  function habitsCards(list) {
    var done = list.filter(function (h) { return h.done; }).length;
    return [card({
      label: 'HABITS // TODAY', title: 'عادات اليوم', num: list.length - done,
      sub: 'تمّت ' + done + ' من ' + list.length + ' اليوم',
      p: list.length ? done / list.length : 0,
      rows: list.map(function (h, r) { return row(h.title, h.done, h.streak ? h.streak + ' يوم' : '', r); }),
      empty: 'ما أكو عادات بعد. ضيف أول وحدة.'
    }, 0)];
  }

  function goalsCards(list) {
    var avg = list.length ? list.reduce(function (s, g) { return s + g.progress; }, 0) / list.length : 0;
    return [card({
      label: 'GOALS // ACTIVE', title: 'الأهداف', num: list.length,
      sub: 'متوسط التقدم ' + Math.round(avg) + '%', p: avg / 100,
      rows: list.map(function (g, r) { return row(g.title, g.progress >= 100, Math.round(g.progress) + '%', r); }),
      empty: 'ما أكو أهداف بعد.'
    }, 0)];
  }

  function settingsCards() {
    return [card({
      label: 'SETTINGS // APPEARANCE', title: 'الإعدادات', num: '',
      sub: 'شكل البطاقات والألوان', p: null,
      html: '<div data-anzu-appearance></div>'
    }, 0)];
  }

  function errorCards() {
    return [card({
      label: 'SYSTEM // ERROR', title: 'ما اكدر اوصل للبيانات', num: '!',
      sub: 'اربط AnzuUI.init({ data }) بمصدر بياناتك', p: 0, rows: [], empty: ''
    }, 0)];
  }

  /* ---------- default data adapters (replace with your own) ---------- */
  function fetchList(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    }).then(function (j) { return Array.isArray(j) ? j : (j.items || j.tasks || j.habits || j.goals || j.data || []); });
  }
  var DEFAULT_DATA = {
    tasks: function () { return fetchList('/api/tasks'); },
    habits: function () { return fetchList('/api/habits'); },
    goals: function () { return fetchList('/api/goals'); }
  };

  /* ---------- mode + rendering ---------- */
  function setMode(m) { S.mode = m; S.root.dataset.mode = m; }

  function showCards(list) {
    var wasIn = S.cards.classList.contains('is-in');
    setMode('focus');
    S.cards.classList.remove('is-in');
    clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      S.grid.innerHTML = list.join('');
      void S.cards.offsetWidth;
      S.cards.classList.add('is-in');
      renderAppearance();
    }, wasIn ? 220 : 380);
  }

  function setStatus(st) {
    if (!LABELS[st]) st = 'idle';
    S.status = st;
    if (!S.root) return;
    var el = S.root.querySelector('.anzu-status');
    if (el) { el.dataset.state = st; el.querySelector('span').textContent = LABELS[st]; }
    if (st === 'thinking' || st === 'think' || st === 'working') S.root.dataset.busy = '1'; else delete S.root.dataset.busy;
  }

  function setActive(id) {
    S.section = id;
    S.root.querySelectorAll('.anzu-side-item').forEach(function (b) {
      if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  function home() {
    clearTimeout(S.timer);
    S.cards.classList.remove('is-in');
    setMode('home');
    setActive('home');
    setStatus('idle');
  }

  function go(intent) {
    if (intent.section === 'home') { home(); return Promise.resolve(true); }
    /* sections that open a real page instead of a card (default: only the chat) */
    var navSections = S.cfg.navigate || ['chat'];
    if (navSections.indexOf(intent.section) >= 0) {
      if (S.cfg.onNavigate) S.cfg.onNavigate(intent.section);
      else if (intent.section === 'chat' && S.cfg.onUnknown) S.cfg.onUnknown('');
      return Promise.resolve(true);
    }
    setActive(intent.section);
    if (intent.section === 'settings') {
      setStatus('idle');
      showCards(settingsCards());
      return Promise.resolve(true);
    }

    setStatus('thinking');
    var src = S.data[intent.section];
    return Promise.resolve().then(src).then(function (raw) {
      var list = raw || [];
      if (intent.section === 'tasks') return tasksCards(list.map(normTask), intent.period || 'all');
      if (intent.section === 'habits') return habitsCards(list.map(normHabit));
      return goalsCards(list.map(normGoal));
    }).then(function (cards) {
      setStatus('idle');
      showCards(cards);
      return true;
    }, function (e) {
      console.error('[AnzuUI]', e);
      setStatus('error');
      showCards(errorCards());
      return true;
    });
  }

  function run(text) {
    var intent = detect(text);
    if (!intent) {
      if (S.cfg.onUnknown) S.cfg.onUnknown(text);
      return Promise.resolve(false);
    }
    return go(intent);
  }

  /* ---------- appearance (card style + theme) ---------- */
  function setCardStyle(v) {
    if (CARD_STYLES.indexOf(v) < 0) v = 'feather';
    document.documentElement.dataset.anzuCard = v;
    store(KEY.card, v);
    renderAppearance();
  }
  function setTheme(v) {
    if (THEMES.indexOf(v) < 0) v = 'copper';
    document.documentElement.dataset.anzuTheme = v;
    store(KEY.theme, v);
    renderAppearance();
  }
  function seg(label, options, current, kind) {
    return '<div class="anzu-seg"><span>' + label + '</span><div class="opts">' + options.map(function (o) {
      return '<button type="button" data-kind="' + kind + '" data-v="' + o[0] + '" aria-pressed="' + (o[0] === current) + '">' +
        (o[2] ? '<i style="background:' + o[2] + '"></i>' : '') + o[1] + '</button>';
    }).join('') + '</div></div>';
  }
  function renderAppearance() {
    var hosts = document.querySelectorAll('[data-anzu-appearance]');
    if (!hosts.length) return;
    var d = document.documentElement.dataset;
    hosts.forEach(function (host) {
      host.innerHTML =
        seg('شكل البطاقات', [['feather', 'حافة الريشة'], ['tech', 'واجهة تقنية']], d.anzuCard, 'card') +
        seg('اللون', [['copper', 'نحاسي برتقالي', '#c1613a'], ['crimson', 'أحمر وأسود', '#e5333b'], ['blue', 'أزرق', '#4f8cff']], d.anzuTheme, 'theme');
      host.querySelectorAll('button').forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.kind === 'card') setCardStyle(b.dataset.v); else setTheme(b.dataset.v);
        };
      });
    });
  }

  /* ---------- init ---------- */
  function build(root) {
    S.cards = root.querySelector('.anzu-cards');
    if (!S.cards) {
      S.cards = document.createElement('div');
      S.cards.className = 'anzu-cards';
      S.cards.setAttribute('aria-live', 'polite');
      S.cards.innerHTML = '<div class="anzu-cards-grid"></div>';
      root.appendChild(S.cards);
    }
    S.grid = S.cards.querySelector('.anzu-cards-grid');

    if (!root.querySelector('.anzu-back')) {
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'anzu-back';
      back.textContent = 'رجوع  Esc';
      back.addEventListener('click', home);
      root.appendChild(back);
    }

    if (!root.querySelector('.anzu-status')) {
      var st = document.createElement('div');
      st.className = 'anzu-status';
      st.dataset.state = 'idle';
      st.setAttribute('role', 'status');
      st.innerHTML = '<i></i><span>' + LABELS.idle + '</span>';
      root.appendChild(st);
    }

    if (S.cfg.sidebar !== false && !root.querySelector('.anzu-side')) {
      var ICON = function (p) {
        return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
      };
      var NAV = [
        ['home', 'الرئيسية', '<path d="M2.5 7.5 8 3l5.5 4.5V13h-4V9.5h-3V13h-4z"/>'],
        ['chat', 'أنزو', '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>'],
        ['tasks', 'المهام', '<rect x="2.5" y="2.5" width="11" height="11"/><path d="m5.2 8.2 2 2 3.6-4"/>'],
        ['habits', 'العادات', '<path d="M3 8a5 5 0 0 1 8.7-3.3L13 6M13 8a5 5 0 0 1-8.7 3.3L3 10M13 3v3h-3M3 13v-3h3"/>'],
        ['goals', 'الأهداف', '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/>'],
        ['settings', 'الإعدادات', '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>']
      ];
      var nav = document.createElement('nav');
      nav.className = 'anzu-side';
      nav.setAttribute('aria-label', 'الأقسام');
      nav.dataset.open = store(KEY.side) === '1' ? '1' : '0';
      nav.innerHTML = '<button type="button" class="anzu-side-toggle" aria-label="توسيع القائمة">' +
        ICON('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>') + '</button>' +
        NAV.map(function (n) {
          return '<button type="button" class="anzu-side-item" data-id="' + n[0] + '"' + (n[0] === 'settings' ? ' data-end' : '') + '>' +
            ICON(n[2]) + '<span>' + n[1] + '</span></button>';
        }).join('');
      nav.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('anzu-side-toggle')) {
          nav.dataset.open = nav.dataset.open === '1' ? '0' : '1';
          store(KEY.side, nav.dataset.open);
          return;
        }
        var id = b.dataset.id;
        go(id === 'tasks' ? { section: 'tasks', period: 'all' } : { section: id });
      });
      root.appendChild(nav);
    }
  }

  function init(cfg) {
    cfg = cfg || {};
    S.cfg = cfg;
    S.root = typeof cfg.root === 'string' ? document.querySelector(cfg.root) : cfg.root;
    if (!S.root) { console.error('[AnzuUI] root not found'); return null; }
    S.root.classList.add('anzu-home');
    S.data = {
      tasks: (cfg.data && cfg.data.tasks) || DEFAULT_DATA.tasks,
      habits: (cfg.data && cfg.data.habits) || DEFAULT_DATA.habits,
      goals: (cfg.data && cfg.data.goals) || DEFAULT_DATA.goals
    };

    var savedCard = store(KEY.card), savedTheme = store(KEY.theme);
    document.documentElement.dataset.anzuCard = CARD_STYLES.indexOf(savedCard) >= 0 ? savedCard : 'feather';
    document.documentElement.dataset.anzuTheme = THEMES.indexOf(savedTheme) >= 0 ? savedTheme : 'copper';

    /* inject the vector raven if the wrapper is empty (needs anzu-raven.js loaded first) */
    var rv = S.root.querySelector('[data-anzu-raven]');
    if (rv && !rv.firstElementChild && global.ANZU_RAVEN_SVG) rv.innerHTML = global.ANZU_RAVEN_SVG;
    build(S.root);
    setMode('home');
    setActive('home');
    setStatus('idle');
    renderAppearance();

    var input = S.root.querySelector('[data-anzu-command]');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return;
        var v = input.value.trim();
        if (!v) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        input.value = '';
        run(v);
      }, true);
    }

    document.addEventListener('keydown', function (e) {
      if (!S.root.offsetParent) return;
      var typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape' && S.mode === 'focus') home();
      if (e.key === '/' && !typing && input) { e.preventDefault(); input.focus(); }
    });

    return API;
  }

  var API = { init: init, run: run, go: go, home: home, setStatus: setStatus, setCardStyle: setCardStyle, setTheme: setTheme, renderAppearance: renderAppearance };
  global.AnzuUI = API;
})(window);
