/* Flow Valu – Live-Match: Video-Chat zwischen zwei Nutzern mit Ziel-Suche.
   Zwei Transportwege mit gleicher Oberfläche:
   – Server (Supabase): Warteschlange + Matching in der Datenbank, Signaling über Supabase Realtime,
     TURN über die Edge Function, XP-Bestätigung auf dem Server, Melden & Blockieren.
   – Testmodus (ohne Server): öffentlicher PeerJS-Vermittler, XP lokal. */
(function () {
  'use strict';

  var TOPICS = ['Unternehmen gründen', 'Vertrieb', 'Finanzen', 'Führung', 'Disziplin', 'Karrierewechsel'];
  var GROUPS = [
    ['unternehmen', 'Unternehmen gründen', /unternehm|gr(ü|ue)nd|startup|selbst|business|firma|idee|agentur/],
    ['vertrieb', 'Vertrieb', /vertrieb|verkauf|sales|kunde|akquise/],
    ['finanzen', 'Finanzen', /finanz|geld|spar|invest|unabh|nebenjob|einkommen/],
    ['fuehrung', 'Führung', /f(ü|ue)hrung|leader|team|chef|manag/],
    ['disziplin', 'Disziplin', /disziplin|routine|fitness|sport|gewohn|fokus/],
    ['karriere', 'Karrierewechsel', /karriere|job|beruf|wechsel|bewerb|marketing/]
  ];
  var MIN_SECONDS = 120;
  var B = window.FVB;
  if (!B) return; // Testmodus: script.js übernimmt

  var $ = function (id) { return document.getElementById(id); };
  var m = {
    start: $('view-start'), search: $('view-search'), call: $('view-call'),
    form: $('search-form'), input: $('search-input'), random: $('random-btn'), topics: $('topics'), flash: $('match-flash'),
    status: $('search-status'), hint: $('search-hint'), searchRandom: $('search-random'), cancel: $('search-cancel'),
    initials: $('p-initials'), nameTag: $('p-name-tag'), name: $('p-name'), meta: $('p-meta'),
    goal: $('p-goal'), step: $('p-step'), common: $('p-common'),
    log: $('room-log'), roomForm: $('room-form'), roomInput: $('room-input'),
    remote: $('remote-video'), self: $('self-video'), selfOff: $('self-off'),
    mic: $('mic-btn'), cam: $('cam-btn'), next: $('next-btn'), end: $('end-btn'),
    blockBtn: $('block-btn'), reportBtn: $('report-btn'), reportForm: $('report-form'), reportCancel: $('report-cancel'), reportDetails: $('report-details')
  };
  if (!m.start || !m.form) return;

  var stream = null, transport = null, state = 'idle', query = '', isRandom = false, topic = null;
  var session = 0, waitTimer = null, countTimer = null, partnerUid = null, inRoom = false;

  /* ---------- Helfer ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function emit(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (x) {} }
  function show(view) { [m.start, m.search, m.call].forEach(function (v) { v.hidden = v !== view; }); }
  function addMsg(cls, who, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = (who ? '<span class="msg__who">' + esc(who) + '</span>' : '') + esc(text);
    m.log.appendChild(d);
    m.log.scrollTop = m.log.scrollHeight;
  }
  function setStatus(text, hint) { m.status.textContent = text; m.hint.textContent = hint || ''; m.hint.hidden = !hint; }
  function flash(text) { if (!m.flash) return; m.flash.textContent = text || ''; m.flash.hidden = !text; }

  function myName() {
    try {
      var n = sessionStorage.getItem('fv-me-name');
      if (n) return n;
      var mail = sessionStorage.getItem('fv-signed-in');
      var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}');
      if (mail && u[mail] && u[mail].name) return u[mail].name;
    } catch (x) {}
    return 'Flow Valu Mitglied';
  }
  function myUid() {
    var mail = '';
    try { mail = sessionStorage.getItem('fv-signed-in') || ''; } catch (x) {}
    var h = 5381;
    for (var i = 0; i < mail.length; i++) h = ((h << 5) + h + mail.charCodeAt(i)) >>> 0;
    return 'u' + h.toString(36);
  }
  function myProfile() { return { name: myName(), term: query || 'Zufall', uid: myUid() }; }

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
  function stopStream() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    m.self.srcObject = null;
  }

  /* ======================================================================
     Transport A: Server (Supabase + WebRTC)
     ====================================================================== */
  function serverTransport(h) {
    var sb = B.sb, closed = false, roomId = null, role = null, ch = null, pc = null, dcn = null;
    var pollTimer = null, joinTimer = null, since = null, offered = false, replied = false, pendingIce = [], gotMedia = false;
    var iceP = B.fn((window.FV_CONFIG && window.FV_CONFIG.turnFunction) || 'turn', {}).then(function (d) { return (d && d.iceServers) || []; })
      .catch(function () { return [{ urls: 'stun:stun.l.google.com:19302' }]; });

    function sig(obj) { if (ch) ch.send({ type: 'broadcast', event: 'sig', payload: obj }); }

    function enqueue() {
      B.rpc('find_match', { p_topic: topic.id, p_label: topic.label, p_term: query || 'Zufall' }).then(function (r) {
        if (closed) return;
        if (r.status === 'matched') join(r.room_id, 'caller', { name: r.partner_name, term: r.partner_term });
        else { since = r.since; h.onWaiting(); poll(); }
      }).catch(function (e) { h.onFail('Das Matching ist gerade nicht erreichbar (' + e.message + ').'); });
    }

    function poll() {
      pollTimer = setTimeout(function () {
        if (closed) return;
        B.rpc('poll_match', { p_since: since }).then(function (r) {
          if (closed) return;
          if (r.status === 'matched') join(r.room_id, 'callee', { name: r.partner_name, term: r.partner_term });
          else if (r.status === 'gone') enqueue();
          else poll();
        }).catch(function () { if (!closed) poll(); });
      }, 2000);
    }

    function flushIce() {
      var list = pendingIce; pendingIce = [];
      list.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
    }

    function onSig(p) {
      if (!p || !pc || closed) return;
      if (p.k === 'ready') {
        if (role === 'caller' && !offered) {
          offered = true;
          pc.createOffer().then(function (o) { return pc.setLocalDescription(o); })
            .then(function () { sig({ k: 'offer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); });
        } else if (role === 'callee' && !replied) {
          replied = true;
          sig({ k: 'ready' });
        }
      } else if (p.k === 'offer' && role === 'callee') {
        pc.setRemoteDescription(p.sdp).then(flushIce)
          .then(function () { return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a); })
          .then(function () { sig({ k: 'answer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
          .catch(function () { h.onFail('Die Verbindung konnte nicht aufgebaut werden.'); });
      } else if (p.k === 'answer' && role === 'caller') {
        pc.setRemoteDescription(p.sdp).then(flushIce).catch(function () {});
      } else if (p.k === 'ice' && p.c) {
        if (pc.remoteDescription) pc.addIceCandidate(p.c).catch(function () {});
        else pendingIce.push(p.c);
      } else if (p.k === 'bye') {
        h.onClosed();
      }
    }

    function bindDc(d) {
      dcn = d;
      d.onopen = function () { h.onDataOpen(); };
      d.onmessage = function (e) { try { h.onData(JSON.parse(e.data)); } catch (x) {} };
      d.onclose = function () { if (!closed) h.onClosed(); };
    }

    function join(id, rl, profile) {
      roomId = id; role = rl;
      h.onJoining();
      iceP.then(function (ice) {
        if (closed) return;
        pc = new RTCPeerConnection({ iceServers: ice });
        var s = h.stream();
        s.getTracks().forEach(function (t) { pc.addTrack(t, s); });
        pc.ontrack = function (e) { gotMedia = true; clearTimeout(joinTimer); h.onRemoteStream(e.streams[0]); };
        pc.onicecandidate = function (e) { if (e.candidate) sig({ k: 'ice', c: e.candidate.toJSON() }); };
        pc.oniceconnectionstatechange = function () {
          var st = pc.iceConnectionState;
          if (st === 'failed') h.onNote('Die Video-Verbindung konnte nicht aufgebaut werden (Netzwerk blockiert).');
          if (st === 'disconnected') setTimeout(function () { if (pc && pc.iceConnectionState === 'disconnected') h.onClosed(); }, 5000);
        };
        if (role === 'caller') bindDc(pc.createDataChannel('fv', { ordered: true }));
        else pc.ondatachannel = function (e) { bindDc(e.channel); };

        ch = sb.channel('fv-room-' + id, { config: { broadcast: { self: false } } });
        ch.on('broadcast', { event: 'sig' }, function (msg) { onSig(msg.payload); });
        ch.subscribe(function (status) { if (status === 'SUBSCRIBED') sig({ k: 'ready' }); });

        h.onMatched(profile);
        joinTimer = setTimeout(function () { if (!gotMedia && !closed) h.onNote('Die Video-Verbindung braucht länger als üblich …'); }, 15000);
      });
    }

    return {
      start: function () { h.onSearching(); enqueue(); },
      send: function (o) { if (dcn && dcn.readyState === 'open') { try { dcn.send(JSON.stringify(o)); return true; } catch (x) {} } return false; },
      pc: function () { return pc; },
      close: function () {
        if (closed) return;
        closed = true;
        clearTimeout(pollTimer); clearTimeout(joinTimer);
        if (!roomId) B.rpc('leave_queue').catch(function () {});
        else { sig({ k: 'bye' }); B.rpc('end_room', { p_room: roomId }).catch(function () {}); }
        if (dcn) { try { dcn.close(); } catch (x) {} }
        if (pc) { try { pc.close(); } catch (x) {} }
        if (ch) { var c = ch; setTimeout(function () { sb.removeChannel(c); }, 300); }
        pc = null; dcn = null;
      },
      confirm: function () {
        var tries = 0;
        function attempt() {
          return B.rpc('confirm_match', { p_room: roomId }).then(function (r) {
            if (r && r.pending && tries++ < 8) return new Promise(function (res) { setTimeout(res, 5000); }).then(attempt);
            if (r && r.pending) return { counted: false, reason: 'Die andere Person hat das Gespräch nicht bestätigt.' };
            return r;
          });
        }
        return attempt();
      },
      block: function () { return roomId ? B.rpc('block_user', { p_room: roomId }) : Promise.resolve(); },
      report: function (reason, details) { return roomId ? B.rpc('report_user', { p_room: roomId, p_reason: reason, p_details: details }) : Promise.resolve(); },
      server: true
    };
  }

  /* ======================================================================
     Transport B: Testmodus (öffentlicher PeerJS-Vermittler)
     ====================================================================== */
  var LOBBY_PREFIX = 'flowvalu-live-v1-';
  var PEER_CONFIG = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } };
  var peerMain = null, peerHandler = null;

  function ensurePeerMain() {
    if (peerMain && !peerMain.destroyed && peerMain.open) return Promise.resolve(peerMain);
    if (typeof window.Peer !== 'function') return Promise.reject(new Error('Die Video-Verbindung konnte nicht geladen werden. Bitte Internetverbindung prüfen.'));
    return new Promise(function (resolve, reject) {
      peerMain = new window.Peer(PEER_CONFIG);
      peerMain.on('open', function () { resolve(peerMain); });
      peerMain.on('error', function (err) { if (!peerMain.open) reject(new Error('Verbindung zum Live-Server fehlgeschlagen.')); else console.warn(err); });
      peerMain.on('call', function (c) { if (peerHandler) peerHandler.incoming(c); else c.close(); });
      peerMain.on('connection', function (c) { if (peerHandler) peerHandler.conn(c); else c.close(); });
    });
  }

  function peerTransport(h) {
    var closed = false, lobby = null, call = null, conn = null, joinTimer = null, attempts = 0, st = 'idle';

    function cleanupLobby() { if (lobby) { try { lobby.destroy(); } catch (x) {} lobby = null; } }

    function bindCall(c) {
      call = c;
      c.on('stream', function (rs) { h.onRemoteStream(rs); });
      c.on('close', function () { if (!closed) h.onClosed(); });
      c.on('error', function () { if (!closed) h.onClosed(); });
      var pc = c.peerConnection;
      if (pc) pc.addEventListener('iceconnectionstatechange', function () {
        if (pc.iceConnectionState === 'failed') h.onNote('Die Video-Verbindung konnte nicht aufgebaut werden (Netzwerk blockiert).');
        else if (pc.iceConnectionState === 'disconnected') setTimeout(function () { if (pc.iceConnectionState === 'disconnected' && !closed) h.onClosed(); }, 4000);
      });
    }
    function bindData(c) {
      conn = c;
      c.on('open', function () { h.onDataOpen(); });
      c.on('data', function (d) { h.onData(d); });
      c.on('close', function () { if (!closed) h.onClosed(); });
    }

    var handler = {
      incoming: function (c) {
        if (st !== 'joining' || closed) { c.close(); return; }
        clearTimeout(joinTimer);
        st = 'connected';
        c.answer(h.stream());
        bindCall(c);
        h.onMatched(null);
      },
      conn: function (c) { if ((st === 'joining' || st === 'connected') && !closed) bindData(c); else c.close(); }
    };

    function tryLobby() {
      if (closed) return;
      st = 'searching';
      h.onSearching();
      cleanupLobby();
      var lp = new window.Peer(LOBBY_PREFIX + topic.id, PEER_CONFIG);
      lobby = lp;
      lp.on('open', function () { if (closed) { lp.destroy(); return; } st = 'waiting'; h.onWaiting(); });
      lp.on('connection', function (c) {
        c.on('data', function (d) {
          if (st !== 'waiting' || !d || d.type !== 'hello' || !d.id) return;
          st = 'connected';
          cleanupLobby();
          var outgoing = peerMain.call(d.id, h.stream());
          bindCall(outgoing);
          bindData(peerMain.connect(d.id, { reliable: true }));
          h.onMatched(d.profile);
        });
      });
      lp.on('error', function (err) {
        if (closed) return;
        if (err && err.type === 'unavailable-id') { cleanupLobby(); joinLobby(); }
        else if (st === 'searching') h.onFail('Der Live-Server ist gerade nicht erreichbar. Bitte später erneut versuchen.');
      });
    }

    function joinLobby() {
      st = 'joining';
      h.onJoining();
      var knock = peerMain.connect(LOBBY_PREFIX + topic.id, { reliable: true });
      knock.on('open', function () { knock.send({ type: 'hello', id: peerMain.id, profile: myProfile() }); });
      joinTimer = setTimeout(function () {
        if (st !== 'joining' || closed) return;
        try { knock.close(); } catch (x) {}
        if (++attempts < 3) tryLobby();
        else h.onFail('Die Verbindung zur anderen Person kam nicht zustande. Bitte erneut suchen.');
      }, 8000);
    }

    return {
      start: function () {
        peerHandler = handler;
        ensurePeerMain().then(tryLobby).catch(function (e) { h.onFail(e.message); });
      },
      send: function (o) { if (conn && conn.open) { try { conn.send(o); return true; } catch (x) {} } return false; },
      pc: function () { return call && call.peerConnection; },
      close: function () {
        if (closed) return;
        closed = true;
        clearTimeout(joinTimer);
        cleanupLobby();
        if (call) { try { call.close(); } catch (x) {} }
        if (conn) { try { conn.close(); } catch (x) {} }
        if (peerHandler === handler) peerHandler = null;
      },
      confirm: null,
      block: function () { return Promise.resolve(); },
      report: function () { return Promise.resolve(); },
      server: false
    };
  }

  /* ======================================================================
     Ablauf & Oberfläche
     ====================================================================== */
  function clearCount() { clearTimeout(countTimer); countTimer = null; }

  function endRoom() {
    if (!inRoom) return;
    inRoom = false;
    emit('fv:call-end', { topic: topic && topic.label, partner: m.name.textContent, me: myName() });
  }

  function hangup() {
    endRoom();
    clearTimeout(waitTimer);
    clearCount();
    partnerUid = null;
    if (transport) { transport.close(); transport = null; }
    m.remote.srcObject = null;
    m.remote.hidden = true;
    m.initials.hidden = false;
    if (m.reportForm) m.reportForm.hidden = true;
    state = 'idle';
  }

  function fail(msg) {
    hangup();
    show(m.search);
    setStatus('Das hat nicht geklappt', msg);
    m.searchRandom.hidden = true;
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
    if (profile && profile.name) fillPartner(profile);
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
    addMsg('msg--note', '', 'Die Person hat den Chat verlassen. Klicke auf „Nächste Person".');
    endRoom();
  }

  function startCount(my) {
    if (countTimer || state !== 'connected') return;
    countTimer = setTimeout(function () {
      countTimer = null;
      if (my !== session || state !== 'connected' || !m.remote.srcObject) return;
      if (transport && transport.confirm) {
        transport.confirm().then(function (res) { emit('fv:match-result', res || {}); })
          .catch(function (e) { emit('fv:match-result', { counted: false, reason: 'Fortschritt konnte nicht gespeichert werden: ' + e.message }); });
      } else {
        emit('fv:match', { topic: topic.label, partner: partnerUid || 'anon', seconds: MIN_SECONDS });
      }
    }, MIN_SECONDS * 1000);
  }

  function handlers(my) {
    var live = function () { return my === session; };
    return {
      stream: function () { return stream; },
      onSearching: function () { if (!live()) return; state = 'searching'; setStatus(isRandom ? 'Suche eine zufällige Person …' : 'Suche Person mit „' + topic.label + '" …'); },
      onWaiting: function () {
        if (!live()) return;
        state = 'waiting';
        setStatus(isRandom ? 'Warte auf eine zufällige Person …' : 'Warte auf eine Person mit „' + topic.label + '" …',
          'Gerade ist noch niemand mit diesem Thema online. Sobald jemand sucht, werdet ihr automatisch verbunden.');
        clearTimeout(waitTimer);
        if (!isRandom) waitTimer = setTimeout(function () { if (live() && state === 'waiting') m.searchRandom.hidden = false; }, 8000);
      },
      onJoining: function () { if (!live()) return; state = 'joining'; setStatus('Person gefunden, verbinde …'); },
      onMatched: function (profile) { if (!live()) return; state = 'connected'; enterRoom(profile); },
      onDataOpen: function () { if (live() && transport) transport.send({ type: 'profile', profile: myProfile() }); },
      onData: function (d) {
        if (!live() || !d) return;
        if (d.type === 'profile') fillPartner(d.profile);
        else if (d.type === 'msg' && d.text) addMsg('msg--bot', m.name.textContent || 'Partner', String(d.text).slice(0, 1000));
        else if (d.type === 'bye') partnerLeft();
        else emit('fv:data', d);
      },
      onRemoteStream: function (rs) {
        if (!live()) return;
        m.remote.srcObject = rs;
        m.remote.hidden = false;
        m.initials.hidden = true;
        m.step.textContent = 'Live verbunden';
        var p = m.remote.play(); if (p && p.catch) p.catch(function () {});
        startCount(my);
      },
      onClosed: function () { if (live()) partnerLeft(); },
      onNote: function (t) { if (live() && state === 'connected') addMsg('msg--note', '', t); },
      onFail: function (msg) { if (live()) fail(msg); }
    };
  }

  function begin(q, random) {
    hangup();
    flash('');
    var my = ++session;
    query = q; isRandom = random;
    topic = random ? { id: 'zufall', label: 'Zufall' } : topicFor(q);
    m.searchRandom.hidden = true;
    show(m.search);
    setStatus('Kamera und Mikrofon werden gestartet …');
    ensureStream().then(function () {
      if (my !== session) return;
      transport = (B ? serverTransport : peerTransport)(handlers(my));
      transport.start();
    }).catch(function (e) { if (my === session) fail(e.message); });
  }

  function sayBye() { if (transport) transport.send({ type: 'bye' }); }

  function stopAll(message) {
    sayBye();
    session++;
    hangup();
    stopStream();
    show(m.start);
    flash(message || '');
  }

  /* ---------- Bedienung ---------- */
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
  m.next.addEventListener('click', function () { sayBye(); begin(query, isRandom); });
  m.end.addEventListener('click', function () { stopAll(''); });

  m.roomForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = m.roomInput.value.trim();
    if (!t) return;
    if (!transport || state !== 'connected' || !transport.send({ type: 'msg', text: t })) {
      addMsg('msg--note', '', 'Nachricht nicht gesendet – keine Verbindung.');
      return;
    }
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

  /* ---------- Melden & Blockieren ---------- */
  var serverHint = B ? '' : ' (Im Testmodus ohne Server wird nichts gespeichert.)';

  if (m.blockBtn) m.blockBtn.addEventListener('click', function () {
    if (!transport) return;
    if (!window.confirm('Diese Person blockieren? Ihr werdet nicht mehr miteinander verbunden.')) return;
    var t = transport;
    t.block().then(function () { stopAll('Die Person wurde blockiert.' + serverHint); }, function (e) { stopAll('Blockieren fehlgeschlagen: ' + e.message); });
  });

  if (m.reportBtn) m.reportBtn.addEventListener('click', function () {
    m.reportForm.hidden = !m.reportForm.hidden;
    if (!m.reportForm.hidden) m.reportDetails.focus();
  });
  if (m.reportCancel) m.reportCancel.addEventListener('click', function () { m.reportForm.hidden = true; });
  if (m.reportForm) m.reportForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!transport) return;
    var r = m.reportForm.querySelector('input[name="reason"]:checked');
    var reason = r ? r.value : 'andere';
    var details = m.reportDetails.value.trim().slice(0, 500);
    var t = transport;
    t.report(reason, details).then(function () {
      m.reportDetails.value = '';
      stopAll('Danke für deine Meldung. Die Person wurde blockiert und wird geprüft.' + serverHint);
    }, function (err) { addMsg('msg--note', '', 'Meldung fehlgeschlagen: ' + err.message); });
  });

  /* ---------- Ergebnis der XP-Bestätigung ---------- */
  document.addEventListener('fv:match-result', function (e) {
    var d = e.detail || {};
    if (state !== 'connected') return;
    addMsg('msg--note', '', d.counted ? '2 Minuten erreicht — Gespräch zählt (+' + d.xp + ' Flow).' : (d.reason || 'Gespräch wurde nicht gezählt.'));
  });

  /* ---------- Schnittstelle für Werkzeuge (Mitschrift, Bildschirm, KI) ---------- */
  window.FVCall = {
    send: function (o) { return transport ? transport.send(o) : false; },
    pc: function () { return transport ? transport.pc() : null; },
    stream: function () { return stream; },
    me: function () { return myName(); },
    partner: function () { return m.name.textContent || 'Partner'; },
    topic: function () { return topic ? topic.label : ''; },
    connected: function () { return state === 'connected'; },
    selfVideo: m.self,
    remoteVideo: m.remote
  };

  document.addEventListener('fv:signout', function () { stopAll(''); });
  window.addEventListener('pagehide', function () {
    sayBye();
    if (transport) transport.close();
    if (peerMain) { try { peerMain.destroy(); } catch (x) {} }
    stopStream();
  });
})();
