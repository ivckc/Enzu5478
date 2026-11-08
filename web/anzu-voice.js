/* ==========================================================================
   ANZU voice for the HOME screen
   - mic button: you speak -> Chrome turns it into text
   - card requests ("شعندي مهام هذا الشهر") open the cards, like typing them
   - everything else goes to the AI agent (/api/agent), the answer shows in a
     bubble above the command bar and is read aloud
   - delete/confirm questions show Yes/No buttons (or answer by voice: نعم / لا)

   Usage (after AnzuUI.init):   AnzuVoice.init({ ui: AnzuUI });
   ========================================================================== */
(function (global) {
  'use strict';

  var TOKEN = "__TOKEN__";
  var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
  var synth = global.speechSynthesis;
  var KEY = { auto: 'anzu.voiceAuto', mute: 'anzu.voiceMute' };

  var S = {
    ui: null, root: null, rec: null,
    waiting: false,      // a request to the server is in flight
    pending: null,       // confirmId while the agent waits for Yes/No
    retries: 0,
    history: [],         // [{ role: 'user' | 'agent', text }]
    lastUser: '', lastIntent: null,
    auto: false, mute: false,
    speakId: 0, speaking: false, rawSet: null, bubbleTimer: null
  };
  var el = {};

  /* ---------- small helpers ---------- */
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function setStatus(s) { if (S.rawSet) S.rawSet(s); }
  function voiceActive() { return !!(S.rec || S.waiting || S.pending || S.speaking); }
  function idleLater(ms) {
    setTimeout(function () { if (!S.rec && !S.waiting && !S.pending) setStatus('idle'); }, ms);
  }

  /* ---------- styles (use the theme variables, so all 3 themes work) ---------- */
  function injectCss() {
    var st = document.createElement('style');
    st.textContent = [
      '.avc-bubble,.avc-confirm{position:absolute;bottom:150px;left:50%;transform:translateX(-50%) translateY(8px);width:min(700px,calc(100% - 32px));z-index:5;box-sizing:border-box;padding:12px 16px;background:var(--a-bar-bg);border:1px solid var(--a-line-strong);color:var(--a-text);font:400 15px/1.8 var(--a-font-body);opacity:0;pointer-events:none;transition:opacity .3s ease,transform .3s ease;}',
      '.avc-bubble[data-show="1"],.avc-confirm[data-show="1"]{opacity:1;transform:translateX(-50%);pointer-events:auto;}',
      '.avc-bubble{max-height:38vh;overflow:auto;white-space:pre-wrap;cursor:pointer;}',
      '.avc-label{display:block;font:500 11px var(--a-font-mono);letter-spacing:.12em;color:var(--a-accent-2);margin-bottom:4px;}',
      '.avc-confirm{border-color:var(--a-accent);}',
      '.avc-q{margin:0 0 12px;font:400 13px/1.6 var(--a-font-mono);direction:ltr;text-align:left;word-break:break-word;color:var(--a-muted);}',
      '.avc-btns{display:flex;gap:10px;}',
      '.avc-btns button{flex:1;padding:10px;font:500 14px var(--a-font-body);cursor:pointer;border:1px solid var(--a-line-strong);background:transparent;color:var(--a-text);}',
      '.avc-btns .avc-yes{background:var(--a-accent);color:var(--a-on-accent);border-color:var(--a-accent);}',
      '.anzu-mic.avc-mini{width:30px;height:30px;opacity:.55;}',
      '.anzu-mic.avc-mini[aria-pressed="true"]{opacity:1;box-shadow:0 0 0 1px var(--a-accent);}',
      '.anzu-mic.avc-on{background:var(--a-accent);color:var(--a-on-accent);}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- bubble + confirm sheet ---------- */
  function build() {
    var b = document.createElement('div');
    b.className = 'avc-bubble';
    b.setAttribute('aria-live', 'polite');
    b.innerHTML = '<span class="avc-label"></span><span class="avc-text"></span>';
    b.addEventListener('click', hideBubble);

    var c = document.createElement('div');
    c.className = 'avc-confirm';
    c.innerHTML = '<span class="avc-label">أنزو يطلب موافقتك</span><p class="avc-q"></p>' +
      '<div class="avc-btns"><button type="button" class="avc-yes">نعم، نفّذ</button>' +
      '<button type="button" class="avc-no">لا، الغي</button></div>';

    S.root.appendChild(b);
    S.root.appendChild(c);
    el.bubble = b;
    el.label = b.querySelector('.avc-label');
    el.text = b.querySelector('.avc-text');
    el.confirm = c;
    el.q = c.querySelector('.avc-q');
    c.querySelector('.avc-yes').onclick = function () { answerConfirm(true); };
    c.querySelector('.avc-no').onclick = function () { answerConfirm(false); };
  }
  function showBubble(label, text, sticky) {
    clearTimeout(S.bubbleTimer);
    el.label.textContent = label;
    el.text.textContent = text;
    el.bubble.dataset.show = '1';
    if (!sticky) S.bubbleTimer = setTimeout(hideBubble, 20000);
  }
  function hideBubble() {
    clearTimeout(S.bubbleTimer);
    if (el.bubble) el.bubble.dataset.show = '0';
  }

  /* ---------- the two small toggle buttons next to the mic ---------- */
  var ICON_AUTO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 0 1 8.7-3.3L13 6M13 8a5 5 0 0 1-8.7 3.3L3 10M13 3v3h-3M3 13v-3h3"/></svg>';
  var ICON_SPK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5"/></svg>';
  var ICON_MUTE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="M11 6l3.5 4M14.5 6 11 10"/></svg>';

  function addToggles() {
    var auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'anzu-mic avc-mini';
    auto.innerHTML = ICON_AUTO;
    auto.title = 'محادثة مستمرة (يسمعك تلقائياً بعد كل رد)';
    auto.setAttribute('aria-label', 'محادثة مستمرة');

    var mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'anzu-mic avc-mini';
    mute.title = 'صوت الرد';
    mute.setAttribute('aria-label', 'صوت الرد');

    function render() {
      auto.setAttribute('aria-pressed', S.auto ? 'true' : 'false');
      mute.innerHTML = S.mute ? ICON_MUTE : ICON_SPK;
      mute.setAttribute('aria-pressed', S.mute ? 'false' : 'true'); /* highlighted = voice ON */
    }
    auto.onclick = function () { S.auto = !S.auto; store(KEY.auto, S.auto ? '1' : '0'); render(); };
    mute.onclick = function () {
      S.mute = !S.mute;
      store(KEY.mute, S.mute ? '1' : '0');
      if (S.mute) cancelSpeech();
      render();
    };
    el.mic.insertAdjacentElement('afterend', auto);
    auto.insertAdjacentElement('afterend', mute);
    render();
  }

  /* ---------- speaking ---------- */
  function cleanForSpeech(t) {
    return String(t)
      .replace(/[*_#`>|~\[\]]/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ').trim();
  }
  function arVoice() {
    if (!synth) return null;
    var v = synth.getVoices();
    for (var i = 0; i < v.length; i++) if (/^ar/i.test(v[i].lang)) return v[i];
    return null;
  }
  function cancelSpeech() {
    S.speakId++;
    S.speaking = false;
    if (synth) synth.cancel();
  }
  /* resolves true when it finished by itself, false when it was cut off */
  function speak(text) {
    return new Promise(function (resolve) {
      if (S.mute || !synth) { resolve(true); return; }
      var clean = cleanForSpeech(text);
      if (!clean) { resolve(true); return; }
      var id = ++S.speakId;
      S.speaking = true;
      synth.cancel();
      var parts = clean.match(/[^.!?؟\n]+[.!?؟]?/g) || [clean];
      var chunks = [], cur = '';
      parts.forEach(function (p) {
        if ((cur + p).length > 180) { if (cur) chunks.push(cur); cur = p; } else { cur += p; }
      });
      if (cur) chunks.push(cur);
      var v = arVoice(), i = 0;
      setStatus('speaking');
      (function next() {
        if (id !== S.speakId) { resolve(false); return; }
        if (i >= chunks.length) { S.speaking = false; resolve(true); return; }
        var u = new SpeechSynthesisUtterance(chunks[i++]);
        u.lang = 'ar-SA';
        if (v) u.voice = v;
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      })();
    });
  }

  /* ---------- listening ---------- */
  function stopListening() {
    if (S.rec) {
      S.rec.onend = null; S.rec.onerror = null; S.rec.onresult = null;
      try { S.rec.abort(); } catch (e) {}
      S.rec = null;
    }
    if (el.mic) el.mic.classList.remove('avc-on');
  }
  function listen(mode) {
    if (!SR) { showBubble('أنزو', 'المتصفح ما يدعم الصوت. استخدم Chrome.'); return; }
    cancelSpeech();
    stopListening();
    var r = new SR();
    S.rec = r;
    r.lang = 'ar-IQ';
    r.interimResults = true;
    r.continuous = false;
    var finalText = '', failed = false;
    r.onstart = function () { el.mic.classList.add('avc-on'); setStatus('listening'); };
    r.onresult = function (e) {
      var t = '';
      for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      finalText = t;
      if (mode === 'command') showBubble('أنت', t, true);
    };
    r.onerror = function (e) {
      failed = true;
      var msg = e.error === 'not-allowed' ? 'اسمح للميكروفون من إعدادات المتصفح'
        : e.error === 'no-speech' ? 'ما سمعت شي، جرّب مرة ثانية'
        : 'تعذّر التعرف على الصوت (' + e.error + ')';
      showBubble('أنزو', msg);
      setStatus('error');
      idleLater(1800);
    };
    r.onend = function () {
      el.mic.classList.remove('avc-on');
      if (S.rec === r) S.rec = null;
      if (failed) return;
      var t = finalText.trim();
      if (!t) { hideBubble(); setStatus('idle'); return; }
      if (mode === 'confirm') onConfirmSpeech(t); else handleText(t);
    };
    try { r.start(); } catch (e) {}
  }

  /* ---------- what to do with the words ---------- */
  function finish() {
    setStatus('idle');
    if (S.auto && !S.pending && !S.waiting) listen('command');
  }

  function handleText(text) {
    if (S.waiting) return;
    S.lastUser = text;
    showBubble('أنت', text);

    /* card request? same detection as typing in the bar */
    var intent = (S.ui && S.ui.detect) ? S.ui.detect(text) : null;
    if (intent) {
      S.lastIntent = intent.section === 'home' ? null : intent;
      hideBubble();
      S.ui.go(intent).then(function () {
        return speak(intent.section === 'home' ? 'تمام.' : 'تفضل.');
      }).then(function (done) { if (done) finish(); });
      return;
    }

    setStatus('thinking');
    post({
      text: text.slice(0, 500),
      voice: true,
      history: S.history.slice(-8).map(function (h) { return { role: h.role, text: h.text.slice(0, 300) }; })
    });
  }

  function remember(user, agent) {
    S.history.push({ role: 'user', text: user }, { role: 'agent', text: agent });
    while (S.history.length > 12) S.history.shift();
  }

  function refreshCards() {
    if (S.lastIntent && S.root.dataset.mode === 'focus' && S.ui && S.ui.go) return S.ui.go(S.lastIntent);
    return null;
  }

  /* ---------- talking to the server (same API the chat page uses) ---------- */
  function post(body) {
    S.waiting = true;
    return fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Anzu-Token': TOKEN },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { global.location.href = '/login'; throw new Error('login required'); }
      return r.json();
    }).then(function (d) {
      S.waiting = false;
      onReply(d);
    }).catch(function (e) {
      S.waiting = false;
      onFail(e);
    });
  }

  function onFail(e) {
    S.pending = null;
    el.confirm.dataset.show = '0';
    showBubble('أنزو', '⚠️ ما اكدر اوصل للسيرفر (' + (e && e.message ? e.message : 'خطأ') + ')');
    setStatus('error');
    idleLater(2000);
  }

  function onReply(d) {
    /* the agent wants approval (for example before a delete) */
    if (d && d.wait && d.confirmId) {
      S.pending = d.confirmId;
      S.retries = 0;
      hideBubble();
      el.q.textContent = d.ask || '';
      el.confirm.dataset.show = '1';
      setStatus('working');
      speak('أحتاج تأكيدك. قل نعم أو لا.').then(function (done) {
        if (done && S.pending) listen('confirm');
      });
      return;
    }

    var text = String((d && d.reply != null) ? d.reply : ((d && d.lines) || []).join('\n')).trim() || 'تمام.';
    if (!d || d.ok === false) {
      showBubble('أنزو', text);
      setStatus('error');
      idleLater(2000);
      return;
    }

    remember(S.lastUser, text);
    showBubble('أنزو', text);
    Promise.resolve(refreshCards()).then(function () {
      return speak(text);
    }).then(function (done) { if (done) finish(); });
  }

  /* ---------- confirmation (buttons or voice) ---------- */
  function answerConfirm(ok) {
    var id = S.pending;
    if (!id) return;
    S.pending = null;
    el.confirm.dataset.show = '0';
    stopListening();
    cancelSpeech();
    setStatus('working');
    post({ confirmId: id, approved: ok });
  }
  function onConfirmSpeech(t) {
    var no = /(^|\s)(لا|لأ|كلا|الغي|ألغي|الغاء|إلغاء|no)(\s|$)/i;
    var yes = /(^|\s)(نعم|اي|أي|ايوه|أيوه|ايوا|موافق|تمام|نفذ|نفّذ|اوكي|أوكي|yes|ok)(\s|$)/i;
    if (no.test(t)) { answerConfirm(false); return; }
    if (yes.test(t)) { answerConfirm(true); return; }
    if (S.retries < 1) {
      S.retries++;
      speak('ما فهمت. قل نعم أو لا.').then(function (done) {
        if (done && S.pending) listen('confirm');
      });
    } else {
      setStatus('working');
    }
  }

  /* ---------- mic button ---------- */
  function onMic() {
    if (S.rec) { stopListening(); setStatus('idle'); return; }
    if (S.waiting) return;
    listen(S.pending ? 'confirm' : 'command');
  }

  /* ---------- init ---------- */
  var API = { init: null, listen: listen, speak: speak };

  function init(cfg) {
    cfg = cfg || {};
    S.ui = cfg.ui || global.AnzuUI;
    if (S.ui && S.ui.setStatus) {
      S.rawSet = S.ui.setStatus.bind(S.ui);
      S.ui.setStatus = function (st) { if (!voiceActive()) S.rawSet(st); };
    }
    S.root = document.querySelector(cfg.root || '.anzu-home');
    if (!S.root) { console.error('[AnzuVoice] home root (.anzu-home) not found'); return null; }
    el.mic = S.root.querySelector(cfg.mic || '.anzu-mic');
    if (!el.mic) { console.error('[AnzuVoice] mic button (.anzu-mic) not found'); return null; }
    if (!S.ui || !S.ui.detect) {
      console.warn('[AnzuVoice] AnzuUI.detect is missing: every sentence will go to the agent.');
    }
    S.auto = store(KEY.auto) === '1';
    S.mute = store(KEY.mute) === '1';
    injectCss();
    build();
    addToggles();
    el.mic.addEventListener('click', onMic);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      stopListening();
      cancelSpeech();
      hideBubble();
      if (S.pending) answerConfirm(false);
    });
    return API;
  }
  API.init = init;
  global.AnzuVoice = API;
})(window);