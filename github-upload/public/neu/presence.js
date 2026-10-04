/* Flow Valu – Live-Anzahl der Nutzer online + Countdowns (Suche, 2-Minuten-Zähler, Gesprächsdauer). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var B = window.FVB;
  var MIN_SECONDS = 120;

  function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  /* ---------- Online-Anzahl (Supabase Realtime Presence) ---------- */
  var badges = [];
  document.querySelectorAll('a[data-route="live"]').forEach(function (a) {
    var b = document.createElement('span');
    b.className = 'online-badge'; b.hidden = true;
    b.setAttribute('aria-label', 'Nutzer online');
    a.appendChild(b); badges.push(b);
  });
  var liveTag = document.querySelector('#view-start .match__live');
  var liveCount = null;
  if (liveTag) { liveCount = document.createElement('span'); liveCount.className = 'match__count'; liveTag.appendChild(liveCount); }

  function showCount(n) {
    badges.forEach(function (b) { b.textContent = n; b.hidden = !n; b.title = n + (n === 1 ? ' Person' : ' Personen') + ' online'; });
    if (liveCount) liveCount.textContent = n ? ' · ' + n + ' online' : '';
  }

  var ch = null;
  function joinPresence(uid) {
    if (!B || !uid || ch) return;
    ch = B.sb.channel('fv-online', { config: { presence: { key: uid } } });
    ch.on('presence', { event: 'sync' }, function () { showCount(Object.keys(ch.presenceState()).length); });
    ch.subscribe(function (status) { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
  }
  function leavePresence() { if (ch) { B.sb.removeChannel(ch); ch = null; } showCount(0); }

  if (B) {
    document.addEventListener('fv:signin', function (e) {
      var id = e.detail && e.detail.uid;
      (id ? Promise.resolve(id) : B.uid()).then(joinPresence);
    });
    document.addEventListener('fv:signout', leavePresence);
    B.uid().then(function (id) { if (id) joinPresence(id); });
  }

  /* ---------- Wartezeit bei der Suche ---------- */
  var search = $('view-search'), status = $('search-status');
  var waitEl = document.createElement('div'); waitEl.className = 'cd cd--wait'; waitEl.hidden = true;
  if (status) status.parentNode.insertBefore(waitEl, status.nextSibling);
  var waitStart = 0, waitTimer = null;
  function tickWait() { waitEl.textContent = 'Wartezeit ' + mmss((Date.now() - waitStart) / 1000); }
  if (search) new MutationObserver(function () {
    clearInterval(waitTimer);
    if (search.hidden) { waitEl.hidden = true; return; }
    waitStart = Date.now(); waitEl.hidden = false; tickWait();
    waitTimer = setInterval(tickWait, 1000);
  }).observe(search, { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- Im Gespräch: 2-Minuten-Countdown, dann Gesprächsdauer ---------- */
  var remote = $('remote-video'), pname = $('p-name');
  var cd = document.createElement('div'); cd.className = 'cd cd--call'; cd.hidden = true;
  cd.innerHTML = '<span class="cd__ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="cd__bg" cx="18" cy="18" r="15.5" /><circle class="cd__fg" id="cd-fg" cx="18" cy="18" r="15.5" /></svg></span><span class="cd__txt"><span class="cd__big" id="cd-big"></span><span class="cd__small" id="cd-small"></span></span>';
  if (pname) pname.parentNode.insertBefore(cd, pname);
  var callStart = 0, callTimer = null, C = 2 * Math.PI * 15.5;

  function tickCall() {
    var s = (Date.now() - callStart) / 1000, fg = $('cd-fg');
    if (s < MIN_SECONDS) {
      $('cd-big').textContent = mmss(MIN_SECONDS - s);
      $('cd-small').textContent = 'bis das Gespräch für deinen Fortschritt zählt';
      fg.style.strokeDashoffset = C * (1 - s / MIN_SECONDS);
      cd.classList.remove('is-done');
    } else {
      $('cd-big').textContent = mmss(s);
      $('cd-small').textContent = 'Gespräch läuft · zählt für deinen Fortschritt';
      fg.style.strokeDashoffset = 0;
      cd.classList.add('is-done');
    }
  }
  function startCall() { if (callTimer) return; callStart = Date.now(); cd.hidden = false; tickCall(); callTimer = setInterval(tickCall, 1000); }
  function stopCall() { clearInterval(callTimer); callTimer = null; cd.hidden = true; }

  if (remote) {
    remote.addEventListener('playing', startCall);
    remote.addEventListener('emptied', stopCall);
  }
  document.addEventListener('fv:call-start', stopCall);
  document.addEventListener('fv:call-end', stopCall);
})();
