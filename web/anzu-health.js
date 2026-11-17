/* ANZU Health tab. Draws the "الصحة" page from S.health (the server's health snapshot) and runs
   the health commands (water, sleep, workout, mood, meal, health ...).
   It uses helpers that index.html already has: $, esc, S, drafts, guard, back, bars, cmd, redraw, ring.
   Targets on the page are ESTIMATES (general information, not medical advice). */
(function (global) {
  'use strict';

  var hlMood = null, hlEnergy = null;
  var DAYI = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']; /* Sunday .. Saturday */
  var SLOT_AR = { breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء', snack: 'سناك' };
  var INT_AR = ['', 'خفيف', 'متوسط', 'قوي'];
  var FACES = ['😞', '🙁', '😐', '🙂', '😄'];

  function css() {
    if (document.getElementById('hl-css')) return;
    var st = document.createElement('style');
    st.id = 'hl-css';
    st.textContent = [
      '.hl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px;margin:10px 0 16px;}',
      '.hl-card{border:1px solid var(--ln);background:#120a07cc;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0;}',
      '.hl-card h3{margin:0;font-size:15px;display:flex;justify-content:space-between;align-items:center;gap:8px;}',
      '.hl-card h3 small{color:var(--mu,#a88a76);font-weight:400;}',
      '.hl-card .ring{width:92px;height:92px;margin:2px auto;}',
      '.hl-big{font-size:20px;font-weight:600;text-align:center;}',
      '.hl-sub{color:var(--mu,#a88a76);font-size:12px;text-align:center;}',
      '.hl-form{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}',
      '.hl-form input,.hl-form select{flex:1 1 80px;min-width:0;}',
      '.hl-btns{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;}',
      '.hl-faces{display:flex;gap:6px;justify-content:center;}',
      '.hl-faces span{font-size:24px;line-height:1;padding:4px 6px;border:1px solid var(--ln);cursor:pointer;opacity:.55;background:#0b0605;}',
      '.hl-faces span.on{opacity:1;border-color:var(--ac);background:#2a1a12;}',
      '.hl-en span{font-size:15px;min-width:26px;text-align:center;font-family:monospace;}',
      '.hl-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin-bottom:16px;}',
      '.hl-ch{border:1px solid var(--ln);background:#120a07cc;padding:12px;}',
      '.hl-ch b{font-size:13px;}',
      '.hl-bars{position:relative;display:flex;gap:6px;align-items:flex-end;height:96px;margin-top:8px;border-bottom:1px solid var(--ln);}',
      '.hl-c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}',
      '.hl-b{width:100%;max-width:26px;background:var(--ac);min-height:0;transition:height .3s;}',
      '.hl-c small{position:absolute;bottom:-17px;color:var(--mu,#a88a76);font-size:10px;}',
      '.hl-g{position:absolute;left:0;right:0;border-top:1px dashed var(--ac-2,#e8a98a);opacity:.7;pointer-events:none;}',
      '.hl-list .row{margin-bottom:6px;padding:8px 10px;}',
      '.hl-list .row button{padding:2px 8px;}',
      '.hl-note{color:var(--mu,#a88a76);font-size:12px;margin:2px 0 10px;}',
      '.hl-side label{display:block;margin-bottom:8px;font-size:13px;}',
      '.hl-side input,.hl-side select{width:100%;box-sizing:border-box;margin-top:3px;}',
      '.hl-auto{color:var(--ac-2,#e8a98a);font-size:11px;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function hm(min) { return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0'); }
  function pct(v, goal) { return goal > 0 ? Math.min(100, Math.round(100 * v / goal)) : 0; }
  function val(id, fallback) { var v = drafts && drafts[id]; return v === undefined ? fallback : v; }
  function read(id) { var e = document.getElementById(id); return e ? String(e.value).trim() : ''; }
  function clear() { for (var i = 0; i < arguments.length; i++) drafts[arguments[i]] = undefined; }

  function chart(title, days, pick, max, goal, fmt) {
    var vals = days.map(pick);
    var nums = vals.filter(function (v) { return v !== null && v !== undefined; });
    var mx = Math.max.apply(null, nums.concat([max || 0, goal || 0, 1]));
    var cols = days.map(function (d, i) {
      var v = vals[i];
      var h = v === null || v === undefined ? 0 : Math.round(100 * v / mx);
      var day = DAYI[new Date(d.date + 'T12:00:00Z').getUTCDay()];
      return '<div class="hl-c"><div class="hl-b" style="height:' + h + '%" title="' + esc(d.date + ': ' + (v === null || v === undefined ? '-' : fmt(v))) + '"></div><small>' + day + '</small></div>';
    }).join('');
    var line = goal ? '<i class="hl-g" style="bottom:' + Math.round(100 * goal / mx) + '%"></i>' : '';
    return '<div class="hl-ch"><b>' + title + '</b><div class="hl-bars">' + cols + line + '</div><div style="height:14px"></div></div>';
  }

  function entryText(e) {
    if (e.type === 'water') return '💧 ' + e.ml + ' مل';
    if (e.type === 'sleep') return '😴 ' + hm(e.minutes || 0) + (e.quality ? ' · جودة ' + e.quality + '/5' : '');
    if (e.type === 'workout') return '🏃 ' + esc(e.kind || 'تمرين') + ' · ' + e.minutes + ' دقيقة · ' + (INT_AR[e.intensity] || '');
    if (e.type === 'mood') return '🙂 مزاج ' + e.mood + '/5' + (e.energy ? ' · طاقة ' + e.energy + '/5' : '') + (e.note ? ' · ' + esc(e.note) : '');
    if (e.type === 'meal') return '🍽 ' + (SLOT_AR[e.slot] || '') + ' · ' + esc(e.text || '') + (e.kcal ? ' · ' + e.kcal + ' سعرة' : '') + (e.protein ? ' · ' + e.protein + 'غ بروتين' : '');
    return esc(e.type);
  }

  function healthView() {
    var H = S && S.health;
    var f = guard([H, hlMood, hlEnergy]);
    if (f === null) return;
    css();
    if (!H) {
      document.getElementById('main').innerHTML = '<p class="cap">HEALTH</p><h1>الصحة</h1>' + bars() +
        '<div class="msg bad">موديول الصحة غير متاح. تأكد إنك سجّلت healthModule بملف الموديولات وأعدت التشغيل.</div>';
      document.getElementById('side').innerHTML = '';
      return;
    }
    var T = H.targets, P = H.profile, days = H.days, today = days[days.length - 1];
    var week = days.slice(-7);
    var weekWork = week.reduce(function (a, d) { return a + d.workoutMin; }, 0);
    var todays = H.entries.filter(function (e) { return e.date === H.today; });
    var minor = T.minor;

    var water = '<div class="hl-card"><h3>💧 الماء <small>' + P.cupMl + ' مل للكاسة</small></h3>' + ring(pct(today.waterMl, T.waterMl)) +
      '<div class="hl-big">' + today.waterMl + ' <small>/ ' + T.waterMl + ' مل</small></div>' +
      '<div class="hl-btns"><button data-b="hlw" data-v="1">+1 كاسة</button><button data-b="hlw" data-v="2">+2</button><button data-b="hlwu">تراجع</button></div></div>';

    var sleepLine = today.sleepMin === null ? 'ما سجلت نوم اليوم' : hm(today.sleepMin) + ' من ' + hm(T.sleepMin) + (today.sleepQ ? ' · جودة ' + today.sleepQ + '/5' : '');
    var sleep = '<div class="hl-card"><h3>😴 النوم <small>الهدف ' + hm(T.sleepMin) + '</small></h3><div class="hl-big">' + sleepLine + '</div>' +
      '<div class="hl-form"><input id="hlbed" type="time" value="' + esc(val('hlbed', '23:00')) + '" title="وقت النوم"><input id="hlwake" type="time" value="' + esc(val('hlwake', '07:00')) + '" title="وقت الاستيقاظ">' +
      '<select id="hlq">' + [0, 1, 2, 3, 4, 5].map(function (q) { return '<option value="' + (q || '') + '"' + (String(val('hlq', '')) === String(q || '') ? ' selected' : '') + '>' + (q ? 'جودة ' + q : 'جودة؟') + '</option>'; }).join('') + '</select>' +
      '<button data-b="hlsl">تسجيل</button></div></div>';

    var work = '<div class="hl-card"><h3>🏃 التمارين <small>هالأسبوع ' + weekWork + ' / ' + T.workoutMin + ' د</small></h3>' +
      '<div class="bar2"><i style="width:' + pct(weekWork, T.workoutMin) + '%"></i></div><div class="hl-sub">اليوم: ' + today.workoutMin + ' دقيقة</div>' +
      '<div class="hl-form"><input id="hlkind" placeholder="النوع (جري، قوة...)" value="' + esc(val('hlkind', '')) + '"><input id="hlmin" type="number" min="1" placeholder="دقائق" value="' + esc(val('hlmin', '')) + '">' +
      '<select id="hlint">' + [1, 2, 3].map(function (i) { return '<option value="' + i + '"' + (String(val('hlint', '2')) === String(i) ? ' selected' : '') + '>' + INT_AR[i] + '</option>'; }).join('') + '</select>' +
      '<button data-b="hlwo">تسجيل</button></div></div>';

    var faces = FACES.map(function (x, i) { return '<span class="' + (hlMood === i + 1 ? 'on' : '') + '" data-b="hlmo" data-v="' + (i + 1) + '" title="مزاج ' + (i + 1) + '">' + x + '</span>'; }).join('');
    var energy = [1, 2, 3, 4, 5].map(function (i) { return '<span class="' + (hlEnergy === i ? 'on' : '') + '" data-b="hlen" data-v="' + i + '">' + i + '</span>'; }).join('');
    var mood = '<div class="hl-card"><h3>🙂 المزاج والطاقة <small>اليوم: ' + (today.mood === null ? '-' : today.mood + '/5') + ' · ' + (today.energy === null ? '-' : today.energy + '/5') + '</small></h3>' +
      '<div class="hl-faces">' + faces + '</div><div class="hl-sub">الطاقة (اختياري)</div><div class="hl-faces hl-en">' + energy + '</div>' +
      '<div class="hl-form"><input id="hlnote" placeholder="ملاحظة (اختياري)" value="' + esc(val('hlnote', '')) + '"><button data-b="hlmos">تسجيل</button></div></div>';

    var kcalLine = T.kcal !== null ? today.kcal + ' / ' + T.kcal + ' سعرة (تقدير)' + (T.protein !== null ? ' · بروتين ' + today.protein + ' / ' + T.protein + ' غ' : '') : (today.meals + ' وجبة اليوم');
    var meals = '<div class="hl-card"><h3>🍽 الغذاء <small>' + (minor ? 'بدون أرقام سعرات' : 'تقديرات') + '</small></h3>' +
      (T.kcal !== null ? '<div class="bar2"><i style="width:' + pct(today.kcal, T.kcal) + '%"></i></div>' : '') + '<div class="hl-sub">' + kcalLine + '</div>' +
      '<div class="hl-form"><select id="hlslot"><option value="">تلقائي</option>' + Object.keys(SLOT_AR).map(function (k) { return '<option value="' + SLOT_AR[k] + '"' + (val('hlslot', '') === SLOT_AR[k] ? ' selected' : '') + '>' + SLOT_AR[k] + '</option>'; }).join('') + '</select>' +
      '<input id="hlmeal" placeholder="شنو أكلت؟" value="' + esc(val('hlmeal', '')) + '" style="flex:2 1 120px">' +
      (minor ? '' : '<input id="hlkcal" type="number" min="0" placeholder="سعرات" value="' + esc(val('hlkcal', '')) + '"><input id="hlprot" type="number" min="0" placeholder="بروتين غ" value="' + esc(val('hlprot', '')) + '">') +
      '<button data-b="hlme">إضافة</button></div></div>';

    var charts = '<p class="cap">LAST 7 DAYS</p><div class="hl-charts">' +
      chart('💧 الماء (مل)', week, function (d) { return d.waterMl; }, 0, T.waterMl, function (v) { return v + ' مل'; }) +
      chart('😴 النوم (ساعات)', week, function (d) { return d.sleepMin === null ? null : Math.round(d.sleepMin / 6) / 10; }, 0, Math.round(T.sleepMin / 6) / 10, function (v) { return v + ' ساعة'; }) +
      chart('🏃 التمارين (دقائق)', week, function (d) { return d.workoutMin; }, 30, 0, function (v) { return v + ' د'; }) +
      chart('🙂 المزاج', week, function (d) { return d.mood; }, 5, 0, function (v) { return v + '/5'; }) + '</div>';

    var list = '<p class="cap">TODAY</p><div class="hl-list">' + (todays.length ? todays.map(function (e) {
      return '<div class="row"><span>' + entryText(e) + '</span><button data-b="hldel" data-id="' + e.id + '" title="حذف">✕</button></div>';
    }).join('') : '<p class="mu">ما سجلت شي اليوم بعد.</p>') + '</div>';

    document.getElementById('main').innerHTML = '<p class="cap">HEALTH</p><h1>الصحة</h1>' + bars() +
      '<div class="hl-note">الأرقام هنا تقديرات عامة وتعتمد على بياناتك بالجهة اليمنى. مو بديل عن الطبيب أو أخصائي التغذية.</div>' +
      '<div class="hl-grid">' + water + sleep + work + mood + meals + '</div>' + charts + list;

    /* side: profile + goals */
    var opt = function (v, label, cur) { return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>'; };
    var num = function (id, label, v, ph) { return '<label>' + label + '<input id="' + id + '" type="number" step="any" placeholder="' + (ph || '') + '" value="' + esc(val(id, v === null || v === undefined ? '' : v)) + '"></label>'; };
    var goalVal = function (auto, v) { return auto ? '' : v; };
    var side = '<div class="hl-side"><p class="cap">PROFILE</p>' +
      num('hlage', 'العمر', P.age) + num('hlheight', 'الطول (سم)', P.heightCm) + num('hlweight', 'الوزن (كغ)', P.weightKg) +
      '<label>الجنس (اختياري)<select id="hlsex">' + opt('', 'ما أحدد', val('hlsex', P.sex || '')) + opt('male', 'ذكر', val('hlsex', P.sex || '')) + opt('female', 'أنثى', val('hlsex', P.sex || '')) + '</select></label>' +
      '<label>مستوى النشاط<select id="hlact">' + [1, 2, 3, 4].map(function (i) { return opt(i, H.activityNames[i], val('hlact', P.activity)); }).join('') + '</select></label>' +
      num('hlcup', 'حجم الكاسة (مل)', P.cupMl) +
      '<div class="btns wrap"><button data-b="hlpf">حفظ الملف</button></div>' +
      '<p class="cap" style="margin-top:16px">TARGETS</p>' +
      (minor ? '<p class="hl-note">تحت 18: نعرض الماء والنوم والتمارين بس، بدون أهداف سعرات.</p>' : (T.kcal === null ? '<p class="hl-note">أكمل العمر والطول والوزن حتى تنحسب السعرات (للبالغين).</p>' : '')) +
      num('hlgw', 'الماء (مل)' + (T.auto.water ? ' <span class="hl-auto">تلقائي: ' + T.waterMl + '</span>' : ''), goalVal(T.auto.water, T.waterMl)) +
      num('hlgs', 'النوم (ساعات)' + (T.auto.sleep ? ' <span class="hl-auto">تلقائي: ' + hm(T.sleepMin) + '</span>' : ''), goalVal(T.auto.sleep, Math.round(T.sleepMin / 6) / 10)) +
      (minor ? '' : num('hlgk', 'السعرات' + (T.auto.kcal && T.kcal !== null ? ' <span class="hl-auto">تلقائي: ' + T.kcal + '</span>' : ''), goalVal(T.auto.kcal, T.kcal)) +
        num('hlgp', 'البروتين (غ)' + (T.auto.protein && T.protein !== null ? ' <span class="hl-auto">تلقائي: ' + T.protein + '</span>' : ''), goalVal(T.auto.protein, T.protein))) +
      num('hlgwo', 'التمارين (دقيقة/أسبوع)' + (T.auto.workout ? ' <span class="hl-auto">تلقائي: ' + T.workoutMin + '</span>' : ''), goalVal(T.auto.workout, T.workoutMin)) +
      '<div class="btns wrap"><button data-b="hlgl">حفظ الأهداف</button><button data-b="hlgr">رجوع للتلقائي</button></div>' +
      '<p class="hl-note">اترك الحقل فاضي ليبقى تلقائي. السعرات التلقائية للصيانة، وما أقبل هدف أقل من 1200 سعرة.</p></div>';
    document.getElementById('side').innerHTML = side;
    back(f);
  }

  function run(text, clears) {
    return cmd(text).then(function (ok) { if (ok && clears) clear.apply(null, clears); return ok; });
  }
  function warn(t) { msg = { ok: false, t: t, until: Date.now() + 4000 }; redraw(); }

  function healthClick(b, d) {
    if (b === 'hlw') return run('water ' + d.v);
    if (b === 'hlwu') return run('water undo');
    if (b === 'hlsl') {
      var bed = read('hlbed'), wake = read('hlwake'), q = read('hlq');
      if (!bed || !wake) return warn('اكتب وقت النوم ووقت الاستيقاظ');
      return run('sleep ' + bed + ' ' + wake + (q ? ' ' + q : ''), ['hlq']);
    }
    if (b === 'hlwo') {
      var kind = read('hlkind').replace(/\b\d+(\.\d+)?\b/g, '').trim() || 'تمرين', min = read('hlmin'), it = read('hlint') || '2';
      if (!min) return warn('اكتب مدة التمرين بالدقائق');
      return run('workout ' + kind + ' ' + min + ' ' + it, ['hlkind', 'hlmin']);
    }
    if (b === 'hlmo') { hlMood = +d.v; return redraw(); }
    if (b === 'hlen') { hlEnergy = hlEnergy === +d.v ? null : +d.v; return redraw(); }
    if (b === 'hlmos') {
      if (!hlMood) return warn('اختر مزاجك أول');
      var note = read('hlnote');
      if (!hlEnergy && /^[1-5](\s|$)/.test(note)) note = '- ' + note; /* a note that starts with a digit must not be read as energy */
      return run('mood ' + hlMood + (hlEnergy ? ' ' + hlEnergy : '') + (note ? ' ' + note : ''), ['hlnote']).then(function (ok) { if (ok) { hlMood = null; hlEnergy = null; redraw(); } });
    }
    if (b === 'hlme') {
      var text = read('hlmeal'), slot = read('hlslot'), kc = read('hlkcal'), pr = read('hlprot');
      if (!text) return warn('اكتب شنو أكلت');
      return run('meal ' + (slot ? slot + ' ' : '') + text + (kc ? ' kcal ' + kc : '') + (pr ? ' protein ' + pr : ''), ['hlmeal', 'hlkcal', 'hlprot']);
    }
    if (b === 'hldel') return run('health delete ' + d.id);
    if (b === 'hlpf') {
      var f = function (id, key) { var v = read(id); return key + '=' + (v === '' ? 'none' : v); };
      var sex = read('hlsex');
      var parts = [f('hlage', 'age'), f('hlheight', 'height'), f('hlweight', 'weight'), 'sex=' + (sex || 'none'), 'activity=' + (read('hlact') || '2')];
      if (read('hlcup')) parts.push('cup=' + read('hlcup'));
      return run('health save ' + parts.join(' '), ['hlage', 'hlheight', 'hlweight', 'hlsex', 'hlact', 'hlcup']);
    }
    if (b === 'hlgl') {
      var g = function (id, key) { var v = read(id); return key + '=' + (v === '' ? 'auto' : v); };
      var gp = [g('hlgw', 'water'), g('hlgs', 'sleep'), g('hlgwo', 'workout')];
      if (document.getElementById('hlgk')) { gp.push(g('hlgk', 'kcal')); gp.push(g('hlgp', 'protein')); }
      return run('health goal ' + gp.join(' '), ['hlgw', 'hlgs', 'hlgk', 'hlgp', 'hlgwo']);
    }
    if (b === 'hlgr') return run('health goal water=auto sleep=auto kcal=auto protein=auto workout=auto', ['hlgw', 'hlgs', 'hlgk', 'hlgp', 'hlgwo']);
  }

  global.healthView = healthView;
  global.healthClick = healthClick;
  css();
})(window);
