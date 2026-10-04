/* Flow Valu – Moderation im Admin-Bereich: Meldungen, Beiträge, Sperren, Protokoll. Nur mit Server + Admin-Rolle. */
(function () {
  'use strict';
  var B = window.FVB;
  if (!B) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (t) { if (window.FVUI) window.FVUI.toast(t); };
  var dt = function (t) { return t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''; };
  var REASON = { belaestigung: 'Belästigung', unangemessen: 'Unangemessene Inhalte', spam: 'Spam / Werbung', minderjaehrig: 'Wirkt minderjährig', andere: 'Anderes' };
  var KIND = { frage: 'Frage', fortschritt: 'Fortschritt', erfahrung: 'Erfahrung' };
  var ACT = { 'report:erledigt': 'Meldung erledigt', 'report:abgelehnt': 'Meldung abgelehnt', 'report:offen': 'Meldung wieder geöffnet', 'post:delete': 'Beitrag gelöscht', 'post:ok': 'Beitrag freigegeben', 'post:hide': 'Beitrag ausgeblendet', 'post:show': 'Beitrag eingeblendet', unban: 'Sperre aufgehoben', cleanup: 'Aufräumen gestartet' };
  var tab = 'meldungen', filter = 'offen', root = null;

  function who(w) {
    if (!w) return '–';
    return '<span class="mod__who">' + esc(w.name) + ' <span class="mod__id">#' + esc(w.short) + '</span>' + (w.banned ? ' <span class="mod__tag mod__tag--ban">gesperrt</span>' : '') + (w.reports > 1 ? ' <span class="mod__tag">' + w.reports + '× gemeldet</span>' : '') + '</span>';
  }
  function banButtons(w) {
    if (!w) return '';
    return w.banned ? '<button class="link-ul" type="button" data-m="unban" data-u="' + w.id + '">Sperre aufheben</button>'
      : '<button class="btn btn--glass btn--sm" type="button" data-m="ban" data-u="' + w.id + '" data-n="' + esc(w.name) + '">Sperren …</button>';
  }

  function mount(container) {
    root = document.createElement('div');
    root.className = 'glass glass--pad mod';
    container.appendChild(root);
    root.addEventListener('click', onClick);
    render();
  }

  function shell(body) {
    var tabs = [['meldungen', 'Meldungen'], ['beitraege', 'Beiträge'], ['sperren', 'Sperren'], ['protokoll', 'Protokoll']];
    root.innerHTML = '<div class="micro">Moderation</div><div class="mod__tabs" role="tablist">' + tabs.map(function (t) {
      return '<button class="sug' + (tab === t[0] ? ' is-on' : '') + '" type="button" role="tab" aria-selected="' + (tab === t[0]) + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div><div class="mod__body">' + body + '</div>';
  }

  function render() {
    shell('<p class="lh__p">Lädt …</p>');
    var fail = function (e) { shell('<p class="lh__p">' + (/function|schema/i.test(e.message) ? 'Bitte zuerst <strong>schema-admin.sql</strong> in Supabase ausführen.' : esc(e.message)) + '</p>'); };
    if (tab === 'meldungen') B.rpc('admin_report_list', { p_status: filter }).then(function (list) {
      var f = '<div class="mod__filter">' + [['offen', 'Offen'], ['erledigt', 'Erledigt'], ['abgelehnt', 'Abgelehnt'], ['alle', 'Alle']].map(function (x) {
        return '<button class="link-ul' + (filter === x[0] ? ' is-on' : '') + '" type="button" data-f="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
      shell(f + (list.length ? list.map(function (r) {
        return '<article class="mod__item"><div class="mod__head"><span class="mod__tag mod__tag--' + r.status + '">' + esc(r.status) + '</span><span class="mod__meta">' + dt(r.created_at) + (r.topic ? ' · Thema: ' + esc(r.topic) : '') + '</span></div>' +
          '<p class="mod__line"><strong>' + esc(REASON[r.reason] || r.reason) + '</strong>' + (r.details ? ' — ' + esc(r.details) : '') + '</p>' +
          '<p class="mod__line">Gemeldet: ' + who(r.reported) + '</p><p class="mod__line mod__muted">Von: ' + who(r.reporter) + '</p>' +
          '<div class="tx__actions">' + (r.status === 'offen'
            ? '<button class="btn btn--solid btn--sm" type="button" data-m="resolve" data-id="' + r.id + '" data-s="erledigt">Erledigt<span class="btn__rule"></span></button><button class="btn btn--glass btn--sm" type="button" data-m="resolve" data-id="' + r.id + '" data-s="abgelehnt">Unbegründet</button>'
            : '<button class="link-ul" type="button" data-m="resolve" data-id="' + r.id + '" data-s="offen">Wieder öffnen</button>') +
          banButtons(r.reported) + '</div></article>';
      }).join('') : '<p class="lh__p">Keine Meldungen in dieser Ansicht.</p>'));
    }).catch(fail);

    if (tab === 'beitraege') B.rpc('admin_post_list').then(function (list) {
      shell('<p class="xp-note">Gemeldete und ausgeblendete Beiträge aus dem Austausch. Ab 3 Meldungen wird ein Beitrag automatisch ausgeblendet.</p>' + (list.length ? list.map(function (p) {
        return '<article class="mod__item"><div class="mod__head">' + (p.hidden ? '<span class="mod__tag mod__tag--ban">ausgeblendet</span>' : '<span class="mod__tag">sichtbar</span>') + '<span class="mod__meta">' + esc(KIND[p.kind] || p.kind) + ' · ' + dt(p.created_at) + ' · ' + p.reports + '× gemeldet</span></div>' +
          '<p class="mod__body-text">' + esc(p.body) + '</p><p class="mod__line mod__muted">Von: ' + who(p.author) + '</p>' +
          '<div class="tx__actions"><button class="btn btn--glass btn--sm" type="button" data-m="postok" data-id="' + p.id + '">In Ordnung, freigeben</button>' +
          (p.hidden ? '' : '<button class="btn btn--glass btn--sm" type="button" data-m="posthide" data-id="' + p.id + '">Ausblenden</button>') +
          '<button class="link-ul" type="button" data-m="postdel" data-id="' + p.id + '">Löschen</button>' + banButtons(p.author) + '</div></article>';
      }).join('') : '<p class="lh__p">Keine gemeldeten Beiträge.</p>'));
    }).catch(fail);

    if (tab === 'sperren') B.rpc('admin_ban_list').then(function (list) {
      shell('<p class="xp-note">Gesperrte Personen können nicht mehr ins Live-Match und nichts im Austausch schreiben. Ihre Ziele und Notizen bleiben erhalten.</p>' + (list.length ? list.map(function (b) {
        return '<article class="mod__item"><p class="mod__line">' + who(b.who) + '</p><p class="mod__line mod__muted">' + (b.until ? 'Bis ' + dt(b.until) : 'Dauerhaft') + ' · seit ' + dt(b.created_at) + (b.reason ? ' · ' + esc(b.reason) : '') + '</p>' +
          '<div class="tx__actions"><button class="link-ul" type="button" data-m="unban" data-u="' + b.who.id + '">Sperre aufheben</button></div></article>';
      }).join('') : '<p class="lh__p">Niemand ist gesperrt.</p>'));
    }).catch(fail);

    if (tab === 'protokoll') B.rpc('admin_log_list').then(function (list) {
      shell(list.length ? '<ul class="act">' + list.map(function (l) {
        var a = l.action.indexOf('ban:') === 0 ? (l.action === 'ban:0' ? 'Dauerhaft gesperrt' : 'Gesperrt für ' + l.action.slice(4) + ' Tage') : (ACT[l.action] || l.action);
        return '<li class="act__item"><span class="act__text">' + esc(a) + (l.target ? ' <span class="mod__id">#' + esc(String(l.target).slice(0, 8)) + '</span>' : '') + '</span><span class="act__meta">' + esc(l.admin) + ' · ' + dt(l.created_at) + '</span></li>';
      }).join('') + '</ul>' : '<p class="lh__p">Noch keine Aktionen.</p>');
    }).catch(fail);
  }

  function run(p, msg) { return p.then(function () { if (msg) toast(msg); render(); }).catch(function (e) { toast(e.message); }); }

  function onClick(e) {
    var t = e.target.closest('[data-tab]'); if (t) { tab = t.getAttribute('data-tab'); render(); return; }
    var f = e.target.closest('[data-f]'); if (f) { filter = f.getAttribute('data-f'); render(); return; }
    var b = e.target.closest('[data-m]'); if (!b) return;
    var m = b.getAttribute('data-m'), id = b.getAttribute('data-id'), u = b.getAttribute('data-u');
    if (m === 'resolve') run(B.rpc('admin_resolve_report', { p_id: +id, p_status: b.getAttribute('data-s') }), 'Meldung aktualisiert.');
    if (m === 'postok') run(B.rpc('admin_clear_post_reports', { p_post: id }), 'Beitrag freigegeben.');
    if (m === 'posthide') run(B.rpc('admin_set_post_hidden', { p_post: id, p_hidden: true }), 'Beitrag ausgeblendet.');
    if (m === 'postdel' && window.confirm('Beitrag endgültig löschen?')) run(B.rpc('admin_delete_post', { p_post: id }), 'Beitrag gelöscht.');
    if (m === 'unban' && window.confirm('Sperre aufheben?')) run(B.rpc('admin_unban', { p_user: u }), 'Sperre aufgehoben.');
    if (m === 'ban') banForm(b, u, b.getAttribute('data-n'));
    if (m === 'ban-ok') {
      var form = b.closest('.mod__ban'), days = +form.querySelector('input[name="days"]:checked').value, reason = form.querySelector('.field__input').value.trim();
      run(B.rpc('admin_ban', { p_user: u, p_days: days, p_reason: reason }), days ? 'Gesperrt für ' + days + ' Tage.' : 'Dauerhaft gesperrt.');
    }
    if (m === 'ban-x') b.closest('.mod__ban').remove();
  }

  function banForm(btn, u, name) {
    var item = btn.closest('.mod__item'); if (item.querySelector('.mod__ban')) return;
    var d = document.createElement('div'); d.className = 'mod__ban';
    d.innerHTML = '<div class="micro">' + esc(name || 'Person') + ' sperren</div><div class="seg">' + [[1, '1 Tag'], [7, '7 Tage'], [30, '30 Tage'], [0, 'Dauerhaft']].map(function (x, i) {
      return '<label class="seg__opt"><input type="radio" name="days" value="' + x[0] + '"' + (i === 1 ? ' checked' : '') + ' /><span>' + x[1] + '</span></label>';
    }).join('') + '</div><input class="field__input" maxlength="200" placeholder="Grund (nur für dich sichtbar)" />' +
      '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="button" data-m="ban-ok" data-u="' + u + '">Sperren<span class="btn__rule"></span></button><button class="link-ul" type="button" data-m="ban-x">Abbrechen</button></div>';
    item.appendChild(d);
  }

  /* ---------- Hinweis für gesperrte Personen ---------- */
  function checkBan() {
    B.rpc('my_ban').then(function (b) {
      var bar = document.getElementById('ban-bar');
      if (!b || !b.banned) { if (bar) bar.remove(); return; }
      if (!bar) { bar = document.createElement('div'); bar.id = 'ban-bar'; bar.className = 'ban-bar'; document.body.appendChild(bar); }
      bar.textContent = 'Dein Konto ist ' + (b.until ? 'bis ' + dt(b.until) : 'dauerhaft') + ' für Live-Match und Austausch gesperrt. Dein Weg und deine Notizen bleiben nutzbar. Fragen: siehe Impressum.';
    }).catch(function () {});
  }
  document.addEventListener('fv:signin', checkBan);

  window.FVAdmin = { mount: mount };
})();
