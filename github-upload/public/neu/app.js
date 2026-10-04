/* Flow Valu — App-Shell (Menü, Seitenwechsel) und Fortschritt & Level.
   Alle Daten liegen vorerst lokal im Browser (pro Konto). Später durch Server ersetzen. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Menü & Seitenwechsel ---------- */
  var side = $('side'), scrim = $('side-scrim'), openBtn = $('menu-open'), closeBtn = $('menu-close');
  var views = document.querySelectorAll('.view');
  var links = document.querySelectorAll('.side__link');

  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    scrim.hidden = !open;
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  openBtn.addEventListener('click', function () { setMenu(true); });
  closeBtn.addEventListener('click', function () { setMenu(false); });
  scrim.addEventListener('click', function () { setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  function route() {
    var r = (location.hash || '#heute').slice(1);
    if (['heute', 'weg', 'start', 'live', 'fortschritt', 'notizen', 'austausch', 'profil', 'einstellungen'].indexOf(r) < 0) r = 'heute';
    Array.prototype.forEach.call(views, function (v) { v.hidden = v.getAttribute('data-view') !== r; });
    Array.prototype.forEach.call(links, function (a) {
      var on = a.getAttribute('data-route') === (r === 'start' ? 'heute' : r);
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    setMenu(false);
    if (r === 'fortschritt') renderProgress();
    try { document.dispatchEvent(new CustomEvent('fv:route', { detail: { route: r } })); } catch (x) {}
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- Fortschritt & Level ---------- */
  var LEVELS = [
    { n: 1, name: 'Discipline', xp: 0, text: 'Du baust die Grundlage: ein Ziel, ein Weg, die ersten Schritte.' },
    { n: 2, name: 'Action', xp: 100, text: 'Du setzt um. Schritte werden erledigt, Gespräche werden zu Handlungen.' },
    { n: 3, name: 'Growth', xp: 300, text: 'Du wächst sichtbar: Meilensteine sind abgeschlossen, Ergebnisse liegen vor.' },
    { n: 4, name: 'Results', xp: 600, text: 'Deine Arbeit zeigt Ergebnisse, die andere sehen.' },
    { n: 5, name: 'Freedom', xp: 1000, text: 'Du kommst an deinen Zielen an. Discipline builds freedom.' }
  ];
  var XP = { match: 20, topic: 15, day: 0 };
  var FLOW = { step: 25, milestone: 50, outcome: 10, goal: 100 };
  var path = { steps: 0, milestones: 0, outcomes: 0, goals: 0, reached: 0, results: [] };
  var DAILY_MATCH_CAP = 5;

  var MILESTONES = [
    { id: 'account', title: 'Konto erstellt', desc: 'Der erste Schritt ist gemacht.', test: function () { return true; } },
    { id: 'goal1', title: 'Erstes Ziel mit Weg', desc: 'Aus einem Wunsch ist ein konkreter Weg geworden.', test: function () { return path.goals + path.reached >= 1; } },
    { id: 'step1', title: 'Erster Schritt erledigt', desc: 'Ein Ergebnis ist festgehalten.', test: function () { return path.steps >= 1; } },
    { id: 'match1', title: 'Erstes Live-Gespräch', desc: 'Mit einer Person über dein Ziel gesprochen.', test: function (p) { return p.matches >= 1; } },
    { id: 'match5', title: '5 Live-Gespräche', desc: 'Austausch wird zur Gewohnheit.', test: function (p) { return p.matches >= 5; } },
    { id: 'topics3', title: '3 Themen', desc: 'Über drei verschiedene Themen gesprochen.', test: function (p) { return p.topics.length >= 3; } },
    { id: 'ms1', title: 'Erster Meilenstein', desc: 'Alle Schritte eines Meilensteins sind erledigt.', test: function () { return path.milestones >= 1; } },
    { id: 'steps10', title: '10 Schritte erledigt', desc: 'Zehn Ergebnisse auf deinem Weg.', test: function () { return path.steps >= 10; } },
    { id: 'reached1', title: 'Erstes Ziel erreicht', desc: 'Ein Ziel ist als erreicht markiert.', test: function () { return path.reached >= 1; } },
    { id: 'match25', title: '25 Live-Gespräche', desc: 'Du bist ein fester Teil der Community.', test: function (p) { return p.matches >= 25; } }
  ];

  var email = null, p = null;

  function key() { return 'fv-progress-' + (email || 'gast'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

  function load() {
    var def = { xp: 0, matches: 0, topics: [], days: [], streak: 0, bestStreak: 0, lastDay: null, unlocked: [], activity: [], daily: { date: null, count: 0, partners: [] } };
    try { p = Object.assign(def, JSON.parse(localStorage.getItem(key()) || '{}')); } catch (x) { p = def; }
  }
  function save() { try { localStorage.setItem(key(), JSON.stringify(p)); } catch (x) {} }

  function log(text, xp) {
    p.activity.unshift({ t: Date.now(), text: text, xp: xp || 0 });
    p.activity = p.activity.slice(0, 12);
  }

  function addXp(n) { p.xp += n; }

  function checkMilestones() {
    MILESTONES.forEach(function (m) {
      if (p.unlocked.indexOf(m.id) < 0 && m.test(p)) {
        p.unlocked.push(m.id);
        if (m.id !== 'account') log('Meilenstein: ' + m.title, 0);
      }
    });
  }

  function touchDay() {
    var d = today();
    if (p.days.indexOf(d) < 0) p.days.push(d);
    p.lastDay = d;
  }

  function flow() { return p.xp + path.steps * FLOW.step + path.milestones * FLOW.milestone + path.outcomes * FLOW.outcome + path.reached * FLOW.goal; }

  function loadServerProfile() {
    var B = window.FVB;
    if (!B) return Promise.resolve();
    return B.uid().then(function (uid) {
      if (!uid) return;
      return Promise.all([
        B.sb.from('profiles').select('xp,matches,topics,active_days').eq('id', uid).single(),
        B.sb.from('activity').select('text,xp,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(12)
      ]).then(function (r) {
        var pr = r[0].data;
        if (pr) { p.xp = pr.xp || 0; p.matches = pr.matches || 0; p.topics = pr.topics || []; }
        if (r[1].data) p.activity = r[1].data.map(function (x) { return { t: new Date(x.created_at).getTime(), text: x.text, xp: x.xp }; });
        return B.rpc('my_today').then(function (t) {
          if (t) p.daily = { date: today(), count: t.matches_today || 0, partners: (p.daily && p.daily.date === today()) ? p.daily.partners : [] };
        }).catch(function () {});
      });
    }).catch(function () {});
  }

  function loadPath() {
    var S = window.FVS;
    if (!S) return Promise.resolve();
    return Promise.all([S.list('goals'), S.list('steps'), S.list('milestones'), S.list('outcomes')]).then(function (r) {
      var goals = r[0], steps = r[1], ms = r[2], outs = r[3];
      var cur = steps.filter(function (s) { return s.status !== 'ersetzt'; });
      path.steps = steps.filter(function (s) { return s.status === 'erledigt'; }).length;
      path.goals = goals.filter(function (g) { return g.status === 'aktiv' || g.status === 'pausiert'; }).length;
      path.reached = goals.filter(function (g) { return g.status === 'erreicht'; }).length;
      path.outcomes = outs.filter(function (o) { return o.next_action || o.helpful; }).length;
      path.milestones = ms.filter(function (m) {
        var g = goals.filter(function (x) { return x.id === m.goal_id; })[0];
        if (!g || g.path_version !== m.version) return false;
        var ss = cur.filter(function (s) { return s.milestone_id === m.id; });
        return ss.length && ss.every(function (s) { return s.status === 'erledigt' || s.status === 'uebersprungen'; });
      }).length;
      path.results = steps.filter(function (s) { return s.status === 'erledigt'; }).map(function (s) { return { t: new Date(s.updated_at).getTime(), text: 'Schritt erledigt: ' + s.title, xp: FLOW.step }; });
    }).catch(function () {});
  }

  function levelFor(xp) {
    var cur = LEVELS[0];
    LEVELS.forEach(function (l) { if (xp >= l.xp) cur = l; });
    return cur;
  }

  function fmtTime(t) {
    var d = new Date(t), now = new Date();
    var same = d.toDateString() === now.toDateString();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return same ? 'Heute, ' + hm : ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '., ' + hm;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderSide() {
    var f = flow(), lv = levelFor(f), next = LEVELS[lv.n] || null;
    $('side-level').textContent = 'Level ' + lv.n + ' · ' + lv.name;
    var pct = next ? Math.round(((f - lv.xp) / (next.xp - lv.xp)) * 100) : 100;
    $('side-bar').style.width = pct + '%';
    var name = '';
    try { var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'); if (u[email]) name = u[email].name; } catch (x) {}
    $('side-name').textContent = name || email || '';
  }

  function renderProgress() {
    if (!p) return;
    var f = flow(), lv = levelFor(f), next = LEVELS[lv.n] || null;
    $('pv-level').textContent = 'Level ' + lv.n;
    $('pv-level-name').textContent = lv.name;
    $('pv-sub').textContent = lv.text;

    var track = $('lvl-track');
    track.innerHTML = LEVELS.map(function (l) {
      var cls = l.n < lv.n ? 'is-done' : l.n === lv.n ? 'is-current' : 'is-locked';
      var state = l.n < lv.n ? 'Erreicht' : l.n === lv.n ? 'Aktuell' : 'Ab ' + l.xp + ' Flow';
      return '<div class="lvl__step ' + cls + '"><span class="lvl__dot"></span><span class="lvl__name">' + l.name + '</span><span class="lvl__state">' + state + '</span></div>';
    }).join('');

    var pct = next ? Math.round(((f - lv.xp) / (next.xp - lv.xp)) * 100) : 100;
    $('pv-xp-fill').style.width = pct + '%';
    $('pv-xp-label').textContent = next ? f + ' von ' + next.xp + ' Flow bis ' + next.name : f + ' Flow · Höchstes Level';

    $('st-matches').textContent = p.matches;
    $('st-days').textContent = path.steps;
    $('st-streak').textContent = path.milestones;
    $('st-topics').textContent = path.outcomes;
    var dc = (p.daily && p.daily.date === today()) ? p.daily.count : 0;
    $('pv-daily').textContent = 'Heute: ' + dc + ' von ' + DAILY_MATCH_CAP + ' Gesprächen mit Flow';

    $('ms-list').innerHTML = MILESTONES.map(function (m) {
      var on = p.unlocked.indexOf(m.id) > -1;
      return '<li class="ms__item' + (on ? ' is-done' : '') + '"><span class="ms__mark" aria-hidden="true"></span><span class="ms__text"><span class="ms__title">' + m.title + '</span><span class="ms__desc">' + m.desc + '</span></span><span class="ms__state">' + (on ? 'Erreicht' : 'Offen') + '</span></li>';
    }).join('');

    var nextMs = MILESTONES.filter(function (m) { return p.unlocked.indexOf(m.id) < 0; })[0];
    $('pv-next').textContent = nextMs
      ? nextMs.title + ' — ' + nextMs.desc
      : 'Alle Meilensteine erreicht. Setz dir ein neues Ziel.';

    var acts = p.activity.filter(function (a) { return a.text !== 'Aktiver Tag'; }).concat(path.results).sort(function (x, y) { return y.t - x.t; });
    $('act-list').innerHTML = acts.length
      ? acts.slice(0, 6).map(function (a) {
          return '<li class="act__item"><span class="act__text">' + esc(a.text) + '</span><span class="act__meta">' + fmtTime(a.t) + (a.xp ? ' · +' + a.xp + ' Flow' : '') + '</span></li>';
        }).join('')
      : '<li class="act__item act__item--empty">Noch keine Aktivität. Erledige deinen ersten Schritt unter „Heute“.</li>';
  }

  function refresh() { checkMilestones(); save(); renderSide(); renderProgress(); }
  function refreshAll() { if (!p) return; Promise.all([loadPath(), loadServerProfile()]).then(refresh); }
  document.addEventListener('fv:match-result', function () { setTimeout(refreshAll, 400); });
  document.addEventListener('fv:route', refreshAll);

  document.addEventListener('fv:signin', function (e) { init((e.detail && e.detail.email) || null); });

  function init(mail) {
    email = mail;
    load();
    touchDay();
    if (window.FVB) window.FVB.rpc('touch_day').catch(function () {});
    refresh();
    route();
    refreshAll();
  }

  function result(detail) { try { document.dispatchEvent(new CustomEvent('fv:match-result', { detail: detail })); } catch (x) {} }

  // Wird vom Live-Match erst nach 2 Minuten echter Video-Verbindung ausgelöst.
  document.addEventListener('fv:match', function (e) {
    if (!p) return;
    var d = e.detail || {};
    if (!d.seconds || d.seconds < 120) return;
    touchDay();
    var t = today();
    if (!p.daily || p.daily.date !== t) p.daily = { date: t, count: 0, partners: [] };
    var partner = String(d.partner || 'unbekannt');

    if (p.daily.partners.indexOf(partner) > -1) {
      result({ counted: false, reason: 'Mit dieser Person hast du heute schon Flow gesammelt. Das Gespräch zählt nicht erneut.' });
      return refresh();
    }
    if (p.daily.count >= DAILY_MATCH_CAP) {
      result({ counted: false, reason: 'Tageslimit erreicht: ' + DAILY_MATCH_CAP + ' Gespräche mit Flow pro Tag. Morgen geht es weiter.' });
      return refresh();
    }

    p.daily.count += 1;
    p.daily.partners.push(partner);
    p.matches += 1;
    var gained = XP.match;
    addXp(XP.match);
    var topicName = d.topic || 'Zufall';
    log('Live-Gespräch: ' + topicName, XP.match);
    if (topicName !== 'Zufall' && p.topics.indexOf(topicName) < 0) {
      p.topics.push(topicName);
      addXp(XP.topic);
      gained += XP.topic;
      log('Neues Thema: ' + topicName, XP.topic);
    }
    result({ counted: true, xp: gained });
    refresh();
  });

  // Falls die Anmeldung schon vor dem Laden dieser Datei passiert ist (Sitzung aktiv)
  var existing = null;
  try { existing = sessionStorage.getItem('fv-signed-in'); } catch (x) {}
  if (existing) init(existing); else route();
})();
