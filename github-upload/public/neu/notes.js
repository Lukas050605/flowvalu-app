/* Flow Valu — Notizen: automatische KI-Mindmap aus der Gesprächsmitschrift, PDF-Export. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('notes-list'), overview = $('notes-overview'), detail = $('note-detail'), toastEl = $('toast');
  if (!listEl) return;

  var openId = null, toastTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function user() { try { return sessionStorage.getItem('fv-signed-in') || 'gast'; } catch (x) { return 'gast'; } }
  function key() { return 'fv-notes-' + user(); }
  function all() { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch (x) { return []; } }
  var synced = {};
  function store(list) {
    try { localStorage.setItem(key(), JSON.stringify(list)); }
    catch (x) { toast('Speicher voll — bitte alte Notizen löschen.'); }
    push(list);
  }

  /* ---------- Server-Abgleich (nur mit Supabase) ---------- */
  function push(list) {
    var B = window.FVB; if (!B) return;
    var ids = {};
    list.forEach(function (note) {
      ids[note.id] = true;
      var json = JSON.stringify(note);
      if (synced[note.id] === json) return;
      synced[note.id] = json;
      B.sb.from('notes').upsert({ id: note.id, topic: String(note.topic || '').slice(0, 120), data: note, status: String(note.status || 'fertig').slice(0, 20) })
        .then(function (r) { if (r.error) { delete synced[note.id]; console.warn('Notiz nicht gespeichert:', r.error.message); } });
    });
    Object.keys(synced).forEach(function (id) {
      if (ids[id]) return;
      delete synced[id];
      B.sb.from('notes').delete().eq('id', id).then(function () {});
    });
  }
  function pull() {
    var B = window.FVB; if (!B) return Promise.resolve();
    return B.sb.from('notes').select('id,data,created_at').order('created_at', { ascending: false }).limit(200).then(function (r) {
      if (r.error) return;
      var remote = (r.data || []).map(function (row) { return row.data; }).filter(Boolean);
      var have = {}; remote.forEach(function (x) { have[x.id] = true; synced[x.id] = JSON.stringify(x); });
      var localOnly = all().filter(function (x) { return !have[x.id]; });
      var merged = localOnly.concat(remote).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
      try { localStorage.setItem(key(), JSON.stringify(merged)); } catch (x) {}
      if (localOnly.length) push(merged);
    });
  }
  function get(id) { return all().filter(function (n) { return n.id === id; })[0]; }
  function put(note) {
    var list = all(), i = list.findIndex(function (n) { return n.id === note.id; });
    if (i > -1) list[i] = note; else list.unshift(note);
    store(list);
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }

  function fmt(t) {
    var d = new Date(t);
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear() + ', ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* ---------- Erstellen ---------- */
  function create(meta) {
    var note = {
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      created: Date.now(),
      topic: meta.topic || '',
      me: meta.me || 'Ich',
      partner: meta.partner || 'Partner',
      transcript: meta.transcript.slice(),
      status: 'pending',
      data: null,
      source: ''
    };
    put(note);
    render();
    toast('Notiz wird erstellt … Du findest sie unter „Notizen".');
    generate(note.id);
    return note.id;
  }

  function generate(id) {
    var note = get(id);
    if (!note) return;
    note.status = 'pending';
    note.error = '';
    put(note);
    render();
    window.FVAI.mindmap(note).then(function (res) {
      var n = get(id);
      if (!n) return;
      n.data = res.data;
      n.source = res.source;
      n.error = res.error || '';
      n.status = 'done';
      put(n);
      render();
      toast(res.error ? 'KI nicht erreichbar — Notiz wurde ohne KI erstellt.' : 'Notiz mit Mindmap ist fertig.');
    });
  }

  /* ---------- Mindmap (SVG) ---------- */
  function wrap(text, max) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    });
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function svgText(x, y, lines, cls, anchor, lh) {
    var out = '<text class="' + cls + '" x="' + x + '" y="' + y + '" text-anchor="' + anchor + '">';
    var start = -((lines.length - 1) * lh) / 2;
    lines.forEach(function (l, i) { out += '<tspan x="' + x + '" dy="' + (i === 0 ? start + 4 : lh) + '">' + esc(l) + '</tspan>'; });
    return out + '</text>';
  }

  function mindmapSvg(mm) {
    var W = 1000, H = 680, cx = W / 2, cy = H / 2;
    var br = mm.branches || [], n = br.length || 1;
    var out = '';

    br.forEach(function (b, i) {
      out += '<g class="mm-g" data-b="' + i + '">';
      var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      var bx = cx + Math.cos(ang) * 230, by = cy + Math.sin(ang) * 175;
      out += '<path class="mm-line mm-line--main" d="M' + cx + ',' + cy + ' Q' + ((cx + bx) / 2) + ',' + ((cy + by) / 2 + 18) + ' ' + bx + ',' + by + '" />';

      var kids = b.children || [], k = kids.length;
      kids.forEach(function (c, j) {
        var a2 = ang + (j - (k - 1) / 2) * 0.34;
        var kx = cx + Math.cos(a2) * 395, ky = cy + Math.sin(a2) * 285;
        kx = Math.max(70, Math.min(W - 70, kx));
        ky = Math.max(30, Math.min(H - 30, ky));
        var cos = Math.cos(a2), anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
        out += '<line class="mm-line" x1="' + bx + '" y1="' + by + '" x2="' + kx + '" y2="' + ky + '" />';
        out += '<circle class="mm-dot" cx="' + kx + '" cy="' + ky + '" r="3.5" />';
        var tx = anchor === 'start' ? kx + 10 : anchor === 'end' ? kx - 10 : kx;
        var ty = anchor === 'middle' ? (Math.sin(a2) > 0 ? ky + 20 : ky - 20) : ky;
        out += svgText(tx, ty, wrap(c, 22), 'mm-leaf', anchor, 15);
      });

      var bl = wrap(b.label, 16), bw = Math.max.apply(null, bl.map(function (l) { return l.length; })) * 8.6 + 34, bh = bl.length * 17 + 18;
      out += '<rect class="mm-branch" x="' + (bx - bw / 2) + '" y="' + (by - bh / 2) + '" width="' + bw + '" height="' + bh + '" rx="' + Math.min(bh / 2, 20) + '" />';
      out += svgText(bx, by, bl, 'mm-branch-text', 'middle', 17);
      out += '</g>';
    });

    var cl = wrap(mm.center || 'Gespräch', 16), cw = Math.max.apply(null, cl.map(function (l) { return l.length; })) * 11 + 48, ch = cl.length * 22 + 30;
    out += '<g class="mm-g" data-b="c"><rect class="mm-center" x="' + (cx - cw / 2) + '" y="' + (cy - ch / 2) + '" width="' + cw + '" height="' + ch + '" rx="18" />';
    out += svgText(cx, cy, cl, 'mm-center-text', 'middle', 22) + '</g>';

    return '<svg class="mm" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mindmap">' + out + '</svg>';
  }

  /* ---------- Darstellung ---------- */
  function render() {
    var list = all();
    listEl.innerHTML = list.length ? list.map(function (n) {
      var title = n.data ? n.data.title : 'Gespräch: ' + (n.topic || 'Austausch');
      var status = n.status === 'pending' ? 'Wird erstellt …' : (n.source === 'lokal' ? 'Ohne KI erstellt' : 'Von ' + esc(n.source) + ' erstellt');
      return '<button class="ncard" type="button" data-id="' + esc(n.id) + '">' +
        '<span class="ncard__meta">' + fmt(n.created) + '</span>' +
        '<span class="ncard__title">' + esc(title) + '</span>' +
        '<span class="ncard__who">mit ' + esc(n.partner) + (n.topic ? ' · ' + esc(n.topic) : '') + '</span>' +
        '<span class="ncard__status' + (n.status === 'pending' ? ' is-pending' : '') + '">' + status + '</span>' +
        '</button>';
    }).join('') : '<div class="notes__empty">Noch keine Notizen. Starte im Live-Match die Mitschrift — nach dem Gespräch entsteht hier automatisch deine Mindmap.</div>';

    if (openId) renderDetail(openId);
  }

  function renderDetail(id) {
    var n = get(id);
    if (!n) { closeDetail(); return; }
    openId = id;
    overview.hidden = true;
    detail.hidden = false;

    var d = n.data;
    var head =
      '<div class="note__bar no-print">' +
        '<button class="link-ul note__back" type="button" data-act="back">← Alle Notizen</button>' +
        '<div class="note__actions">' +
          '<button class="btn btn--solid btn--sm" type="button" data-act="pdf"' + (d ? '' : ' disabled') + '>Als PDF speichern<span class="btn__rule"></span></button>' +
          '<button class="btn btn--glass btn--sm" type="button" data-act="regen"' + (n.status === 'pending' ? ' disabled' : '') + '>Neu erstellen</button>' +
          '<button class="btn btn--glass btn--sm note__del" type="button" data-act="del">Löschen</button>' +
        '</div>' +
      '</div>' +
      '<header class="note__head">' +
        '<div class="note__brand print-only">Flow Valu · Gesprächsnotiz</div>' +
        '<div class="eyebrow">' + fmt(n.created) + ' · mit ' + esc(n.partner) + (n.topic ? ' · ' + esc(n.topic) : '') + '</div>' +
        '<h1 class="pv__title note__title">' + esc(d ? d.title : 'Notiz wird erstellt …') + '</h1>' +
        (n.source ? '<div class="note__source">' + (n.source === 'lokal' ? 'Ohne KI erstellt' : 'Erstellt mit ' + esc(n.source)) + (n.error ? ' — ' + esc(n.error) : '') + '</div>' : '') +
      '</header>';

    if (!d) {
      detail.innerHTML = head + '<div class="glass glass--pad note__pending"><span class="call__avatar search__pulse">KI</span><p>Die Mindmap wird aus der Mitschrift erstellt …</p></div>';
      return;
    }

    var tasks = d.tasks.length
      ? '<ol class="note__tasks">' + d.tasks.map(function (t) { return '<li><span>' + esc(t.text) + '</span>' + (t.owner ? '<span class="note__owner">' + esc(t.owner) + '</span>' : '') + '</li>'; }).join('') + '</ol>'
      : '<p class="note__muted">Keine konkreten Aufgaben erkannt.</p>';

    var tx = n.transcript.map(function (l) {
      return '<div class="note__line"><span class="note__who">' + esc(l.who) + '</span><span>' + esc(l.text) + '</span></div>';
    }).join('');

    detail.innerHTML = head +
      '<section class="note__sec"><div class="micro">Zusammenfassung</div><p class="note__summary">' + esc(d.summary) + '</p></section>' +
      '<section class="note__sec"><div class="note__mmhead"><div class="micro">Mindmap</div>' +
        (d.mindmap ? '<div class="note__mmacts no-print"><button class="link-ul" type="button" data-act="mm-full">Vollbild</button><button class="link-ul" type="button" data-act="mm-edit">Bearbeiten</button><button class="link-ul" type="button" data-act="mm-png">Herunterladen</button><button class="link-ul" type="button" data-act="mm-del">Löschen</button></div>' : '') + '</div>' +
        (d.mindmap ? '<button class="note__mm" type="button" data-act="mm-full" aria-label="Mindmap im Vollbild öffnen">' + mindmapSvg(d.mindmap) + '</button>'
          : '<div class="glass glass--pad note__mmempty"><p class="note__muted">Keine Mindmap vorhanden.</p><div class="tx__actions no-print"><button class="btn btn--glass btn--sm" type="button" data-act="mm-new">Leere Mindmap anlegen</button><button class="btn btn--glass btn--sm" type="button" data-act="regen">Von der KI neu erstellen</button></div></div>') +
        '</section>' +
      '<section class="note__sec"><div class="micro">Aufgaben &amp; nächste Schritte</div>' + tasks + '</section>' +
      '<section class="note__sec note__sec--tx"><div class="micro">Komplette Mitschrift</div><div class="note__tx">' + (tx || '<p class="note__muted">Leer.</p>') + '</div></section>';
  }

  function closeDetail() {
    openId = null;
    detail.hidden = true;
    detail.innerHTML = '';
    overview.hidden = false;
  }

  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('.ncard');
    if (b) { renderDetail(b.getAttribute('data-id')); window.scrollTo(0, 0); }
  });

  detail.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act');
    if (act === 'back') closeDetail();
    if (act.indexOf('mm-') === 0 && window.FVMindmap) {
      var nn = get(openId);
      if (act === 'mm-full') window.FVMindmap.open(openId, false);
      if (act === 'mm-edit') window.FVMindmap.open(openId, true);
      if (act === 'mm-png') window.FVMindmap.download(nn, 'png');
      if (act === 'mm-new') { nn.data.mindmap = { center: (nn.data.title || 'Gespräch').slice(0, 40), branches: [{ label: 'Neuer Ast', children: [] }] }; put(nn); window.FVMindmap.open(openId, true); }
      if (act === 'mm-del') { if (!window.confirm('Nur die Mindmap löschen? Zusammenfassung, Aufgaben und Mitschrift bleiben erhalten.')) return; nn.data.mindmap = null; put(nn); renderDetail(openId); toast('Mindmap gelöscht.'); }
      return;
    }
    if (act === 'pdf') printNote();
    if (act === 'regen') generate(openId);
    if (act === 'del') {
      if (!window.confirm('Diese Notiz wirklich löschen?')) return;
      store(all().filter(function (n) { return n.id !== openId; }));
      closeDetail();
      render();
    }
  });

  function printNote() {
    var n = get(openId);
    var oldTitle = document.title;
    if (n && n.data) document.title = 'Flow Valu – ' + n.data.title;
    document.body.classList.add('print-note');
    var done = function () {
      document.body.classList.remove('print-note');
      document.title = oldTitle;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  }

  document.addEventListener('fv:route', function (e) {
    if (e.detail && e.detail.route === 'notizen') { render(); pull().then(render); }
  });
  document.addEventListener('fv:signin', function () { synced = {}; closeDetail(); render(); pull().then(render); });

  window.FVNotes = { svg: mindmapSvg, get: get, put: put, refresh: function (id) { render(); if (openId === id) renderDetail(id); }, create: create, open: function (id) { location.hash = '#notizen'; setTimeout(function () { renderDetail(id); }, 0); } };
  render();
})();
