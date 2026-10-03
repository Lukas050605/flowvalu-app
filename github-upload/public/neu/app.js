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
    var r = (location.hash || '#live').slice(1);
    if (['live', 'fortschritt', 'notizen', 'einstellungen'].indexOf(r) < 0) r = 'live';
    Array.prototype.forEach.call(views, function (v) { v.hidden = v.getAttribute('data-view') !== r; });
    Array.prototype.forEach.call(links, function (a) {
      var on = a.getAttribute('data-route') === r;
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
    { n: 1, name: 'Discipline', xp: 0, text: 'Du baust die Grundlage: dranbleiben, auch wenn es klein anfängt.' },
    { n: 2, name: 'Action', xp: 100, text: 'Du setzt um. Gespräche werden zu konkreten Schritten.' },
    { n: 3, name: 'Growth', xp: 300, text: 'Du wächst sichtbar — in Themen, Kontakten und Routine.' },
    { n: 4, name: 'Results', xp: 600, text: 'Deine Arbeit zeigt Ergebnisse, die andere sehen.' },
    { n: 5, name: 'Freedom', xp: 1000, text: 'Disziplin ist zur Gewohnheit geworden. Discipline builds freedom.' }
  ];
  var XP = { match: 20, topic: 15, day: 10 };
  var DAILY_MATCH_CAP = 5;

  var MILESTONES = [
    { id: 'account', title: 'Konto erstellt', desc: 'Der erste Schritt ist gemacht.', test: function () { return true; } },
    { id: 'match1', title: 'Erstes Live-Gespräch', desc: 'Mit einer Person über dein Ziel gesprochen.', test: function (p) { return p.matches >= 1; } },
    { id: 'match5', title: '5 Live-Gespräche', desc: 'Austausch wird zur Gewohnheit.', test: function (p) { return p.matches >= 5; } },
    { id: 'topics3', title: '3 Themen', desc: 'Über drei verschiedene Themen gesprochen.', test: function (p) { return p.topics.length >= 3; } },
    { id: 'streak3', title: '3 Tage in Folge', desc: 'Drei Tage hintereinander aktiv.', test: function (p) { return p.bestStreak >= 3; } },
    { id: 'streak7', title: '7 Tage in Folge', desc: 'Eine volle Woche Disziplin.', test: function (p) { return p.bestStreak >= 7; } },
    { id: 'level3', title: 'Level Growth erreicht', desc: '300 XP gesammelt.', test: function (p) { return p.xp >= 300; } },
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
    if (p.lastDay === d) return;
    if (p.lastDay && dayDiff(p.lastDay, d) === 1) p.streak += 1; else p.streak = 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    p.lastDay = d;
    if (p.days.indexOf(d) < 0) p.days.push(d);
    addXp(XP.day);
    log('Aktiver Tag', XP.day);
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
    var lv = levelFor(p.xp), next = LEVELS[lv.n] || null;
    $('side-level').textContent = 'Level ' + lv.n + ' · ' + lv.name;
    var pct = next ? Math.round(((p.xp - lv.xp) / (next.xp - lv.xp)) * 100) : 100;
    $('side-bar').style.width = pct + '%';
    var name = '';
    try { var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'); if (u[email]) name = u[email].name; } catch (x) {}
    $('side-name').textContent = name || email || '';
  }

  function renderProgress() {
    if (!p) return;
    var lv = levelFor(p.xp), next = LEVELS[lv.n] || null;
    $('pv-level').textContent = 'Level ' + lv.n;
    $('pv-level-name').textContent = lv.name;
    $('pv-sub').textContent = lv.text;

    var track = $('lvl-track');
    track.innerHTML = LEVELS.map(function (l) {
      var cls = l.n < lv.n ? 'is-done' : l.n === lv.n ? 'is-current' : 'is-locked';
      var state = l.n < lv.n ? 'Erreicht' : l.n === lv.n ? 'Aktuell' : 'Ab ' + l.xp + ' XP';
      return '<div class="lvl__step ' + cls + '"><span class="lvl__dot"></span><span class="lvl__name">' + l.name + '</span><span class="lvl__state">' + state + '</span></div>';
    }).join('');

    var pct = next ? Math.round(((p.xp - lv.xp) / (next.xp - lv.xp)) * 100) : 100;
    $('pv-xp-fill').style.width = pct + '%';
    $('pv-xp-label').textContent = next ? p.xp + ' / ' + next.xp + ' XP bis ' + next.name : p.xp + ' XP · Höchstes Level';

    $('st-matches').textContent = p.matches;
    $('st-days').textContent = p.days.length;
    $('st-streak').textContent = (p.lastDay && dayDiff(p.lastDay, today()) <= 1) ? p.streak : 0;
    $('st-topics').textContent = p.topics.length;
    var dc = (p.daily && p.daily.date === today()) ? p.daily.count : 0;
    $('pv-daily').textContent = 'Heute: ' + dc + ' von ' + DAILY_MATCH_CAP + ' Gesprächen mit XP';

    $('ms-list').innerHTML = MILESTONES.map(function (m) {
      var on = p.unlocked.indexOf(m.id) > -1;
      return '<li class="ms__item' + (on ? ' is-done' : '') + '"><span class="ms__mark" aria-hidden="true"></span><span class="ms__text"><span class="ms__title">' + m.title + '</span><span class="ms__desc">' + m.desc + '</span></span><span class="ms__state">' + (on ? 'Erreicht' : 'Offen') + '</span></li>';
    }).join('');

    var nextMs = MILESTONES.filter(function (m) { return p.unlocked.indexOf(m.id) < 0; })[0];
    $('pv-next').textContent = nextMs
      ? nextMs.title + ' — ' + nextMs.desc
      : 'Alle Meilensteine erreicht. Bleib dran und halte deine Serie.';

    $('act-list').innerHTML = p.activity.length
      ? p.activity.slice(0, 6).map(function (a) {
          return '<li class="act__item"><span class="act__text">' + esc(a.text) + '</span><span class="act__meta">' + fmtTime(a.t) + (a.xp ? ' · +' + a.xp + ' XP' : '') + '</span></li>';
        }).join('')
      : '<li class="act__item act__item--empty">Noch keine Aktivität. Starte dein erstes Live-Gespräch.</li>';
  }

  function refresh() { checkMilestones(); save(); renderSide(); renderProgress(); }

  document.addEventListener('fv:signin', function (e) { init((e.detail && e.detail.email) || null); });

  function init(mail) {
    email = mail;
    load();
    touchDay();
    refresh();
    route();
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
      result({ counted: false, reason: 'Mit dieser Person hast du heute schon XP gesammelt. Das Gespräch zählt nicht erneut.' });
      return refresh();
    }
    if (p.daily.count >= DAILY_MATCH_CAP) {
      result({ counted: false, reason: 'Tageslimit erreicht: ' + DAILY_MATCH_CAP + ' Gespräche mit XP pro Tag. Morgen geht es weiter.' });
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
