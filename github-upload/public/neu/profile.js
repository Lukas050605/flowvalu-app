/* Flow Valu – Profil: Name, Hilfe-Themen, Datenexport, Löschanfrage, Admin-Kennzahlen (nur Server + Admin-Rolle). */
(function () {
  'use strict';
  var S = window.FVS, T = window.FVT, B = window.FVB;
  var root = document.getElementById('profil-root');
  if (!root || !S || !T) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (t) { if (window.FVUI) window.FVUI.toast(t); };
  var EV = { goal_created: 'Ziele angelegt', path_proposal_accepted: 'Wegvorschläge übernommen', step_started: 'Schritte gestartet', step_blocked: 'Blockaden gemeldet', step_result_saved: 'Ergebnisse gespeichert', help_requested: 'Hilfegesuche', outcome_saved: 'Gesprächsergebnisse' };

  function mail() { try { return sessionStorage.getItem('fv-signed-in') || ''; } catch (x) { return ''; } }

  function render() {
    S.profile().then(function (p) {
      p = p || {};
      var name = p.first_name || (function () { try { var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'); return sessionStorage.getItem('fv-me-name') || (u[mail()] && u[mail()].name) || ''; } catch (x) { return ''; } })();
      var topics = p.help_topics || [], types = p.help_types || [];
      var h = '<div class="pv pv--narrow"><div class="eyebrow">Profil</div><h1 class="pv__title">' + esc(name || 'Dein Profil') + '</h1><p class="pv__sub">' + esc(mail()) + (S.server ? '' : ' · Testmodus: Daten liegen nur in diesem Browser') + '</p>' +
        '<form class="glass glass--pad-lg settings" id="pf-form">' +
        '<label class="field"><span class="field__label">Vorname</span><input class="field__input" id="pf-name" maxlength="40" value="' + esc(name) + '" /></label>' +
        '<label class="field"><span class="field__label">Erfahrung, die du teilen kannst</span><textarea class="field__input" id="pf-exp" rows="2" maxlength="400" placeholder="z. B. 5 Jahre Vertrieb im Mittelstand, eigenes Nebengewerbe seit 2023">' + esc(p.experience || '') + '</textarea></label>' +
        '<div class="field"><span class="field__label">Themen, bei denen du helfen kannst</span><div class="topics pf__chips">' + T.TOPICS.map(function (t) { return '<label class="sug pf__chip' + (topics.indexOf(t.id) > -1 ? ' is-on' : '') + '"><input type="checkbox" name="pf-topic" value="' + t.id + '"' + (topics.indexOf(t.id) > -1 ? ' checked' : '') + ' />' + esc(t.label) + '</label>'; }).join('') + '</div></div>' +
        '<div class="field"><span class="field__label">Wie du helfen möchtest</span><div class="topics pf__chips">' + T.HELP_TYPES.map(function (t) { return '<label class="sug pf__chip' + (types.indexOf(t.id) > -1 ? ' is-on' : '') + '"><input type="checkbox" name="pf-type" value="' + t.id + '"' + (types.indexOf(t.id) > -1 ? ' checked' : '') + ' />' + esc(t.label) + '</label>'; }).join('') + '</div></div>' +
        '<p class="xp-note">Mentor-Status und Preise vergibt Flow Valu später anhand von Qualität und Vertrauen. Dieser Bereich ist in Vorbereitung.</p>' +
        '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="submit">Speichern<span class="btn__rule"></span></button></div></form>' +
        '<div class="glass glass--pad pf__data"><div class="micro">Deine Daten</div><p class="lh__p">Du kannst jederzeit alle gespeicherten Daten herunterladen oder dein Konto löschen lassen.</p>' +
        '<div class="tx__actions"><button class="btn btn--glass btn--sm" type="button" id="pf-export">Daten herunterladen</button><button class="link-ul" type="button" id="pf-delete">Konto löschen</button></div></div>' +
        '<div id="pf-del-status"></div><div id="pf-admin"></div></div>';
      root.innerHTML = h;
      bind();
      deletionStatus();
      admin();
    }).catch(function (e) { root.innerHTML = '<div class="pv"><p class="pv__sub">Profil konnte nicht geladen werden: ' + esc(e.message) + '</p></div>'; });
  }

  function bind() {
    root.querySelectorAll('.pf__chip input').forEach(function (i) { i.addEventListener('change', function () { i.parentNode.classList.toggle('is-on', i.checked); }); });
    document.getElementById('pf-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var pick = function (n) { return Array.prototype.map.call(root.querySelectorAll('input[name="' + n + '"]:checked'), function (i) { return i.value; }); };
      var name = document.getElementById('pf-name').value.trim().slice(0, 40);
      S.saveProfile({ first_name: name, experience: document.getElementById('pf-exp').value.trim().slice(0, 400), help_topics: pick('pf-topic'), help_types: pick('pf-type') }).then(function () {
        try { sessionStorage.setItem('fv-me-name', name); } catch (x) {}
        var u = null; try { u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'); if (u[mail()]) { u[mail()].name = name; localStorage.setItem('fv-demo-users', JSON.stringify(u)); } } catch (x) {}
        var sn = document.getElementById('side-name'); if (sn && name) sn.textContent = name;
        toast('Profil gespeichert.'); render();
      }).catch(function (x) { toast('Speichern fehlgeschlagen: ' + x.message); });
    });
    document.getElementById('pf-export').addEventListener('click', function () {
      S.exportAll().then(function (d) {
        var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'flowvalu-daten.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      }).catch(function (x) { toast('Export fehlgeschlagen: ' + x.message); });
    });
    document.getElementById('pf-delete').addEventListener('click', function () {
      var msg = S.server ? 'Konto wirklich löschen lassen? Die Löschung wird innerhalb von 30 Tagen durchgeführt.' : 'Alle Daten dieses Testkontos in diesem Browser löschen?';
      if (!window.confirm(msg)) return;
      S.wipe().then(function () {
        if (!S.server) {
          try { var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'); delete u[mail()]; localStorage.setItem('fv-demo-users', JSON.stringify(u)); localStorage.removeItem('fv-progress-' + mail()); } catch (x) {}
        }
        if (S.server) { toast('Löschanfrage gespeichert. Du kannst sie 30 Tage lang abbrechen.'); render(); return; }
        toast('Testkonto gelöscht.');
        var lo = document.getElementById('logout'); if (lo) lo.click();
      }).catch(function (x) { toast(x.message); });
    });
  }

  function admin() {
    var box = document.getElementById('pf-admin');
    if (!B) return;
    B.rpc('is_admin').then(function (yes) {
      if (!yes) return;
      return B.rpc('admin_stats', { p_days: 30 }).then(function (d) {
        var k = [['Mitglieder', d.users], ['Neu (30 Tage)', d.new_users], ['Aktive Ziele', d.goals_active], ['Erreichte Ziele', d.goals_reached], ['Schritte erledigt', d.steps_done], ['Blockierte Schritte', d.steps_blocked], ['Gesprächsergebnisse', d.outcomes], ['Offene Meldungen', d.reports_open]];
        var ev = Object.keys(d.events || {}).map(function (n) { return '<li><span>' + esc(EV[n] || n) + '</span><span>' + d.events[n] + '</span></li>'; }).join('');
        var bt = (d.blocked_topics || []).map(function (x) { return '<li><span>' + esc(T.topicLabel(x.topic) || 'ohne Thema') + '</span><span>' + x.n + '</span></li>'; }).join('');
        box.innerHTML = '<div class="glass glass--pad pf__admin"><div class="micro">Admin · letzte 30 Tage</div><div class="pf__kpis">' + k.map(function (x) { return '<div class="stat"><div class="stat__num">' + esc(x[1]) + '</div><div class="stat__label">' + x[0] + '</div></div>'; }).join('') + '</div>' +
          (ev ? '<div class="micro pf__sub">Ereignisse</div><ul class="xp-rules">' + ev + '</ul>' : '') +
          (bt ? '<div class="micro pf__sub">Wo Menschen hängen bleiben</div><ul class="xp-rules">' + bt + '</ul>' : '') +
          '<div class="micro pf__sub">Speicher</div><div id="pf-storage" class="lh__p">Lädt …</div></div>';
        storage();
      });
    }).catch(function () {});
  }

  var delTimer = null;
  function deletionStatus() {
    var box = document.getElementById('pf-del-status'); clearInterval(delTimer);
    if (!box || !B) return;
    B.rpc('my_deletion').then(function (d) {
      if (!d || !d.delete_at) return;
      var btn = document.getElementById('pf-delete'); if (btn) btn.hidden = true;
      var end = new Date(d.delete_at).getTime();
      box.innerHTML = '<div class="glass glass--pad pf__del"><div class="micro">Konto wird gelöscht</div><div class="pf__delcount" id="pf-delcount"></div>' +
        '<p class="lh__p">Am ' + new Date(end).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }) + ' werden dein Konto und alle Inhalte endgültig gelöscht. Bis dahin kannst du es dir anders überlegen.</p>' +
        '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="button" id="pf-undel">Löschung abbrechen<span class="btn__rule"></span></button></div></div>';
      var tick = function () {
        var ms = Math.max(0, end - Date.now()), d2 = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
        var el = document.getElementById('pf-delcount'); if (!el) return clearInterval(delTimer);
        el.innerHTML = '<span><b>' + d2 + '</b>Tage</span><span><b>' + ('0' + h).slice(-2) + '</b>Std</span><span><b>' + ('0' + m).slice(-2) + '</b>Min</span><span><b>' + ('0' + s).slice(-2) + '</b>Sek</span>';
      };
      tick(); delTimer = setInterval(tick, 1000);
      document.getElementById('pf-undel').addEventListener('click', function () {
        B.rpc('cancel_account_deletion').then(function () { toast('Löschung abgebrochen. Dein Konto bleibt bestehen.'); render(); }).catch(function (x) { toast(x.message); });
      });
    }).catch(function () {});
  }

  function storage() {
    var el = document.getElementById('pf-storage'); if (!el) return;
    B.rpc('admin_storage').then(function (s) {
      var mb = function (b) { return (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; };
      var pct = Math.min(100, Math.round(s.db_bytes / s.limit_bytes * 100));
      el.innerHTML = '<div class="stat__label">' + mb(s.db_bytes) + ' von ' + mb(s.limit_bytes) + ' belegt (' + pct + ' %)</div>' +
        '<div class="progress__track"><div class="progress__fill" style="width:' + pct + '%"></div></div>' +
        '<p class="xp-note">' + s.notes + ' Notizen (' + mb(s.notes_bytes) + ') · ' + s.steps + ' Schritte · ' + s.posts + ' Beiträge · ' + s.pending_deletions + ' Löschanfragen offen<br />' +
        'Nächstes automatisches Aufräumen: <span id="pf-nextclean"></span>' + (s.last_cleanup ? ' · zuletzt ' + new Date(s.last_cleanup).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '') + '</p>' +
        '<div class="tx__actions"><button class="btn btn--glass btn--sm" type="button" id="pf-clean">Jetzt aufräumen</button></div>';
      var nc = function () {
        var el = document.getElementById('pf-nextclean'); if (!el) return;
        var now = new Date(), t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30));
        if (t <= now) t = new Date(t.getTime() + 86400000);
        var ms = t - now; el.textContent = 'in ' + Math.floor(ms / 3600000) + ' Std ' + Math.floor(ms % 3600000 / 60000) + ' Min (' + t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr)';
      };
      nc(); setInterval(nc, 30000);
      document.getElementById('pf-clean').addEventListener('click', function () {
        B.rpc('admin_cleanup_now').then(function (r) { toast('Aufgeräumt: ' + r.rooms + ' Räume, ' + r.events + ' Ereignisse, ' + r.accounts + ' Konten.'); storage(); }).catch(function (x) { toast(x.message); });
      });
    }).catch(function () { el.textContent = 'Speicheranzeige nicht verfügbar. Bitte schema-speicher.sql in Supabase ausführen.'; });
  }

  document.addEventListener('fv:route', function (e) { if (e.detail && e.detail.route === 'profil') render(); });
})();
