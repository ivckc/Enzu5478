/* ==========================================================================
   ANZU voice: the mic works on EVERY page (home + tasks/habits/goals/chat/settings)
   - mic button: you speak -> the voice is recorded and sent to the server,
     where Groq Whisper turns it into text (no Google speech needed)
   - card requests ("شعندي مهام هذا الشهر") open the cards, like typing them
   - everything else goes to the AI agent (/api/agent), the answer shows in a
     small bubble (home: above the command bar, other pages: the corner) and is read aloud
   - on the inner pages a small floating mic sits in the bottom-right corner
   - the raven (anzu-raven.js rig) reacts: leans and glows with your voice level while you talk,
     thinks, moves its beak while answering, changes mood with the answer. Click it to talk.
   - delete/confirm questions show Yes/No buttons (or answer by voice: نعم / لا)

   Usage (after AnzuUI.init):   AnzuVoice.init({ ui: AnzuUI });
   ========================================================================== */
(function (global) {
  'use strict';

  var TOKEN = "__TOKEN__";
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
  function setStatus(s) {
    if (global.AnzuRaven) global.AnzuRaven.setMode(s);   /* the raven changes mood with the state */
    if (S.rawSet) S.rawSet(s);
  }
  /* the beak moves for a while (used when the answer is shown as text, or spoken) */
  function talkFor(ms) { if (global.AnzuRaven) global.AnzuRaven.talk(ms); }
  function voiceActive() { return !!(S.rec || S.waiting || S.pending || S.speaking); }
  function idleLater(ms) {
    setTimeout(function () { if (!S.rec && !S.waiting && !S.pending) setStatus('idle'); }, ms);
  }

  /* ---------- styles (use the theme variables, so all 3 themes work) ---------- */
  function injectCss() {
    var st = document.createElement('style');
    st.textContent = [
      /* bubble + confirm: small card in the corner (inner pages), centered above the bar (home) */
      '.avc-bubble,.avc-confirm{position:fixed;right:20px;bottom:84px;width:min(380px,calc(100vw - 120px));z-index:60;box-sizing:border-box;padding:12px 16px;background:var(--a-bar-bg);border:1px solid var(--a-line-strong);color:var(--a-text);font:400 15px/1.8 var(--a-font-body);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .3s ease,transform .3s ease;}',
      '.avc-bubble[data-show="1"],.avc-confirm[data-show="1"]{opacity:1;transform:none;pointer-events:auto;}',
      'body.home .avc-bubble,body.home .avc-confirm{right:auto;left:50%;bottom:150px;width:min(700px,calc(100% - 32px));transform:translateX(-50%) translateY(8px);}',
      'body.home .avc-bubble[data-show="1"],body.home .avc-confirm[data-show="1"]{transform:translateX(-50%);}',
      '@media (max-width:640px){.avc-bubble,.avc-confirm{width:calc(100vw - 40px);}}',
      '.avc-bubble{max-height:38vh;overflow:auto;white-space:pre-wrap;cursor:pointer;}',
      '.avc-label{display:block;font:500 11px var(--a-font-mono);letter-spacing:.12em;color:var(--a-accent-2);margin-bottom:4px;}',
      '.avc-confirm{border-color:var(--a-accent);}',
      '.avc-q{margin:0 0 12px;font:400 13px/1.6 var(--a-font-mono);direction:ltr;text-align:left;word-break:break-word;color:var(--a-muted);}',
      '.avc-btns{display:flex;gap:10px;}',
      '.avc-btns button{flex:1;padding:10px;font:500 14px var(--a-font-body);cursor:pointer;border:1px solid var(--a-line-strong);background:transparent;color:var(--a-text);}',
      '.avc-btns .avc-yes{background:var(--a-accent);color:var(--a-on-accent);border-color:var(--a-accent);}',
      /* the toggle buttons and the mic state */
      '.anzu-mic.avc-mini{width:30px;height:30px;opacity:.55;}',
      '.anzu-mic.avc-mini[aria-pressed="true"]{opacity:1;box-shadow:0 0 0 1px var(--a-accent);}',
      '.anzu-mic.avc-on{background:var(--a-accent);color:var(--a-on-accent);}',
      /* floating dock: bottom-right corner, only on the inner pages */
      '.avc-dock{position:fixed;right:20px;bottom:20px;z-index:55;display:flex;align-items:center;gap:8px;direction:ltr;}',
      'body.home .avc-dock{display:none;}',
      '.avc-dock .anzu-mic{border:1px solid var(--a-line-strong);box-shadow:0 4px 18px rgba(0,0,0,.45);}',
      '.avc-dock .avc-mini{background:var(--a-bar-bg);border-color:var(--a-line);}',
      '.avc-dock .avc-fab{width:48px;height:48px;background:var(--a-bar-bg);}',
      '.avc-dock .avc-fab svg{width:20px;height:20px;}',
      '.avc-dock .avc-fab.avc-on{background:var(--a-accent);box-shadow:0 0 0 6px var(--a-glow),0 4px 18px rgba(0,0,0,.45);}',
      /* the old placeholder bar is replaced by the floating mic; keep room at the bottom of every inner page */
      '.vbar{display:none !important;}',
      '[data-anzu-raven]{cursor:pointer;}',
      'body:not(.home) .app{padding-bottom:88px;}'
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

    document.body.appendChild(b);
    document.body.appendChild(c);
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

  var renders = [];
  function renderToggles() { renders.forEach(function (f) { f(); }); }

  /* anchor = the mic button; before=true puts the two toggles BEFORE it (used by the floating dock) */
  function addToggles(anchor, before) {
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
    auto.onclick = function () { S.auto = !S.auto; store(KEY.auto, S.auto ? '1' : '0'); renderToggles(); };
    mute.onclick = function () {
      S.mute = !S.mute;
      store(KEY.mute, S.mute ? '1' : '0');
      if (S.mute) cancelSpeech();
      renderToggles();
    };
    if (before) {
      anchor.insertAdjacentElement('beforebegin', auto);
      anchor.insertAdjacentElement('beforebegin', mute);
    } else {
      anchor.insertAdjacentElement('afterend', auto);
      auto.insertAdjacentElement('afterend', mute);
    }
    renders.push(render);
    render();
  }

  /* the floating mic for the inner pages (hidden on the home screen by CSS) */
  var ICON_MIC = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V15"/></svg>';
  function buildDock() {
    var d = document.createElement('div');
    d.className = 'avc-dock';
    var f = document.createElement('button');
    f.type = 'button';
    f.className = 'anzu-mic avc-fab';
    f.innerHTML = ICON_MIC;
    f.title = 'تكلّم مع أنزو';
    f.setAttribute('aria-label', 'تكلّم مع أنزو');
    d.appendChild(f);
    document.body.appendChild(d);
    el.fab = f;
    addToggles(f, true);
    f.addEventListener('click', onMic);
  }
  function micOn(on) {
    [el.mic, el.fab].forEach(function (m) { if (m) m.classList.toggle('avc-on', !!on); });
  }
  function isHome() { return document.body.classList.contains('home'); }
  /* on an inner page the cards live on the real pages, so go there instead of the (hidden) home cards */
  function openPage(intent) {
    if (typeof global.go !== 'function') return false;
    if (intent.section === 'home') { if (S.ui && S.ui.home) S.ui.home(); global.go('home'); return true; }
    if (['tasks', 'habits', 'goals', 'settings'].indexOf(intent.section) < 0) return false;
    global.go(intent.section);
    return true;
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

  /* ---------- listening: record the voice, Groq Whisper turns it into text ---------- */
  function cleanupRec(r) {
    clearInterval(r.timer);
    clearTimeout(r.maxTimer);
    if (r.raf) cancelAnimationFrame(r.raf);
    if (global.AnzuRaven) global.AnzuRaven.setLevel(0);
    var s = r.stream; r.stream = null;
    if (s) s.getTracks().forEach(function (t) { t.stop(); });
    var c = r.ctx; r.ctx = null;
    if (c) { try { c.close(); } catch (e) {} }
  }
  function finishRecording(r, manual) {
    if (manual) r.heard = true;
    if (r.mr.state === 'recording') { try { r.mr.stop(); } catch (e) {} }
  }
  /* cancel: throws the recording away */
  function stopListening() {
    var r = S.rec;
    if (!r) return;
    r.cancelled = true;
    S.rec = null;
    if (r.mr.state === 'recording') { try { r.mr.stop(); } catch (e) {} }
    cleanupRec(r);
    micOn(false);
  }
  function transcribe(blob) {
    S.waiting = true;
    setStatus('thinking');
    showBubble('أنزو', 'لحظة، أحوّل صوتك لنص…', true);
    return fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Anzu-Token': TOKEN },
      credentials: 'same-origin',
      body: blob
    }).then(function (r) {
      if (r.status === 401) { global.location.href = '/login'; throw new Error('login required'); }
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
        return String(d.text || '').trim();
      });
    }).finally(function () { S.waiting = false; });
  }
  function listen(mode) {
    if (!global.MediaRecorder || !navigator.mediaDevices) {
      showBubble('أنزو', 'المتصفح ما يدعم تسجيل الصوت.');
      return;
    }
    cancelSpeech();
    stopListening();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (m) {
        return MediaRecorder.isTypeSupported(m);
      })[0] || '';
      var mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      var r = { mr: mr, stream: stream, chunks: [], cancelled: false, heard: false,
                startedAt: Date.now(), lastVoice: Date.now() };
      S.rec = r;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
      mr.onstop = function () {
        cleanupRec(r);
        if (S.rec === r) S.rec = null;
        micOn(false);
        if (r.cancelled) return;
        var blob = new Blob(r.chunks, { type: mr.mimeType || mime || 'audio/webm' });
        if (!r.heard || blob.size < 1500) { hideBubble(); setStatus('idle'); return; }
        transcribe(blob).then(function (t) {
          if (!t) { showBubble('أنزو', 'ما سمعت شي، جرّب مرة ثانية'); setStatus('idle'); return; }
          if (mode === 'confirm') onConfirmSpeech(t); else handleText(t);
        }).catch(function (e) {
          showBubble('أنزو', '⚠️ تعذّر تحويل الصوت (' + (e && e.message ? e.message : 'خطأ') + ')');
          setStatus('error');
          idleLater(2000);
        });
      };
      /* stop by itself after ~1.5s of silence (so the continuous mode still works) */
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        r.ctx = new AC();
        var an = r.ctx.createAnalyser();
        an.fftSize = 512;
        r.ctx.createMediaStreamSource(stream).connect(an);
        var buf = new Uint8Array(an.fftSize);
        r.timer = setInterval(function () {
          an.getByteTimeDomainData(buf);
          var peak = 0;
          for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          var now = Date.now();
          if (peak > 12) { r.heard = true; r.lastVoice = now; }
          if (r.heard && now - r.lastVoice > 1100) finishRecording(r);
          else if (!r.heard && now - r.startedAt > 8000) finishRecording(r);
        }, 150);
        /* smooth live level (0..1) for the raven: it leans and glows with your voice */
        var lbuf = new Uint8Array(an.fftSize), lvl = 0, rootEl = document.documentElement;
        (function tickLevel() {
          if (!r.ctx) return;
          an.getByteTimeDomainData(lbuf);
          var pk = 0;
          for (var j = 0; j < lbuf.length; j++) pk = Math.max(pk, Math.abs(lbuf[j] - 128));
          lvl = lvl * 0.7 + Math.min(1, Math.max(0, (pk - 4) / 70)) * 0.3;
          if (global.AnzuRaven) global.AnzuRaven.setLevel(lvl);
          r.raf = requestAnimationFrame(tickLevel);
        })();
      } catch (e) { r.heard = true; }
      r.maxTimer = setTimeout(function () { finishRecording(r, true); }, 20000);
      mr.start();
      micOn(true);
      setStatus('listening');
      if (mode === 'command') showBubble('أنزو', 'أسمعك…', true);
    }).catch(function () {
      showBubble('أنزو', 'اسمح للميكروفون من إعدادات المتصفح');
      setStatus('error');
      idleLater(1800);
    });
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
      var shown = (!isHome() && openPage(intent)) ? Promise.resolve(true) : S.ui.go(intent);
      shown.then(function () {
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

    if (global.AnzuRaven) text = global.AnzuRaven.react(text) || 'تمام.';   /* mood from the answer */
    remember(S.lastUser, text);
    showBubble('أنزو', text);
    talkFor(Math.min(7000, 1200 + text.length * 45));
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
    if (S.rec) { finishRecording(S.rec, true); return; }
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
      S.ui.setStatus = function (st) { if (!voiceActive()) { if (global.AnzuRaven) global.AnzuRaven.setMode(st); S.rawSet(st); } };
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
    addToggles(el.mic, false);
    buildDock();
    el.mic.addEventListener('click', onMic);
    var rv = S.root.querySelector('[data-anzu-raven]');
    if (rv) { rv.addEventListener('click', onMic); rv.title = 'اضغط عليّ وتكلّم'; }
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