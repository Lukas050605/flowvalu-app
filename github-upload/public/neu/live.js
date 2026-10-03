/* Flow Valu – Live-Hilfe: Hilfegesuch, „Ich helfe gerade“, Kontextkarte, 45-Sekunden-Annahme, Gesprächsergebnis → Weg.
   Baut auf dem bestehenden Live-Match (script.js) auf. Vermittlung über das Thema. */
(function () {
  'use strict';
  var S = window.FVS, T = window.FVT, U = window.FVUI || {};
  var $ = function (id) { return document.getElementById(id); };
  var start = $('view-start'), form = $('search-form'), input = $('search-input');
  if (!start || !S || !T || !form) return;
  var esc = U.esc || function (s) { return String(s == null ? '' : s); };
  var toast = U.toast || function () {};

  var ACCEPT_SECONDS = 45;
  var role = null, req = null, helpTopic = null, ctxIn = null, accepted = false, acceptTimer = null, countdown = null, callHad = false;

  function emitMsg(o) { return window.FVCall && window.FVCall.send(o); }
  function note(t) {
    var log = $('room-log'); if (!log) return;
    var d = document.createElement('div'); d.className = 'msg msg--note'; d.textContent = t; log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function searchFor(label) { input.value = label; if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
  function helpPref(v) { try { if (v) localStorage.setItem('fv-help-pref', JSON.stringify(v)); return JSON.parse(localStorage.getItem('fv-help-pref') || 'null'); } catch (x) { return null; } }

  /* ---------- Startpanel ---------- */
  var panel = document.createElement('div');
  panel.className = 'lh';
  panel.id = 'lh';
  start.insertBefore(panel, start.querySelector('.match__title'));

  function render() {
    Promise.all([S.list('help_requests'), S.list('outcomes')]).then(function (r) {
      var open = r[0].filter(function (q) { return ['entwurf', 'suchend'].indexOf(q.status) > -1; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      if (!req && open[0]) req = open[0];
      var outs = r[1].sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 3);
      var pref = helpPref() || { topic: T.TOPICS[0].id, help: ['mitdenken'] };
      var h = '<div class="lh__grid">';
      h += '<div class="glass glass--pad lh__card"><div class="micro">Ich brauche Hilfe</div>';
      if (req) {
        var c = req.context_card || {};
        h += '<div class="lh__ctx"><p><strong>Anliegen:</strong> ' + esc(c.anliegen || req.summary) + '</p>' + (c.blockade ? '<p><strong>Woran es hängt:</strong> ' + esc(c.blockade) + '</p>' : '') +
          '<p><strong>Gewünschte Hilfe:</strong> ' + esc(T.helpLabel(req.help_type)) + ' · ' + esc(req.duration_minutes) + ' Minuten · ' + esc(T.topicLabel(req.topic)) + '</p></div>' +
          '<p class="xp-note">Diese Karte sieht die Person, mit der du verbunden wirst. Private Ziele, Notizen und deine E-Mail bleiben bei dir.</p>' +
          '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="button" data-lh="seek">Passende Person suchen<span class="btn__rule"></span></button><button class="link-ul" type="button" data-lh="drop">Gesuch zurückziehen</button></div>';
      } else {
        h += '<p class="lh__p">Beschreibe kurz, woran du hängst. Dann suchen wir jemanden, der genau dabei helfen kann.</p><div class="tx__actions"><a class="btn btn--glass btn--sm" href="#start">Hilfegesuch anlegen</a></div>';
      }
      h += '</div>';
      h += '<div class="glass glass--pad lh__card"><div class="micro">Ich helfe gerade</div><p class="lh__p">Wähle ein Thema, bei dem du dich auskennst. Du wirst mit Menschen verbunden, die dazu Hilfe suchen, und siehst vorher ihre Anfrage.</p>' +
        '<div class="topics lh__topics">' + T.TOPICS.map(function (t) { return '<button class="sug' + (pref.topic === t.id ? ' is-on' : '') + '" type="button" data-lh-topic="' + t.id + '">' + esc(t.label) + '</button>'; }).join('') + '</div>' +
        '<div class="tx__actions"><button class="btn btn--glass btn--sm" type="button" data-lh="help">Jetzt verfügbar sein</button></div></div>';
      h += '</div>';
      if (outs.length) h += '<div class="glass glass--pad lh__outs"><div class="micro">Letzte Gesprächsergebnisse</div><ul class="act">' + outs.map(function (o) {
        return '<li class="act__item"><span class="act__text">' + esc(o.next_action || o.helpful || 'Ohne Notiz') + '</span><span class="act__meta">' + esc(T.topicLabel(o.topic)) + ' · ' + (U.fmt ? U.fmt(o.created_at) : '') + (o.to_path ? ' · in deinen Weg übernommen' : '') + '</span></li>';
      }).join('') + '</ul></div>';
      h += '<div class="micro lh__free">Oder frei suchen</div>';
      panel.innerHTML = h;
    });
  }

  panel.addEventListener('click', function (e) {
    var t = e.target.closest('[data-lh-topic]');
    if (t) { var p = helpPref() || {}; p.topic = t.getAttribute('data-lh-topic'); helpPref(p); render(); return; }
    var b = e.target.closest('[data-lh]'); if (!b) return;
    var act = b.getAttribute('data-lh');
    if (act === 'seek' && req) {
      role = 'seeker'; helpTopic = req.topic; ctxIn = null; accepted = false;
      S.update('help_requests', req.id, { status: 'suchend' }).then(function (r) { req = r; }).catch(function () {});
      S.track('help_search_started', { topic: req.topic });
      searchFor(T.topicLabel(req.topic));
    }
    if (act === 'drop' && req) {
      S.update('help_requests', req.id, { status: 'zurueckgezogen' }).then(function () { req = null; render(); toast('Gesuch zurückgezogen.'); }).catch(function (x) { toast(x.message); });
    }
    if (act === 'help') {
      var pf = helpPref() || { topic: T.TOPICS[0].id };
      role = 'helper'; helpTopic = pf.topic; ctxIn = null; accepted = false;
      S.track('helper_available', { topic: pf.topic });
      searchFor(T.topicLabel(pf.topic));
    }
  });

  /* ---------- Im Gespräch ---------- */
  function ctxCardHtml(c, who) {
    return '<div class="lh__incall"><div class="micro">' + esc(who) + '</div><p><strong>Anliegen:</strong> ' + esc(c.anliegen || '') + '</p>' + (c.blockade ? '<p><strong>Woran es hängt:</strong> ' + esc(c.blockade) + '</p>' : '') + '<p><strong>Hilfe:</strong> ' + esc(c.hilfe || '') + (c.dauer ? ' · ' + esc(c.dauer) : '') + '</p><div id="lh-accept"></div></div>';
  }
  function showCtx(c, who) {
    var host = $('p-common'); if (!host) return;
    var old = $('lh-incall-wrap'); if (old) old.remove();
    var w = document.createElement('div'); w.id = 'lh-incall-wrap'; w.innerHTML = ctxCardHtml(c, who); host.parentNode.insertBefore(w, host.nextSibling);
  }
  function clearAccept() { clearTimeout(acceptTimer); clearInterval(countdown); acceptTimer = null; countdown = null; }

  document.addEventListener('fv:call-start', function () {
    callHad = !!role; ctxIn = null; accepted = false; clearAccept();
    var old = $('lh-incall-wrap'); if (old) old.remove();
    if (role === 'seeker' && req) {
      var card = Object.assign({ topic: req.topic }, req.context_card || { anliegen: req.summary, hilfe: T.helpLabel(req.help_type), dauer: req.duration_minutes + ' Minuten' });
      var tries = 0;
      (function sendCtx() { if (emitMsg({ type: 'ctx', card: card })) { note('Deine Anfrage wurde gezeigt. Die andere Person hat ' + ACCEPT_SECONDS + ' Sekunden zum Annehmen.'); return; } if (tries++ < 20) setTimeout(sendCtx, 300); })();
      showCtx(card, 'Deine Anfrage');
    }
  });

  document.addEventListener('fv:data', function (e) {
    var d = e.detail || {};
    if (d.type === 'ctx' && d.card) {
      ctxIn = d.card;
      showCtx(d.card, 'Anfrage deines Gegenübers');
      if (role === 'helper') {
        var left = ACCEPT_SECONDS, box = $('lh-accept');
        box.innerHTML = '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="button" id="lh-yes">Annehmen (<span id="lh-sec">' + left + '</span> s)<span class="btn__rule"></span></button><button class="btn btn--glass btn--sm" type="button" id="lh-no">Passt nicht</button></div>';
        countdown = setInterval(function () { left--; var s = $('lh-sec'); if (s) s.textContent = left; }, 1000);
        acceptTimer = setTimeout(function () { decline('Zeit abgelaufen'); }, ACCEPT_SECONDS * 1000);
        $('lh-yes').addEventListener('click', function () { clearAccept(); accepted = true; emitMsg({ type: 'accept' }); box.innerHTML = '<p class="xp-note">Angenommen. Viel Erfolg im Gespräch.</p>'; S.track('help_accepted', { topic: ctxIn.topic || '' }); });
        $('lh-no').addEventListener('click', function () { decline('passt nicht'); });
      }
    }
    if (d.type === 'accept') { accepted = true; note('Die Person hat deine Anfrage angenommen.'); if (req) S.update('help_requests', req.id, { status: 'bestaetigt' }).then(function (r) { req = r; }).catch(function () {}); }
    if (d.type === 'decline') { note('Die Person kann dabei gerade nicht helfen (' + (d.reason || 'passt nicht') + '). Es wird weitergesucht …'); setTimeout(function () { var n = $('next-btn'); if (n) n.click(); }, 1800); }
  });

  function decline(reason) {
    clearAccept();
    emitMsg({ type: 'decline', reason: reason });
    S.track('help_declined', { reason: reason });
    setTimeout(function () { var n = $('next-btn'); if (n) n.click(); }, 400);
  }

  /* ---------- Gesprächsergebnis ---------- */
  var sheet = document.createElement('div');
  sheet.className = 'lh__sheet'; sheet.hidden = true; sheet.id = 'lh-sheet';
  document.body.appendChild(sheet);

  document.addEventListener('fv:call-end', function (e) {
    clearAccept();
    if (!callHad) return;
    var topic = role === 'seeker' && req ? req.topic : (ctxIn && ctxIn.topic) || helpTopic || '';
    var st = window.FVP ? window.FVP.state() : null, goal = st && st.goal;
    var canAdd = role === 'seeker' && goal && goal.status === 'aktiv';
    sheet.innerHTML = '<form class="glass glass--pad-lg lh__form" id="lh-form"><div class="micro">Gesprächsergebnis</div><h2 class="weg__ms-t">Was nimmst du mit?</h2>' +
      '<label class="field"><span class="field__label">Was war hilfreich?</span><textarea class="field__input" id="lh-helpful" rows="2" maxlength="600"></textarea></label>' +
      '<label class="field"><span class="field__label">Deine nächste Handlung</span><input class="field__input" id="lh-next" maxlength="200" placeholder="z. B. Angebotssatz bis Freitag überarbeiten" /></label>' +
      (canAdd ? '<label class="lh__check"><input type="checkbox" id="lh-add" checked /> <span>Als Schritt in „' + esc(goal.title) + '“ übernehmen</span></label>' : '') +
      '<p class="xp-note">Nur du siehst dieses Ergebnis.</p>' +
      '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="submit">Speichern<span class="btn__rule"></span></button><button class="link-ul" type="button" id="lh-skip">Ohne Ergebnis schließen</button></div></form>';
    sheet.hidden = false;
    var data = { topic: topic, role: role || 'frei' };
    $('lh-skip').addEventListener('click', function () { sheet.hidden = true; finishReq(); });
    $('lh-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var helpful = $('lh-helpful').value.trim(), next = $('lh-next').value.trim(), add = $('lh-add') && $('lh-add').checked && next;
      S.insert('outcomes', { topic: data.topic, role: data.role, helpful: helpful, next_action: next, request_id: req ? req.id : null, goal_id: add ? goal.id : null, step_id: null, status: 'bestaetigt' }).then(function (o) {
        S.track('outcome_saved', { role: data.role, to_path: !!add });
        if (add && window.FVP) return window.FVP.addStepFromOutcome(goal.id, next).then(function () { return S.update('outcomes', o.id, { to_path: true }); });
      }).then(function () { sheet.hidden = true; finishReq(); toast(add ? 'Gespeichert und als Schritt in deinen Weg übernommen.' : 'Gesprächsergebnis gespeichert.'); render(); })
        .catch(function (x) { toast('Speichern fehlgeschlagen: ' + x.message); });
    });
    callHad = false;
  });

  function finishReq() {
    if (role === 'seeker' && req && accepted) { S.update('help_requests', req.id, { status: 'erledigt' }).then(function () { req = null; render(); }).catch(function () {}); }
  }

  /* ---------- Schnittstelle ---------- */
  window.FVLive = {
    open: function (r) { req = r; role = null; location.hash = '#live'; render(); },
    prefill: function (x) {
      var g = x.goal, s = x.step;
      var tp = (g && g.topic) || (T.topicFor(s.title + ' ' + (g ? g.title : '')) || {}).id || 'idee';
      S.insert('help_requests', {
        client_key: 'step-' + s.id + '-' + s.version, goal_id: g ? g.id : null, step_id: s.id, topic: tp,
        original_text: s.title, summary: 'Unterstützung bei: ' + s.title, desired_outcome: s.criterion,
        help_type: s.support_type || 'mitdenken', format: 'video', duration_minutes: 15, language: 'de', offer_kind: 'austausch', price_limit: 0,
        context_card: { anliegen: (g ? g.title + ' – ' : '') + s.title, blockade: s.status === 'blockiert' ? s.note : '', hilfe: T.helpLabel(s.support_type || 'mitdenken'), dauer: '15 Minuten' },
        status: 'entwurf'
      }).then(function (r) { req = r; render(); }).catch(function (e) { toast(e.message); });
    }
  };

  document.addEventListener('fv:route', function (e) { if (e.detail && e.detail.route === 'live') render(); });
  document.addEventListener('fv:signin', function () { req = null; render(); });
  render();
})();
