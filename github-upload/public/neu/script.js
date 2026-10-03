/* Flow Valu — Beispiel-Weg (Ziel wählen → Weg, aktueller Schritt) */
(function () {
  'use strict';

  /* ---------- Startbildschirm: Anmelden / Konto erstellen ---------- */
  // Demo: Konten werden nur lokal im Browser gespeichert. Für echten Betrieb durch eure API ersetzen.
  (function () {
    var gate = document.getElementById('gate');
    var form = document.getElementById('gate-form');
    if (!gate || !form) return;
    var $ = function (id) { return document.getElementById(id); };
    var title = $('gate-title'), submitLabel = $('gate-submit'), switchText = $('gate-switch-text'), switchLink = $('gate-register');
    var fName = $('field-name'), fPass2 = $('field-pass2');
    var name = $('gate-name'), email = $('gate-email'), pass = $('gate-pass'), pass2 = $('gate-pass2'), err = $('gate-error');
    var SESSION = 'fv-signed-in', USERS = 'fv-demo-users';
    var mode = 'login';

    function users() { try { return JSON.parse(localStorage.getItem(USERS) || '{}'); } catch (x) { return {}; } }
    function saveUsers(u) { try { localStorage.setItem(USERS, JSON.stringify(u)); } catch (x) {} }
    function fail(msg) { err.textContent = msg; err.hidden = false; }

    function setMode(next) {
      mode = next;
      var reg = mode === 'register';
      title.textContent = reg ? 'Konto erstellen' : 'Anmelden';
      submitLabel.textContent = reg ? 'Konto erstellen' : 'Anmelden';
      switchText.textContent = reg ? 'Schon ein Konto?' : 'Noch kein Konto?';
      switchLink.textContent = reg ? 'Anmelden' : 'Konto erstellen';
      fName.hidden = !reg;
      fPass2.hidden = !reg;
      pass.setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
      err.hidden = true;
      (reg ? name : email).focus();
    }

    function open() {
      gate.classList.remove('is-hidden');
      document.body.classList.add('is-locked');
      setTimeout(function () { email.focus(); }, 50);
    }
    function close() {
      gate.classList.add('is-hidden');
      document.body.classList.remove('is-locked');
      window.scrollTo(0, 0);
    }
    function signIn(mail) {
      try { sessionStorage.setItem(SESSION, mail); } catch (x) {}
      try { document.dispatchEvent(new CustomEvent('fv:signin', { detail: { email: mail } })); } catch (x) {}
      pass.value = ''; pass2.value = '';
      close();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var mail = email.value.trim().toLowerCase();
      var pw = pass.value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return fail('Bitte eine gültige E-Mail-Adresse eingeben.');
      var u = users();

      if (mode === 'register') {
        if (!name.value.trim()) return fail('Bitte deinen Vornamen eingeben.');
        if (pw.length < 8) return fail('Das Passwort braucht mindestens 8 Zeichen.');
        if (pw !== pass2.value) return fail('Die Passwörter stimmen nicht überein.');
        if (u[mail]) return fail('Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.');
        u[mail] = { name: name.value.trim(), pw: pw };
        saveUsers(u);
        return signIn(mail);
      }

      if (!pw) return fail('Bitte dein Passwort eingeben.');
      if (!u[mail]) return fail('Kein Konto mit dieser E-Mail gefunden. Erstelle zuerst ein Konto.');
      if (u[mail].pw !== pw) return fail('Das Passwort ist falsch.');
      signIn(mail);
    });

    switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      setMode(mode === 'login' ? 'register' : 'login');
    });

    var logout = $('logout');
    if (logout) logout.addEventListener('click', function (e) {
      e.preventDefault();
      try { sessionStorage.removeItem(SESSION); } catch (x) {}
      setMode('login');
      open();
    });

    var signedIn = false;
    try { signedIn = !!sessionStorage.getItem(SESSION); } catch (x) {}
    if (signedIn) {
      close();
      try { document.dispatchEvent(new CustomEvent('fv:signin', { detail: { email: sessionStorage.getItem(SESSION) } })); } catch (x) {}
    } else open();
  })();

  /* ---------- Live-Match: echter Video-Chat zwischen zwei Nutzern ----------
     Prinzip: Pro Begriff gibt es einen "Warteraum" (Lobby-ID beim PeerJS-Server).
     Wer zuerst kommt, belegt den Warteraum und wartet. Wer danach mit einem
     ähnlichen Begriff sucht, wird mit dieser Person per WebRTC verbunden
     (Kamera + Mikrofon in beide Richtungen, plus Text-Chat). */
  var TOPICS = ['Unternehmen gründen', 'Vertrieb', 'Finanzen', 'Führung', 'Disziplin', 'Karrierewechsel'];
  var GROUPS = [
    ['unternehmen', 'Unternehmen gründen', /unternehm|gr(ü|ue)nd|startup|selbst|business|firma|idee|agentur/],
    ['vertrieb', 'Vertrieb', /vertrieb|verkauf|sales|kunde|akquise/],
    ['finanzen', 'Finanzen', /finanz|geld|spar|invest|unabh|nebenjob|einkommen/],
    ['fuehrung', 'Führung', /f(ü|ue)hrung|leader|team|chef|manag/],
    ['disziplin', 'Disziplin', /disziplin|routine|fitness|sport|gewohn|fokus/],
    ['karriere', 'Karrierewechsel', /karriere|job|beruf|wechsel|bewerb|marketing/]
  ];
  var LOBBY_PREFIX = 'flowvalu-live-v1-';
  var PEER_CONFIG = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
        // Für zuverlässige Verbindungen in Firmen-/Mobilnetzen hier einen TURN-Server ergänzen (siehe README).
      ]
    }
  };

  var $ = function (id) { return document.getElementById(id); };
  var m = {
    start: $('view-start'), search: $('view-search'), call: $('view-call'),
    form: $('search-form'), input: $('search-input'), random: $('random-btn'), topics: $('topics'),
    status: $('search-status'), hint: $('search-hint'), searchRandom: $('search-random'), cancel: $('search-cancel'),
    initials: $('p-initials'), nameTag: $('p-name-tag'), name: $('p-name'), meta: $('p-meta'),
    goal: $('p-goal'), step: $('p-step'), common: $('p-common'),
    log: $('room-log'), roomForm: $('room-form'), roomInput: $('room-input'),
    remote: $('remote-video'), self: $('self-video'), selfOff: $('self-off'),
    mic: $('mic-btn'), cam: $('cam-btn'), next: $('next-btn'), end: $('end-btn')
  };
  if (!m.start || !m.form) return;

  var stream = null, main = null, lobby = null, call = null, dc = null;
  var state = 'idle', query = '', isRandom = false, topic = null, joinTimer = null, waitTimer = null, attempts = 0, session = 0;

  function emit(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (x) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  function show(view) { [m.start, m.search, m.call].forEach(function (v) { v.hidden = v !== view; }); }
  function addMsg(cls, who, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = (who ? '<span class="msg__who">' + esc(who) + '</span>' : '') + esc(text);
    m.log.appendChild(d);
    m.log.scrollTop = m.log.scrollHeight;
  }
  function setStatus(text, hint) {
    m.status.textContent = text;
    m.hint.textContent = hint || '';
    m.hint.hidden = !hint;
  }

  function myUid() {
    var mail = '';
    try { mail = sessionStorage.getItem('fv-signed-in') || ''; } catch (x) {}
    var h = 5381;
    for (var i = 0; i < mail.length; i++) h = ((h << 5) + h + mail.charCodeAt(i)) >>> 0;
    return 'u' + h.toString(36);
  }
  var MIN_SECONDS = 120;
  var countTimer = null, partnerUid = null;
  function clearCount() { clearTimeout(countTimer); countTimer = null; }

  function myName() {
    try {
      var mail = sessionStorage.getItem('fv-signed-in');
      var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}');
      if (mail && u[mail] && u[mail].name) return u[mail].name;
    } catch (x) {}
    return 'Flow Valu Mitglied';
  }

  function topicFor(q) {
    var low = q.toLowerCase();
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][2].test(low)) return { id: GROUPS[i][0], label: GROUPS[i][1] };
    var slug = low.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return { id: slug || 'zufall', label: q };
  }

  function ensureStream() {
    if (stream) return Promise.resolve(stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Kamera und Mikrofon sind in diesem Browser nicht verfügbar. Bitte die Seite über HTTPS öffnen.'));
    }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
      .catch(function () { return navigator.mediaDevices.getUserMedia({ video: false, audio: true }); })
      .then(function (s) {
        stream = s;
        m.self.srcObject = s;
        var hasVideo = s.getVideoTracks().length > 0;
        m.selfOff.hidden = hasVideo;
        m.mic.setAttribute('aria-pressed', 'true');
        m.cam.setAttribute('aria-pressed', hasVideo ? 'true' : 'false');
        return s;
      })
      .catch(function () { throw new Error('Bitte erlaube den Zugriff auf Kamera und Mikrofon, damit ihr euch sehen und hören könnt.'); });
  }

  function ensureMain() {
    if (main && !main.destroyed && main.open) return Promise.resolve(main);
    if (typeof window.Peer !== 'function') return Promise.reject(new Error('Die Video-Verbindung konnte nicht geladen werden. Bitte Internetverbindung prüfen.'));
    return new Promise(function (resolve, reject) {
      main = new window.Peer(PEER_CONFIG);
      main.on('open', function () { resolve(main); });
      main.on('error', function (err) { if (!main.open) reject(new Error('Verbindung zum Live-Server fehlgeschlagen.')); else console.warn(err); });
      main.on('call', onIncomingCall);
      main.on('connection', function (conn) { if (state === 'connected' || state === 'joining') bindData(conn); else conn.close(); });
    });
  }

  function cleanupLobby() { if (lobby) { try { lobby.destroy(); } catch (x) {} lobby = null; } }
  function clearTimers() { clearTimeout(joinTimer); clearTimeout(waitTimer); }

  function hangup() {
    endRoom();
    clearTimers();
    clearCount();
    partnerUid = null;
    cleanupLobby();
    if (call) { try { call.close(); } catch (x) {} call = null; }
    if (dc) { try { dc.close(); } catch (x) {} dc = null; }
    m.remote.srcObject = null;
    m.remote.hidden = true;
    m.initials.hidden = false;
    state = 'idle';
  }

  function fail(msg) {
    hangup();
    show(m.search);
    setStatus('Das hat nicht geklappt', msg);
    m.searchRandom.hidden = true;
  }

  function begin(q, random) {
    hangup();
    var my = ++session;
    query = q; isRandom = random; attempts = 0;
    topic = random ? { id: 'zufall', label: 'Zufall' } : topicFor(q);
    m.searchRandom.hidden = true;
    show(m.search);
    setStatus('Kamera und Mikrofon werden gestartet …');
    ensureStream()
      .then(ensureMain)
      .then(function () { if (my === session) tryLobby(my); })
      .catch(function (e) { if (my === session) fail(e.message); });
  }

  // Warteraum belegen. Ist er schon belegt, wartet dort jemand -> verbinden.
  function tryLobby(my) {
    if (my !== session) return;
    state = 'searching';
    setStatus(isRandom ? 'Suche eine zufällige Person …' : 'Suche Person mit „' + topic.label + '" …');
    cleanupLobby();
    var lp = new window.Peer(LOBBY_PREFIX + topic.id, PEER_CONFIG);
    lobby = lp;
    lp.on('open', function () {
      if (my !== session) { lp.destroy(); return; }
      state = 'waiting';
      setStatus(isRandom ? 'Warte auf eine zufällige Person …' : 'Warte auf eine Person mit „' + topic.label + '" …',
        'Gerade ist noch niemand mit diesem Thema online. Sobald jemand sucht, werdet ihr automatisch verbunden.');
      if (!isRandom) waitTimer = setTimeout(function () { if (state === 'waiting') m.searchRandom.hidden = false; }, 8000);
    });
    lp.on('connection', function (conn) {
      conn.on('data', function (d) {
        if (state !== 'waiting' || !d || d.type !== 'hello' || !d.id) return;
        state = 'connected';
        cleanupLobby();
        startCallTo(d.id, d.profile);
      });
    });
    lp.on('error', function (err) {
      if (my !== session) return;
      if (err && err.type === 'unavailable-id') { cleanupLobby(); joinLobby(my); }
      else if (state === 'searching') fail('Der Live-Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');
    });
  }

  // Jemand wartet bereits: anklopfen und auf den Anruf warten.
  function joinLobby(my) {
    state = 'joining';
    setStatus('Person gefunden, verbinde …');
    var knock = main.connect(LOBBY_PREFIX + topic.id, { reliable: true });
    knock.on('open', function () { knock.send({ type: 'hello', id: main.id, profile: { name: myName(), term: query || 'Zufall', uid: myUid() } }); });
    joinTimer = setTimeout(function () {
      if (state !== 'joining' || my !== session) return;
      try { knock.close(); } catch (x) {}
      if (++attempts < 3) tryLobby(my);
      else fail('Die Verbindung zur anderen Person kam nicht zustande. Bitte erneut suchen.');
    }, 8000);
  }

  function onIncomingCall(incoming) {
    if (state !== 'joining') { incoming.close(); return; }
    clearTimeout(joinTimer);
    state = 'connected';
    incoming.answer(stream);
    bindCall(incoming);
    enterRoom(null);
  }

  function startCallTo(peerId, profile) {
    var outgoing = main.call(peerId, stream);
    bindCall(outgoing);
    bindData(main.connect(peerId, { reliable: true }));
    enterRoom(profile);
  }

  function bindCall(c) {
    call = c;
    c.on('stream', function (remoteStream) {
      m.remote.srcObject = remoteStream;
      m.remote.hidden = false;
      m.initials.hidden = true;
      m.step.textContent = 'Live verbunden';
      if (!countTimer && state === 'connected') {
        var my = session;
        countTimer = setTimeout(function () {
          countTimer = null;
          if (my !== session || state !== 'connected' || !m.remote.srcObject) return;
          emit('fv:match', { topic: topic.label, partner: partnerUid || ('anon-' + (call && call.peer)), seconds: MIN_SECONDS });
        }, MIN_SECONDS * 1000);
      }
      var p = m.remote.play(); if (p && p.catch) p.catch(function () {});
    });
    c.on('close', partnerLeft);
    c.on('error', partnerLeft);
    var pc = c.peerConnection;
    if (pc) pc.addEventListener('iceconnectionstatechange', function () {
      if (pc.iceConnectionState === 'failed') {
        addMsg('msg--note', '', 'Die Video-Verbindung konnte nicht aufgebaut werden (Netzwerk blockiert).');
      } else if (pc.iceConnectionState === 'disconnected') {
        setTimeout(function () { if (pc.iceConnectionState === 'disconnected') partnerLeft(); }, 4000);
      }
    });
  }

  function bindData(conn) {
    dc = conn;
    conn.on('open', function () { conn.send({ type: 'profile', profile: { name: myName(), term: query || 'Zufall', uid: myUid() } }); });
    conn.on('data', function (d) {
      if (!d) return;
      if (d.type === 'profile') fillPartner(d.profile);
      if (d.type === 'msg' && d.text) addMsg('msg--bot', m.name.textContent || 'Partner', String(d.text).slice(0, 1000));
      if (d.type === 'bye') partnerLeft();
      if (['profile', 'msg', 'bye'].indexOf(d.type) < 0) emit('fv:data', d);
    });
    conn.on('close', partnerLeft);
  }

  function fillPartner(p) {
    p = p || {};
    var name = String(p.name || 'Flow Valu Mitglied').slice(0, 40);
    var term = String(p.term || '').slice(0, 60);
    m.initials.textContent = name.slice(0, 2).toUpperCase();
    m.nameTag.textContent = name;
    m.name.textContent = name;
    m.meta.textContent = isRandom ? 'Zufällig verbunden' : 'Verbunden über „' + topic.label + '"';
    m.goal.textContent = term || '–';
    m.common.innerHTML = '<span class="tag">' + esc(topic.label) + '</span>';
    if (p.uid) partnerUid = String(p.uid).slice(0, 20);
  }

  var inRoom = false;
  function endRoom() {
    if (!inRoom) return;
    inRoom = false;
    emit('fv:call-end', { topic: topic && topic.label, partner: m.name.textContent, me: myName() });
  }

  window.FVCall = {
    send: function (o) { if (dc && dc.open) { try { dc.send(o); return true; } catch (x) {} } return false; },
    pc: function () { return call && call.peerConnection; },
    stream: function () { return stream; },
    me: function () { return myName(); },
    partner: function () { return m.name.textContent || 'Partner'; },
    topic: function () { return topic ? topic.label : ''; },
    connected: function () { return state === 'connected'; },
    selfVideo: m.self,
    remoteVideo: m.remote
  };

  function enterRoom(profile) {
    inRoom = true;
    emit('fv:call-start', {});
    m.log.innerHTML = '';
    m.initials.textContent = '··';
    m.nameTag.textContent = '';
    m.name.textContent = 'Verbinde …';
    m.meta.textContent = '';
    m.goal.textContent = '–';
    m.step.textContent = 'Video wird verbunden …';
    m.common.innerHTML = '';
    if (profile) fillPartner(profile);
    addMsg('msg--note', '', isRandom ? 'Zufällig verbunden' : 'Verbunden über: ' + topic.label);
    addMsg('msg--note', '', 'Das Gespräch zählt für deinen Fortschritt, sobald ihr 2 Minuten per Video verbunden seid.');
    show(m.call);
  }

  function partnerLeft() {
    if (state !== 'connected') return;
    state = 'ended';
    clearCount();
    m.remote.srcObject = null;
    m.remote.hidden = true;
    m.initials.hidden = false;
    m.step.textContent = 'Hat den Chat verlassen';
    endRoom();
    addMsg('msg--note', '', 'Die Person hat den Chat verlassen. Klicke auf „Nächste Person".');
  }

  document.addEventListener('fv:match-result', function (e) {
    var d = e.detail || {};
    if (state !== 'connected') return;
    addMsg('msg--note', '', d.counted ? '2 Minuten erreicht — Gespräch zählt (+' + d.xp + ' Flow).' : d.reason);
  });

  TOPICS.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sug';
    b.textContent = t;
    b.addEventListener('click', function () { m.input.value = t; begin(t, false); });
    m.topics.appendChild(b);
  });

  m.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = m.input.value.trim();
    if (!q) { m.input.focus(); return; }
    begin(q, false);
  });
  m.random.addEventListener('click', function () { begin('', true); });
  m.searchRandom.addEventListener('click', function () { begin('', true); });
  m.cancel.addEventListener('click', function () { session++; hangup(); show(m.start); });

  function sayBye() { if (dc && dc.open) { try { dc.send({ type: 'bye' }); } catch (x) {} } }
  m.next.addEventListener('click', function () { sayBye(); begin(query, isRandom); });
  m.end.addEventListener('click', function () {
    sayBye();
    session++;
    hangup();
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    m.self.srcObject = null;
    if (main) { try { main.destroy(); } catch (x) {} main = null; }
    show(m.start);
  });

  m.roomForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = m.roomInput.value.trim();
    if (!t) return;
    if (!dc || !dc.open || state !== 'connected') { addMsg('msg--note', '', 'Nachricht nicht gesendet – keine Verbindung.'); return; }
    dc.send({ type: 'msg', text: t });
    addMsg('msg--user', '', t);
    m.roomInput.value = '';
  });

  m.mic.addEventListener('click', function () {
    if (!stream || !stream.getAudioTracks().length) return;
    var on = m.mic.getAttribute('aria-pressed') !== 'true';
    stream.getAudioTracks().forEach(function (t) { t.enabled = on; });
    m.mic.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  m.cam.addEventListener('click', function () {
    if (!stream || !stream.getVideoTracks().length) return;
    var on = m.cam.getAttribute('aria-pressed') !== 'true';
    stream.getVideoTracks().forEach(function (t) { t.enabled = on; });
    m.cam.setAttribute('aria-pressed', on ? 'true' : 'false');
    m.selfOff.hidden = on;
  });

  window.addEventListener('pagehide', function () {
    sayBye();
    cleanupLobby();
    if (main) { try { main.destroy(); } catch (x) {} }
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  });
})();
