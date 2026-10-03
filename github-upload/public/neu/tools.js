/* Flow Valu — Werkzeuge im Live-Gespräch:
   Tabs, Einwilligung, Live-Mitschrift (Web Speech API), Bildschirm teilen, gemeinsames KI-Feld. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var C = function () { return window.FVCall; };
  if (!$('tx-log') || !window.FVCall) return;

  var el = {
    tabs: document.querySelectorAll('.tabs__tab'),
    panels: document.querySelectorAll('.tabpanel'),
    consent: $('consent'), consentText: $('consent-text'), yes: $('consent-yes'), no: $('consent-no'),
    txStatus: $('tx-status'), txLog: $('tx-log'), txToggle: $('tx-toggle'), txMake: $('tx-make'), txRec: $('tx-rec'),
    screen: $('screen-btn'),
    aiHint: $('ai-hint'), aiLog: $('ai-log'), aiForm: $('ai-form'), aiInput: $('ai-input')
  };

  var transcript = [], txActive = false, waiting = false, rec = null, lastMadeAt = 0;
  var screenTrack = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- Tabs ---------- */
  function tab(name) {
    Array.prototype.forEach.call(el.tabs, function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(el.panels, function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }
  Array.prototype.forEach.call(el.tabs, function (t) {
    t.addEventListener('click', function () { tab(t.getAttribute('data-tab')); });
  });

  /* ---------- Mitschrift ---------- */
  function setStatus(text) { el.txStatus.textContent = text; }
  function updateButtons() {
    el.txToggle.textContent = txActive ? 'Mitschrift beenden' : (waiting ? 'Warte auf Zustimmung …' : 'Mitschrift anfragen');
    el.txToggle.disabled = waiting;
    el.txMake.disabled = transcript.length === 0;
    el.txRec.hidden = !txActive;
  }

  function addLine(who, text, mine) {
    text = String(text).trim();
    if (!text) return;
    transcript.push({ who: who, text: text.slice(0, 2000), t: Date.now() });
    var d = document.createElement('div');
    d.className = 'tx__line' + (mine ? ' is-me' : '');
    d.innerHTML = '<span class="tx__who">' + esc(who) + '</span><span class="tx__text">' + esc(text) + '</span>';
    el.txLog.appendChild(d);
    el.txLog.scrollTop = el.txLog.scrollHeight;
    updateButtons();
  }

  function startRecognition() {
    if (!SR) return false;
    try {
      rec = new SR();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            var text = e.results[i][0].transcript;
            addLine(C().me(), text, true);
            C().send({ type: 'tx', text: text });
          }
        }
      };
      rec.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setStatus('Mitschrift läuft, aber dein Mikrofon darf nicht für die Spracherkennung genutzt werden. Die Beiträge der anderen Person werden weiter mitgeschrieben.');
          rec = null;
        }
      };
      rec.onend = function () { if (txActive && rec) { try { rec.start(); } catch (x) {} } };
      rec.start();
      return true;
    } catch (x) { rec = null; return false; }
  }

  function startTx() {
    waiting = false;
    txActive = true;
    var ok = startRecognition();
    setStatus(ok
      ? 'Mitschrift läuft — beide haben zugestimmt. Nach dem Gespräch entsteht automatisch eine Mindmap.'
      : 'Mitschrift läuft. Dein Browser unterstützt keine Spracherkennung (bitte Chrome oder Edge nutzen) — die Beiträge der anderen Person werden trotzdem mitgeschrieben.');
    updateButtons();
    tab('tx');
  }

  function stopTx(silent) {
    txActive = false;
    waiting = false;
    if (rec) { var r = rec; rec = null; try { r.stop(); } catch (x) {} }
    if (!silent) setStatus('Mitschrift beendet.' + (transcript.length ? ' Du kannst jetzt die Mindmap erstellen.' : ''));
    updateButtons();
  }

  el.txToggle.addEventListener('click', function () {
    if (txActive) { C().send({ type: 'tx-stop' }); stopTx(); return; }
    if (!C().connected()) { setStatus('Keine Verbindung.'); return; }
    if (!C().send({ type: 'consent-req', name: C().me() })) { setStatus('Anfrage konnte nicht gesendet werden.'); return; }
    waiting = true;
    setStatus('Warte auf Zustimmung von ' + C().partner() + ' …');
    updateButtons();
  });

  el.yes.addEventListener('click', function () {
    el.consent.hidden = true;
    C().send({ type: 'consent', ok: true });
    startTx();
  });
  el.no.addEventListener('click', function () {
    el.consent.hidden = true;
    C().send({ type: 'consent', ok: false });
    setStatus('Du hast die Mitschrift abgelehnt.');
  });

  function makeNote() {
    if (!transcript.length || !window.FVNotes) return;
    lastMadeAt = transcript.length;
    window.FVNotes.create({ topic: C().topic(), me: C().me(), partner: C().partner(), transcript: transcript });
  }
  el.txMake.addEventListener('click', makeNote);

  /* ---------- Bildschirm teilen ---------- */
  function videoSender() {
    var pc = C().pc();
    if (!pc || !pc.getSenders) return null;
    return pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'video'; })[0] || null;
  }

  function stopShare() {
    if (!screenTrack) return;
    var t = screenTrack;
    screenTrack = null;
    try { t.stop(); } catch (x) {}
    var cam = C().stream() && C().stream().getVideoTracks()[0];
    var s = videoSender();
    if (s && cam) s.replaceTrack(cam).catch(function () {});
    if (C().stream()) C().selfVideo.srcObject = C().stream();
    C().selfVideo.classList.remove('is-screen');
    el.screen.setAttribute('aria-pressed', 'false');
    C().send({ type: 'screen', on: false });
  }

  el.screen.addEventListener('click', function () {
    if (screenTrack) { stopShare(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { window.alert('Bildschirm teilen wird in diesem Browser nicht unterstützt.'); return; }
    var s = videoSender();
    if (!s) { window.alert('Bildschirm teilen braucht eine aktive Kamera-Verbindung.'); return; }
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (ds) {
      var track = ds.getVideoTracks()[0];
      if (!track) return;
      screenTrack = track;
      s.replaceTrack(track).catch(function () {});
      C().selfVideo.srcObject = ds;
      C().selfVideo.classList.add('is-screen');
      el.screen.setAttribute('aria-pressed', 'true');
      C().send({ type: 'screen', on: true });
      track.addEventListener('ended', stopShare);
    }).catch(function () {});
  });

  /* ---------- Gemeinsames KI-Feld ---------- */
  function aiHint() {
    var has = window.FVAI && window.FVAI.hasKey();
    el.aiHint.textContent = has
      ? 'Aktiv: ' + window.FVAI.label(window.FVAI.settings().provider) + '. Fragen und Antworten sehen beide.'
      : 'Kein KI-Schlüssel hinterlegt. Unter „KI-Einstellungen" ChatGPT oder Claude verbinden. Fragen der anderen Person siehst du trotzdem.';
  }

  function aiMsg(cls, who, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = (who ? '<span class="msg__who">' + esc(who) + '</span>' : '') + esc(text).replace(/\n/g, '<br>');
    el.aiLog.appendChild(d);
    el.aiLog.scrollTop = el.aiLog.scrollHeight;
    return d;
  }

  el.aiForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = el.aiInput.value.trim();
    if (!q) return;
    el.aiInput.value = '';
    aiMsg('msg--user', C().me(), q);
    C().send({ type: 'ai-q', text: q, by: C().me() });
    if (!window.FVAI || !window.FVAI.hasKey()) { aiMsg('msg--note', '', 'Kein KI-Schlüssel hinterlegt — die Frage wurde nur geteilt.'); return; }
    var wait = aiMsg('msg--note', '', 'KI denkt nach …');
    var ctx = transcript.length ? window.FVAI.transcriptText(transcript).slice(-3000) : '';
    window.FVAI.ask(q, ctx).then(function (a) {
      wait.remove();
      var label = 'KI · ' + window.FVAI.label(window.FVAI.settings().provider);
      aiMsg('msg--bot', label, a);
      C().send({ type: 'ai-a', text: a, by: label });
    }).catch(function (err) {
      wait.remove();
      aiMsg('msg--note', '', err.message);
    });
  });

  /* ---------- Nachrichten der anderen Person ---------- */
  document.addEventListener('fv:data', function (e) {
    var d = e.detail || {};
    switch (d.type) {
      case 'consent-req':
        el.consentText.textContent = String(d.name || C().partner()).slice(0, 40) + ' möchte das Gespräch mitschreiben lassen, damit die KI daraus eine Mindmap erstellt. Stimmst du zu?';
        el.consent.hidden = false;
        break;
      case 'consent':
        if (!waiting) break;
        if (d.ok) startTx();
        else { waiting = false; setStatus(C().partner() + ' hat die Mitschrift abgelehnt.'); updateButtons(); }
        break;
      case 'tx':
        if (txActive && d.text) addLine(C().partner(), String(d.text).slice(0, 2000), false);
        break;
      case 'tx-stop':
        if (txActive) { stopTx(true); setStatus(C().partner() + ' hat die Mitschrift beendet.'); }
        break;
      case 'screen':
        C().remoteVideo.classList.toggle('is-screen', !!d.on);
        break;
      case 'ai-q':
        if (d.text) aiMsg('msg--user', String(d.by || C().partner()).slice(0, 40), String(d.text).slice(0, 2000));
        break;
      case 'ai-a':
        if (d.text) aiMsg('msg--bot', String(d.by || 'KI').slice(0, 40), String(d.text).slice(0, 6000));
        break;
    }
  });

  /* ---------- Gespräch beginnt / endet ---------- */
  document.addEventListener('fv:call-start', function () {
    transcript = []; lastMadeAt = 0;
    stopTx(true);
    el.txLog.innerHTML = '';
    el.aiLog.innerHTML = '';
    el.consent.hidden = true;
    setStatus('Die Mitschrift ist aus. Beide müssen zustimmen, bevor mitgeschrieben wird.');
    C().remoteVideo.classList.remove('is-screen');
    aiHint();
    updateButtons();
    tab('chat');
  });

  document.addEventListener('fv:call-end', function () {
    stopTx(true);
    stopShare();
    el.consent.hidden = true;
    if (transcript.length > lastMadeAt) makeNote();
  });

  document.addEventListener('fv:route', aiHint);
  aiHint();
  updateButtons();
})();
