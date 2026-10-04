/* Flow Valu – Mindmap im Vollbild: zoomen, verschieben, bearbeiten, löschen, herunterladen (PNG/SVG). */
(function () {
  'use strict';
  var N = window.FVNotes;
  if (!N) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (t) { var el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.hidden = false; setTimeout(function () { el.hidden = true; }, 3600); };
  var W = 1000, H = 680;

  var root = document.createElement('div');
  root.className = 'mmx'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Mindmap');
  root.innerHTML =
    '<div class="mmx__bar">' +
      '<div class="mmx__title" id="mmx-title"></div>' +
      '<div class="mmx__group">' +
        '<button class="mmx__ico" type="button" data-x="out" aria-label="Verkleinern">−</button>' +
        '<span class="mmx__zoom" id="mmx-zoom">100 %</span>' +
        '<button class="mmx__ico" type="button" data-x="in" aria-label="Vergrößern">+</button>' +
        '<button class="mmx__ico" type="button" data-x="fit" aria-label="Einpassen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button>' +
      '</div>' +
      '<div class="mmx__group">' +
        '<button class="btn btn--glass btn--sm" type="button" data-x="edit" id="mmx-edit">Bearbeiten</button>' +
        '<div class="mmx__menu"><button class="btn btn--glass btn--sm" type="button" data-x="dl">Herunterladen</button>' +
          '<div class="mmx__drop" id="mmx-drop" hidden><button type="button" data-x="png">Als Bild (PNG)</button><button type="button" data-x="svg">Als Vektor (SVG)</button><button type="button" data-x="pdf">Als PDF (ganze Notiz)</button></div></div>' +
        '<button class="btn btn--glass btn--sm" type="button" data-x="del">Löschen</button>' +
        '<button class="mmx__ico" type="button" data-x="close" aria-label="Schließen">×</button>' +
      '</div>' +
    '</div>' +
    '<div class="mmx__body">' +
      '<div class="mmx__stage" id="mmx-stage"><div class="mmx__canvas" id="mmx-canvas"></div><div class="mmx__hint">Ziehen zum Verschieben · Mausrad oder zwei Finger zum Zoomen</div></div>' +
      '<aside class="mmx__panel" id="mmx-panel" hidden></aside>' +
    '</div>';
  document.body.appendChild(root);

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('mmx-stage'), canvas = $('mmx-canvas'), panel = $('mmx-panel'), drop = $('mmx-drop');
  var noteId = null, mm = null, editing = false, dirty = false, focusB = null;
  var view = { s: 1, x: 0, y: 0 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clean(m) {
    return {
      center: String(m.center || '').trim().slice(0, 60) || 'Gespräch',
      branches: (m.branches || []).map(function (b) {
        return { label: String(b.label || '').trim().slice(0, 60), children: (b.children || []).map(function (c) { return String(c || '').trim().slice(0, 90); }).filter(Boolean) };
      }).filter(function (b) { return b.label || b.children.length; }).map(function (b) { b.label = b.label || 'Ohne Titel'; return b; })
    };
  }

  /* ---------- Ansicht ---------- */
  function apply() {
    canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
    $('mmx-zoom').textContent = Math.round(view.s * 100) + ' %';
  }
  function fit() {
    var r = stage.getBoundingClientRect();
    view.s = Math.max(0.2, Math.min(r.width / W, r.height / H) * 0.94);
    view.x = (r.width - W * view.s) / 2; view.y = (r.height - H * view.s) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    var r = stage.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    var ns = Math.max(0.2, Math.min(4, view.s * f));
    view.x = cx - (cx - view.x) * (ns / view.s); view.y = cy - (cy - view.y) * (ns / view.s); view.s = ns;
    apply();
  }
  function paint() {
    canvas.innerHTML = N.svg(clean(mm));
    if (focusB != null) {
      var g = canvas.querySelector('[data-b="' + focusB + '"] .mm-branch');
      if (g) g.style.stroke = '#E3A768';
    }
  }

  /* ---------- Bearbeiten ---------- */
  function renderPanel() {
    panel.innerHTML =
      '<div class="micro">Mitte</div>' +
      '<div class="mmx__row"><input class="field__input" data-e="center" maxlength="60" value="' + esc(mm.center) + '" /></div>' +
      '<div class="micro">Äste</div>' +
      mm.branches.map(function (b, i) {
        return '<div class="mmx__br' + (focusB === i ? ' is-focus' : '') + '" data-bi="' + i + '">' +
          '<div class="mmx__row"><input class="field__input" data-e="label" data-i="' + i + '" maxlength="60" value="' + esc(b.label) + '" placeholder="Name des Astes" /><button class="mmx__x" type="button" data-e="delb" data-i="' + i + '" aria-label="Ast löschen">×</button></div>' +
          (b.children || []).map(function (c, j) {
            return '<div class="mmx__row mmx__row--kid"><input class="field__input" data-e="kid" data-i="' + i + '" data-j="' + j + '" maxlength="90" value="' + esc(c) + '" placeholder="Unterpunkt" /><button class="mmx__x" type="button" data-e="delk" data-i="' + i + '" data-j="' + j + '" aria-label="Unterpunkt löschen">×</button></div>';
          }).join('') +
          ((b.children || []).length < 6 ? '<button class="mmx__add" type="button" data-e="addk" data-i="' + i + '">+ Unterpunkt</button>' : '') +
          '</div>';
      }).join('') +
      (mm.branches.length < 8 ? '<button class="mmx__add" type="button" data-e="addb">+ Ast hinzufügen</button>' : '') +
      '<div class="tx__actions"><button class="btn btn--solid btn--sm" type="button" data-e="save">Speichern<span class="btn__rule"></span></button><button class="btn btn--glass btn--sm" type="button" data-e="cancel">Abbrechen</button></div>';
  }

  panel.addEventListener('input', function (e) {
    var t = e.target, k = t.getAttribute('data-e'), i = +t.getAttribute('data-i'), j = +t.getAttribute('data-j');
    if (k === 'center') mm.center = t.value;
    if (k === 'label') mm.branches[i].label = t.value;
    if (k === 'kid') mm.branches[i].children[j] = t.value;
    dirty = true; paint();
  });
  panel.addEventListener('focusin', function (e) {
    var i = e.target.getAttribute('data-i');
    var nb = e.target.getAttribute('data-e') === 'center' ? 'c' : (i != null ? +i : null);
    if (nb === focusB) return;
    focusB = nb; paint();
    panel.querySelectorAll('.mmx__br').forEach(function (el) { el.classList.toggle('is-focus', +el.getAttribute('data-bi') === focusB); });
  });
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-e]'); if (!b || b.tagName === 'INPUT') return;
    var k = b.getAttribute('data-e'), i = +b.getAttribute('data-i'), j = +b.getAttribute('data-j');
    if (k === 'addb') { mm.branches.push({ label: '', children: [] }); focusB = mm.branches.length - 1; }
    if (k === 'delb') { mm.branches.splice(i, 1); focusB = null; }
    if (k === 'addk') { mm.branches[i].children = mm.branches[i].children || []; mm.branches[i].children.push(''); focusB = i; }
    if (k === 'delk') mm.branches[i].children.splice(j, 1);
    if (k === 'save') return save();
    if (k === 'cancel') return cancelEdit();
    dirty = true; renderPanel(); paint();
    if (k === 'addb' || k === 'addk') {
      var inputs = panel.querySelectorAll(k === 'addb' ? '[data-e="label"]' : '[data-e="kid"][data-i="' + i + '"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  });

  canvas.addEventListener('click', function (e) {
    if (!editing || moved) return;
    var g = e.target.closest('[data-b]'); if (!g) return;
    var v = g.getAttribute('data-b');
    var inp = v === 'c' ? panel.querySelector('[data-e="center"]') : panel.querySelector('[data-e="label"][data-i="' + v + '"]');
    if (inp) { inp.focus(); inp.select(); }
  });

  function setEdit(on) {
    editing = on;
    root.classList.toggle('is-edit', on);
    panel.hidden = !on;
    $('mmx-edit').hidden = on;
    if (on) renderPanel();
    focusB = null; paint();
    requestAnimationFrame(fit);
  }
  function save() {
    var n = N.get(noteId); if (!n || !n.data) return;
    var c = clean(mm);
    if (!c.branches.length) { toast('Mindestens ein Ast wird gebraucht.'); return; }
    n.data.mindmap = c; n.data.mindmap_edited = Date.now();
    N.put(n); N.refresh(noteId);
    mm = clone(c); dirty = false;
    setEdit(false);
    toast('Mindmap gespeichert.');
  }
  function cancelEdit() {
    if (dirty && !window.confirm('Änderungen verwerfen?')) return;
    var n = N.get(noteId); mm = clone(n.data.mindmap); dirty = false; setEdit(false);
  }

  /* ---------- Verschieben & Zoomen ---------- */
  var pts = {}, last = null, pinch = null, moved = false;
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('input,button')) return;
    stage.setPointerCapture(e.pointerId);
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    moved = false;
    var ids = Object.keys(pts);
    if (ids.length === 1) { last = { x: e.clientX, y: e.clientY }; stage.classList.add('is-drag'); }
    if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s }; }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts), r = stage.getBoundingClientRect();
    if (ids.length === 2 && pinch) {
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((pinch.s * d / pinch.d) / view.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      moved = true;
    } else if (last) {
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      view.x += dx; view.y += dy; last = { x: e.clientX, y: e.clientY }; apply();
    }
  });
  function up(e) {
    delete pts[e.pointerId];
    var ids = Object.keys(pts);
    if (ids.length < 2) pinch = null;
    if (!ids.length) { last = null; stage.classList.remove('is-drag'); setTimeout(function () { moved = false; }, 0); }
    else last = { x: pts[ids[0]].x, y: pts[ids[0]].y };
  }
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('dblclick', function (e) { if (!editing) { var r = stage.getBoundingClientRect(); zoomAt(1.6, e.clientX - r.left, e.clientY - r.top); } });

  /* ---------- Herunterladen ---------- */
  var EXPORT_CSS =
    '.mm-line{stroke:rgba(242,240,237,.22);stroke-width:1;fill:none}.mm-line--main{stroke:rgba(227,167,104,.55);stroke-width:1.4}' +
    '.mm-dot{fill:rgba(242,240,237,.6)}.mm-center{fill:#E3A768}' +
    '.mm-center-text{fill:#0A0A0C;font-family:Archivo,Helvetica,Arial,sans-serif;font-weight:700;font-size:19px}' +
    '.mm-branch{fill:#141417;stroke:rgba(242,240,237,.3);stroke-width:1}' +
    '.mm-branch-text{fill:#F2F0ED;font-family:Archivo,Helvetica,Arial,sans-serif;font-weight:600;font-size:14px}' +
    '.mm-leaf{fill:rgba(242,240,237,.85);font-family:Manrope,Helvetica,Arial,sans-serif;font-size:13px}' +
    '.fv-mark{fill:#E3A768;font-family:Archivo,Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:3px}';
  function standalone(m) {
    var inner = N.svg(clean(m)).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<style>' + EXPORT_CSS + '</style>' +
      '<defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#E3A768" stop-opacity=".09" /><stop offset="1" stop-color="#08080A" stop-opacity="0" /></radialGradient></defs>' +
      '<rect width="100%" height="100%" fill="#0B0B0D" /><rect width="100%" height="100%" fill="url(#g)" />' +
      inner + '<text class="fv-mark" x="24" y="' + (H - 22) + '">FLOW VALU</text></svg>';
  }
  function fileName(n, ext) {
    var t = (n && n.data && n.data.title) || 'mindmap';
    return 'flowvalu-' + t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.' + ext;
  }
  function save_(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }
  function download(n, kind) {
    var m = n && n.data && n.data.mindmap;
    if (!m) return toast('Keine Mindmap vorhanden.');
    var svg = standalone(m);
    if (kind === 'svg') return save_(new Blob([svg], { type: 'image/svg+xml' }), fileName(n, 'svg'));
    var img = new Image(), scale = 2;
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
      var ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, W, H);
      c.toBlob(function (b) { if (b) save_(b, fileName(n, 'png')); else toast('Bild konnte nicht erstellt werden.'); }, 'image/png');
    };
    img.onerror = function () { toast('Bild konnte nicht erstellt werden – versuche SVG.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- Öffnen & Schließen ---------- */
  function open(id, edit) {
    var n = N.get(id); if (!n || !n.data || !n.data.mindmap) return;
    noteId = id; mm = clone(n.data.mindmap); dirty = false;
    $('mmx-title').textContent = n.data.title || 'Mindmap';
    root.hidden = false; document.body.classList.add('is-locked');
    setEdit(!!edit);
    requestAnimationFrame(fit);
  }
  function close() {
    if (editing && dirty && !window.confirm('Änderungen verwerfen?')) return;
    root.hidden = true; drop.hidden = true; editing = false; document.body.classList.remove('is-locked');
    if (noteId) N.refresh(noteId);
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-x]'); if (!b) { if (!e.target.closest('.mmx__menu')) drop.hidden = true; return; }
    var x = b.getAttribute('data-x'), n = N.get(noteId);
    if (x !== 'dl') drop.hidden = true;
    if (x === 'in') zoomAt(1.25);
    if (x === 'out') zoomAt(0.8);
    if (x === 'fit') fit();
    if (x === 'edit') setEdit(true);
    if (x === 'dl') drop.hidden = !drop.hidden;
    if (x === 'png' || x === 'svg') download(n, x);
    if (x === 'pdf') { root.hidden = true; document.body.classList.remove('is-locked'); var p = document.querySelector('#note-detail [data-act="pdf"]'); if (p) p.click(); }
    if (x === 'del') {
      if (!window.confirm('Mindmap löschen? Zusammenfassung, Aufgaben und Mitschrift bleiben erhalten.')) return;
      n.data.mindmap = null; N.put(n); dirty = false; editing = false; close(); toast('Mindmap gelöscht.');
    }
    if (x === 'close') close();
  });
  document.addEventListener('keydown', function (e) {
    if (root.hidden) return;
    if (e.key === 'Escape') { if (!drop.hidden) drop.hidden = true; else close(); }
    if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    if (e.key === '-') zoomAt(0.8);
    if (e.key === '0') fit();
  });
  window.addEventListener('resize', function () { if (!root.hidden) fit(); });

  window.FVMindmap = { open: open, download: download };
})();
