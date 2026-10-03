/* Flow Valu – KI denkt im Gespräch mit.
   Liest die laufende Mitschrift, aktualisiert in einstellbaren Abständen Mindmap, Zusammenfassung und nächste Schritte.
   Läuft nur, wenn beide der Mitschrift zugestimmt haben. Alles ist unter „KI-Einstellungen“ und direkt im Gespräch einstellbar. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var panel = document.querySelector('.tabpanel[data-panel="ai"]');
  if (!panel || !window.FVAI) return;

  var KEY = 'fv-copilot';
  var DEF = { on: true, every: 3, mindmap: true, summary: true, steps: true, share: false };
  function cfg() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (x) { return Object.assign({}, DEF); } }
  function setCfg(p) { var c = Object.assign(cfg(), p); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (x) {} return c; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var timer = null, busy = false, lastLen = 0, latest = null, fromPartner = false, lastAt = 0;

  /* ---------- Oberfläche im Gespräch ---------- */
  var box = document.createElement('div');
  box.className = 'cop';
  box.innerHTML =
    '<div class="cop__head"><span class="micro cop__title">KI denkt mit</span><span class="cop__state" id="cop-state"></span>' +
    '<button class="link-ul cop__gear" type="button" id="cop-gear" aria-expanded="false">Einstellen</button></div>' +
    '<div class="cop__set" id="cop-set" hidden></div>' +
    '<div class="cop__out" id="cop-out"></div>';
  panel.insertBefore(box, panel.firstChild);

  function setHtml(c, prefix) {
    return '<label class="cop__row"><input type="checkbox" data-c="on"' + (c.on ? ' checked' : '') + ' /> <span>Mitdenken während des Gesprächs</span></label>' +
      '<div class="cop__row"><span>Aktualisieren alle</span><div class="seg cop__seg">' + [1, 3, 5, 10].map(function (m) {
        return '<label class="seg__opt"><input type="radio" name="' + prefix + '-every" value="' + m + '"' + (c.every === m ? ' checked' : '') + ' /><span>' + m + ' Min</span></label>';
      }).join('') + '</div></div>' +
      '<label class="cop__row"><input type="checkbox" data-c="mindmap"' + (c.mindmap ? ' checked' : '') + ' /> <span>Live-Mindmap</span></label>' +
      '<label class="cop__row"><input type="checkbox" data-c="summary"' + (c.summary ? ' checked' : '') + ' /> <span>Kurze Zusammenfassung</span></label>' +
      '<label class="cop__row"><input type="checkbox" data-c="steps"' + (c.steps ? ' checked' : '') + ' /> <span>Vorschläge für nächste Schritte</span></label>' +
      '<label class="cop__row"><input type="checkbox" data-c="share"' + (c.share ? ' checked' : '') + ' /> <span>Ergebnis auch meinem Gesprächspartner zeigen</span></label>';
  }
  function bindSet(root, prefix) {
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute('data-c')) { var o = {}; o[t.getAttribute('data-c')] = t.checked; setCfg(o); }
      if (t.name === prefix + '-every') setCfg({ every: parseInt(t.value, 10) });
      syncForms(); schedule(); paint();
    });
  }
  var setEl = $('cop-set');
  bindSet(setEl, 'cop');
  $('cop-gear').addEventListener('click', function () { setEl.hidden = !setEl.hidden; this.setAttribute('aria-expanded', String(!setEl.hidden)); });

  // Auch auf der Seite „KI-Einstellungen“
  var pageSet = null, form = $('ai-settings');
  if (form) {
    pageSet = document.createElement('div');
    pageSet.className = 'glass glass--pad-lg cop__page';
    form.parentNode.insertBefore(pageSet, form.nextSibling);
    bindSet(pageSet, 'copp');
  }
  function syncForms() {
    var c = cfg();
    setEl.innerHTML = setHtml(c, 'cop');
    if (pageSet) pageSet.innerHTML = '<div class="micro">KI im Gespräch</div><p class="lh__p">Die KI liest die Mitschrift mit und ergänzt laufend Mindmap, Zusammenfassung und nächste Schritte. Das passiert nur, wenn beide der Mitschrift zugestimmt haben.</p>' + setHtml(c, 'copp');
  }

  function state(t) { $('cop-state').textContent = t; }

  function paint() {
    var c = cfg(), out = $('cop-out');
    if (!c.on) { state('aus'); out.innerHTML = ''; return; }
    var tx = window.FVTx;
    if (!latest) {
      state(tx && tx.active() ? (busy ? 'denkt …' : 'wartet auf genug Gesprächsstoff') : 'startet, sobald die Mitschrift läuft');
      out.innerHTML = '<p class="lh__p">' + (window.FVAI.hasKey() ? 'Sobald die Mitschrift läuft, erscheint hier alle ' + c.every + ' Minuten ein Zwischenstand.' : 'Ohne KI-Schlüssel entsteht nur eine einfache Stichwort-Übersicht. Für echtes Mitdenken trag deinen Schlüssel unter „KI-Einstellungen“ ein.') + '</p>';
      return;
    }
    var d = latest.data || {}, h = '';
    state((busy ? 'denkt … · ' : '') + 'Stand ' + new Date(lastAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + (fromPartner ? ' · von deinem Gegenüber' : '') + (latest.source ? ' · ' + latest.source : ''));
    if (c.summary && d.summary) h += '<p class="cop__sum">' + esc(d.summary) + '</p>';
    if (c.mindmap && d.mindmap && d.mindmap.branches) {
      h += '<div class="cop__map"><div class="cop__center">' + esc(d.mindmap.center || d.title || 'Gespräch') + '</div><div class="cop__branches">' +
        d.mindmap.branches.slice(0, 6).map(function (b) {
          return '<div class="cop__branch"><div class="cop__bl">' + esc(b.label) + '</div>' + (b.children || []).slice(0, 4).map(function (ch) { return '<div class="cop__leaf">' + esc(ch) + '</div>'; }).join('') + '</div>';
        }).join('') + '</div></div>';
    }
    if (c.steps && d.tasks && d.tasks.length) {
      h += '<div class="micro cop__sub">Nächste Schritte</div><ul class="cop__steps">' + d.tasks.slice(0, 5).map(function (t) {
        var txt = typeof t === 'string' ? t : t.text;
        return '<li><span>' + esc(txt) + (t.owner ? ' <em>· ' + esc(t.owner) + '</em>' : '') + '</span>' + (window.FVP && window.FVP.state().goal ? '<button class="link-ul" type="button" data-take="' + esc(txt) + '">In meinen Weg</button>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    $('cop-out').innerHTML = h || '<p class="lh__p">Alle Anzeigen sind ausgeschaltet.</p>';
  }

  $('cop-out').addEventListener('click', function (e) {
    var b = e.target.closest('[data-take]'); if (!b || !window.FVP) return;
    var g = window.FVP.state().goal; if (!g) return;
    b.disabled = true;
    window.FVP.addStepFromOutcome(g.id, b.getAttribute('data-take')).then(function () { b.textContent = 'Übernommen'; }, function () { b.disabled = false; });
  });

  /* ---------- Ablauf ---------- */
  function think(force) {
    var c = cfg(), tx = window.FVTx, C = window.FVCall;
    if (!c.on || busy || !tx || !tx.active() || !C) return;
    var lines = tx.lines();
    if (!force && lines.length - lastLen < 3) return;
    busy = true; paint();
    lastLen = lines.length;
    window.FVAI.mindmap({ topic: C.topic(), me: C.me(), partner: C.partner(), transcript: lines.slice(-200) }).then(function (res) {
      latest = res; fromPartner = false; lastAt = Date.now();
      if (cfg().share) C.send({ type: 'copilot', res: { data: res.data, source: res.source } });
    }).catch(function () {}).then(function () { busy = false; paint(); });
  }

  function schedule() {
    clearInterval(timer); timer = null;
    var c = cfg();
    if (!c.on) return;
    timer = setInterval(function () { think(false); }, c.every * 60000);
  }

  document.addEventListener('fv:data', function (e) {
    var d = e.detail || {};
    if (d.type === 'copilot' && d.res && d.res.data && cfg().on) {
      if (window.FVAI.hasKey() && latest && !fromPartner && Date.now() - lastAt < 60000) return;
      latest = d.res; fromPartner = true; lastAt = Date.now(); paint();
    }
    if (d.type === 'consent' && d.ok) setTimeout(function () { paint(); }, 300);
  });
  document.addEventListener('fv:tx-start', function () { setTimeout(function () { think(true); }, 45000); paint(); });
  document.addEventListener('fv:call-start', function () { latest = null; lastLen = 0; fromPartner = false; schedule(); paint(); });
  document.addEventListener('fv:call-end', function () { clearInterval(timer); timer = null; });

  syncForms(); paint();
})();
