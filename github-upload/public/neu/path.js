/* Flow Valu – Persönlicher Weg: Einstieg (Ziel / Blockade), Heute, Mein Weg.
   Ziele → versionierte Wege → Meilensteine → Schritte mit Status, Ergebnis und Verlauf. */
(function () {
  'use strict';

  var S = window.FVS, T = window.FVT;
  var $ = function (id) { return document.getElementById(id); };
  var vToday = $('heute-root'), vWeg = $('weg-root'), vStart = $('start-root'), toastEl = $('toast');
  if (!vToday || !S || !T) return;

  /* ---------- Hilfen ---------- */
  var toastTimer = null;
  function toast(t) { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4200); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(t) { var d = new Date(t); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear(); }
  function fail(e) {
    if (e && e.code === 'VERSION_CONFLICT') { toast(e.message); load().then(renderAll); return; }
    toast('Das hat nicht geklappt: ' + ((e && e.message) || 'Unbekannter Fehler'));
  }
  window.FVUI = { toast: toast, esc: esc, fmt: fmt };

  var STATUS = {
    offen: 'Offen', in_arbeit: 'In Arbeit', blockiert: 'Blockiert', erledigt: 'Erledigt', uebersprungen: 'Begründet übersprungen', ersetzt: 'Ersetzt'
  };
  var NEXT = {
    offen: ['in_arbeit', 'blockiert', 'erledigt', 'uebersprungen'],
    in_arbeit: ['offen', 'blockiert', 'erledigt', 'uebersprungen'],
    blockiert: ['in_arbeit', 'offen', 'erledigt', 'uebersprungen'],
    erledigt: ['in_arbeit'],
    uebersprungen: ['offen'],
    ersetzt: []
  };
  var GOAL_STATUS = { entwurf: 'Entwurf', aktiv: 'Aktiv', pausiert: 'Pausiert', erreicht: 'Erreicht', archiviert: 'Archiviert' };

  /* ---------- Zustand ---------- */
  var st = { goals: [], goal: null, milestones: [], steps: [], requests: [], outcomes: [], open: null, busy: false };
  function prefGoal(id) { try { if (id) localStorage.setItem('fv-current-goal', id); return localStorage.getItem('fv-current-goal'); } catch (x) { return null; } }

  function load() {
    return Promise.all([S.list('goals'), S.list('help_requests'), S.list('outcomes')]).then(function (r) {
      st.goals = r[0].filter(function (g) { return g.status !== 'archiviert'; });
      st.requests = r[1].filter(function (q) { return ['entwurf', 'suchend', 'reserviert', 'bestaetigt'].indexOf(q.status) > -1; });
      st.outcomes = r[2];
      var pref = prefGoal();
      st.goal = st.goals.filter(function (g) { return g.id === pref; })[0] || st.goals.filter(function (g) { return g.status === 'aktiv'; })[0] || st.goals[0] || null;
      if (!st.goal) { st.milestones = []; st.steps = []; return; }
      return Promise.all([S.list('milestones', { goal_id: st.goal.id }, 'order_no'), S.list('steps', { goal_id: st.goal.id }, 'order_no')]).then(function (x) {
        st.milestones = x[0]; st.steps = x[1];
      });
    });
  }

  function current() {
    var v = st.goal ? st.goal.path_version : 0;
    return {
      ms: st.milestones.filter(function (m) { return m.version === v; }).sort(function (a, b) { return a.order_no - b.order_no; }),
      steps: st.steps.filter(function (s) { return s.version === v; }),
      older: st.steps.filter(function (s) { return s.version !== v && (s.status === 'erledigt' || s.status === 'uebersprungen'); })
    };
  }
  function stepsOf(m) { return st.steps.filter(function (s) { return s.milestone_id === m.id; }).sort(function (a, b) { return a.order_no - b.order_no; }); }
  function byId(id) { return st.steps.filter(function (s) { return s.id === id; })[0]; }
  function isDone(s) { return s && (s.status === 'erledigt' || s.status === 'uebersprungen'); }
  function blockers(s) { return (s.requires || []).map(byId).filter(function (r) { return r && !isDone(r); }); }

  function nextActions() {
    var c = current(), list = [];
    c.ms.forEach(function (m) { stepsOf(m).forEach(function (s) { list.push(s); }); });
    var active = list.filter(function (s) { return s.status === 'in_arbeit' || s.status === 'blockiert'; });
    var ready = list.filter(function (s) { return s.status === 'offen' && !blockers(s).length; });
    return active.concat(ready).slice(0, 2);
  }

  /* ---------- Schreiboperationen ---------- */
  function insertProposal(goal, proposal, version) {
    var chain = S.insert('path_versions', { goal_id: goal.id, version: version, origin: proposal.source, template_id: proposal.template_id || '', note: proposal.note || '' });
    proposal.milestones.forEach(function (m, i) {
      chain = chain.then(function () {
        return S.insert('milestones', { goal_id: goal.id, version: version, title: m.title, order_no: i + 1 });
      }).then(function (ms) {
        var ids = [], inner = Promise.resolve();
        m.steps.forEach(function (s, j) {
          inner = inner.then(function () {
            var carried = proposal.carry && proposal.carry[s.title];
            return S.insert('steps', {
              goal_id: goal.id, milestone_id: ms.id, version: version, order_no: j + 1,
              title: s.title, action: s.action, reason: s.reason,
              min_minutes: s.min_minutes, max_minutes: s.max_minutes, criterion: s.criterion,
              support_type: s.support_type || null,
              requires: (s.requires || []).map(function (k) { return ids[k]; }).filter(Boolean),
              status: carried ? carried.status : 'offen', result: carried ? carried.result : '', note: carried ? (carried.note || '') : '',
              history: [{ at: new Date().toISOString(), status: carried ? carried.status : 'offen', by: carried ? 'übernommen aus früherer Version' : 'neu' }],
              origin: proposal.source
            }).then(function (row) { ids[j] = row.id; });
          });
        });
        return inner;
      });
    });
    return chain;
  }

  function createGoal(draft, proposal) {
    if (st.busy) return Promise.resolve();
    st.busy = true;
    return S.insert('goals', {
      client_key: draft.key, title: draft.title, original_text: draft.text, situation: draft.situation,
      desired_result: draft.result, success_criterion: draft.result, timeframe: draft.timeframe,
      hours_per_week: draft.hours, summary: draft.summary, status: 'aktiv', path_version: 1, topic: draft.topic || ''
    }).then(function (goal) {
      var already = st.steps.some(function (s) { return s.goal_id === goal.id; });
      return (already ? Promise.resolve() : insertProposal(goal, proposal, 1)).then(function () {
        S.track('goal_created', { topic: draft.topic || '', source: proposal.source });
        S.track('path_proposal_accepted', { version: 1, source: proposal.source });
        prefGoal(goal.id);
        clearDraft();
      });
    }).then(load).then(function () { st.busy = false; location.hash = '#heute'; renderAll(); toast('Dein Weg ist gespeichert.'); })
      .catch(function (e) { st.busy = false; fail(e); });
  }

  function reviseGoal(proposal) {
    var g = st.goal, c = current(), v = g.path_version + 1;
    proposal.carry = {};
    c.steps.forEach(function (s) { if (isDone(s)) proposal.carry[s.title] = { status: s.status, result: s.result, note: s.note }; });
    var chain = insertProposal(g, proposal, v);
    c.steps.forEach(function (s) {
      if (!isDone(s)) chain = chain.then(function () {
        return S.update('steps', s.id, { status: 'ersetzt', history: (s.history || []).concat([{ at: new Date().toISOString(), status: 'ersetzt', by: 'Version ' + v }]) });
      });
    });
    return chain.then(function () { return S.update('goals', g.id, { path_version: v }, g.version); })
      .then(function () { S.track('path_proposal_accepted', { version: v, source: proposal.source }); return load(); })
      .then(function () { renderAll(); toast('Neue Version ' + v + ' deines Weges gespeichert. Erledigte Schritte bleiben erhalten.'); })
      .catch(fail);
  }

  function setStatus(step, status, fields) {
    if (NEXT[step.status].indexOf(status) < 0) { toast('Dieser Statuswechsel ist nicht möglich.'); return Promise.resolve(); }
    var patch = Object.assign({ status: status }, fields || {});
    patch.history = (step.history || []).concat([{ at: new Date().toISOString(), status: status, by: 'du', note: (fields && (fields.note || fields.skip_reason)) || '' }]);
    return S.update('steps', step.id, patch, step.version).then(function () {
      var ev = { in_arbeit: 'step_started', blockiert: 'step_blocked', erledigt: 'step_result_saved' }[status];
      if (ev) S.track(ev, { support: step.support_type || '' });
      return load();
    }).then(renderAll).catch(fail);
  }

  function shrink(step, opt) {
    return S.insert('steps', {
      goal_id: step.goal_id, milestone_id: step.milestone_id, version: step.version, order_no: step.order_no - 0.5,
      title: opt.title, action: opt.action, reason: 'Kleinerer Einstieg für „' + step.title + '".',
      min_minutes: opt.min, max_minutes: opt.max, criterion: opt.criterion, support_type: null, requires: [],
      status: 'offen', result: '', note: '', parent_step_id: step.id, origin: 'verkleinert',
      history: [{ at: new Date().toISOString(), status: 'offen', by: 'verkleinert' }]
    }).then(load).then(function () { renderAll(); toast('Kleinerer Schritt angelegt. Der ursprüngliche Schritt bleibt offen.'); }).catch(fail);
  }

  function setGoalStatus(status) {
    var g = st.goal;
    return S.update('goals', g.id, { status: status }, g.version).then(load).then(renderAll).catch(fail);
  }

  /* ---------- Vorschläge (Vorlage oder KI) ---------- */
  var SUPPORT = T.HELP_TYPES.map(function (h) { return h.id; });
  function validProposal(p) {
    if (!p || p.schema_version !== '1' || !Array.isArray(p.milestones) || !p.milestones.length || p.milestones.length > 5) return null;
    var ok = true;
    var ms = p.milestones.map(function (m) {
      if (!m || typeof m.title !== 'string' || !Array.isArray(m.steps) || !m.steps.length || m.steps.length > 6) { ok = false; return null; }
      return {
        title: m.title.slice(0, 80),
        steps: m.steps.map(function (s, j) {
          var mn = parseInt(s.estimated_minutes_min, 10), mx = parseInt(s.estimated_minutes_max, 10);
          if (typeof s.title !== 'string' || typeof s.action !== 'string' || typeof s.completion_criterion !== 'string' || !(mn >= 5 && mx <= 240 && mn <= mx)) ok = false;
          var sup = SUPPORT.indexOf(s.support_type) > -1 ? s.support_type : null;
          var req = (Array.isArray(s.requires) ? s.requires : []).filter(function (k) { return Number.isInteger(k) && k >= 0 && k < j; });
          return { title: String(s.title).slice(0, 80), action: String(s.action).slice(0, 300), reason: String(s.reason || '').slice(0, 200), min_minutes: mn, max_minutes: mx, criterion: String(s.completion_criterion).slice(0, 200), support_type: sup, requires: req };
        })
      };
    });
    return ok ? { source: 'ki', template_id: '', milestones: ms, assumptions: (p.assumptions || []).slice(0, 4).map(String) } : null;
  }

  function propose(draft) {
    var tpl = T.templateFor(draft.text + ' ' + draft.result);
    var base = { source: 'vorlage', template_id: tpl.id, title: tpl.title, milestones: JSON.parse(JSON.stringify(tpl.milestones)), assumptions: [] };
    if (!window.FVAI || !window.FVAI.hasKey() || !window.FVAI.path) return Promise.resolve(base);
    return window.FVAI.path({ summary: draft.summary, result: draft.result, situation: draft.situation, timeframe: draft.timeframe, hours: draft.hours, template: tpl })
      .then(function (raw) {
        var v = validProposal(raw);
        if (!v) { base.note = 'Der KI-Vorschlag war unvollständig – es wird die geprüfte Vorlage verwendet.'; return base; }
        v.template_id = tpl.id; v.title = tpl.title;
        return v;
      })
      .catch(function () { base.note = 'Die KI ist gerade nicht erreichbar – es wird die geprüfte Vorlage verwendet.'; return base; });
  }

  /* ---------- Einstieg ---------- */
  function draft() { try { return JSON.parse(sessionStorage.getItem('fv-draft') || 'null'); } catch (x) { return null; } }
  function saveDraft(d) { try { sessionStorage.setItem('fv-draft', JSON.stringify(d)); } catch (x) {} }
  function clearDraft() { try { sessionStorage.removeItem('fv-draft'); } catch (x) {} }
  var CHIPS = ['Angebot formulieren', 'Erste Zielgruppe finden', 'Kundengespräch vorbereiten', 'Preise verständlich darstellen', 'Eine Idee durchdenken'];
  var proposalCache = null;

  function renderStart() {
    var d = draft() || { key: S.uuid(), step: 0, mode: '', text: '' };
    var h = '';
    if (d.step === 0) {
      h = '<div class="eyebrow">Neues Anliegen</div><h1 class="pv__title">Wobei möchtest du heute weiterkommen?</h1>' +
        '<div class="glass glass--pad-lg onb">' +
        '<label class="field"><span class="field__label">In deinen Worten</span><textarea class="field__input onb__text" id="onb-text" rows="3" maxlength="800" placeholder="z. B. Ich möchte nebenbei Webdesign anbieten, weiß aber nicht, wie ich mein Angebot beschreibe.">' + esc(d.text) + '</textarea></label>' +
        '<div class="topics onb__chips">' + CHIPS.map(function (c) { return '<button class="sug" type="button" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' +
        '<div class="onb__choice">' +
        '<button class="onb__opt" type="button" data-act="mode-goal"><span class="onb__opt-t">Ich möchte ein Ziel erreichen.</span><span class="onb__opt-d">Du bekommst einen persönlichen Weg mit nächsten Schritten.</span></button>' +
        '<button class="onb__opt" type="button" data-act="mode-block"><span class="onb__opt-t">Ich stecke gerade fest.</span><span class="onb__opt-d">Wir klären kurz die Blockade und suchen passende Hilfe.</span></button>' +
        '</div><p class="gate__error" id="onb-err" hidden></p></div>';
    } else if (d.mode === 'goal' && d.step === 1) {
      h = head('Ziel', 1, 3) +
        q('result', 'Was soll am Ende konkret anders sein?', d.result, 'z. B. Ich habe ein Angebot, das ich drei Personen zeigen kann.') +
        q('situation', 'Wo stehst du gerade?', d.situation, 'z. B. Ich habe eine grobe Idee, aber noch nichts aufgeschrieben.') +
        seg('timeframe', 'Bis wann ungefähr?', ['In 4 Wochen', 'In 3 Monaten', 'In 6 Monaten', 'Offen'], d.timeframe || 'In 3 Monaten') +
        seg('hours', 'Wie viel Zeit hast du pro Woche?', ['1–2 Stunden', '3–5 Stunden', 'Mehr als 5 Stunden'], d.hours || '1–2 Stunden') +
        nav('Zusammenfassung ansehen');
    } else if (d.mode === 'block' && d.step === 1) {
      h = head('Blockade', 1, 2) +
        q('work', 'Woran arbeitest du?', d.work || d.text, 'z. B. An meinem ersten Angebot als Fotografin.') +
        q('blocker', 'Was hält dich gerade auf?', d.blocker, 'z. B. Ich weiß nicht, ob die Zielgruppe den Nutzen versteht.') +
        '<div class="field"><span class="field__label">Welche Hilfe wünschst du dir?</span><div class="seg">' + T.HELP_TYPES.map(function (t) {
          return '<label class="seg__opt"><input type="radio" name="help" value="' + t.id + '"' + ((d.help || 'mitdenken') === t.id ? ' checked' : '') + ' /><span>' + esc(t.label) + '</span></label>';
        }).join('') + '</div></div>' +
        seg('format', 'Schreiben oder sprechen?', ['Sprechen (Audio)', 'Sprechen (Video)', 'Schreiben'], d.format || 'Sprechen (Audio)') +
        seg('duration', 'Wie viel Zeit hast du ungefähr?', ['15 Minuten', '30 Minuten'], d.duration || '15 Minuten') +
        nav('Zusammenfassung ansehen');
    } else if (d.step === 2) {
      var sum = d.summary || (d.mode === 'goal'
        ? 'Du möchtest erreichen: ' + d.result + '. Aktuell stehst du hier: ' + d.situation + '. Hilfe brauchst du vor allem bei: ' + d.text + '.'
        : 'Du arbeitest an: ' + d.work + '. Dich hält gerade auf: ' + d.blocker + '. Du wünschst dir: ' + T.helpLabel(d.help) + '.');
      h = head(d.mode === 'goal' ? 'Ziel' : 'Blockade', 2, d.mode === 'goal' ? 3 : 2) +
        '<p class="pv__sub">Stimmt das so? Du kannst den Text direkt korrigieren. Deine ursprünglichen Worte bleiben zusätzlich gespeichert.</p>' +
        '<label class="field"><span class="field__label">Zusammenfassung</span><textarea class="field__input" id="onb-summary" rows="4" maxlength="900">' + esc(sum) + '</textarea></label>' +
        (d.mode === 'goal'
          ? '<label class="field"><span class="field__label">Titel deines Ziels</span><input class="field__input" id="onb-title" maxlength="80" value="' + esc(d.title || d.result.slice(0, 80)) + '" /></label>' + nav('Weg vorschlagen')
          : '<div class="glass glass--pad ctx"><div class="micro">Das sieht dein Gesprächspartner</div><p class="ctx__line"><strong>Anliegen:</strong> ' + esc(d.work) + '</p><p class="ctx__line"><strong>Woran es hängt:</strong> ' + esc(d.blocker) + '</p><p class="ctx__line"><strong>Gewünschte Hilfe:</strong> ' + esc(T.helpLabel(d.help)) + ' · ' + esc(d.duration) + '</p><p class="xp-note">Deine privaten Ziele, Notizen und deine E-Mail werden nicht geteilt.</p></div>' + nav('Passende Hilfe finden'));
    } else if (d.mode === 'goal' && d.step === 3) {
      h = head('Ziel', 3, 3) + '<div id="onb-proposal" class="onb__proposal"><p class="pv__sub">Weg wird vorbereitet …</p></div>';
    }
    vStart.innerHTML = '<div class="pv pv--narrow">' + h + '</div>';
    if (d.mode === 'goal' && d.step === 3) showProposal(d);

    function head(kind, n, of) { return '<div class="eyebrow">' + kind + ' · Schritt ' + n + ' von ' + of + '</div><h1 class="pv__title">' + (n === 2 && kind === 'Ziel' || n === 2 && kind === 'Blockade' ? 'Habe ich dich richtig verstanden?' : n === 3 ? 'Dein vorgeschlagener Weg' : kind === 'Ziel' ? 'Erzähl kurz mehr' : 'Woran hängt es?') + '</h1>'; }
    function q(id, label, val, ph) { return '<label class="field"><span class="field__label">' + label + '</span><textarea class="field__input" data-f="' + id + '" rows="2" maxlength="400" placeholder="' + esc(ph) + '">' + esc(val || '') + '</textarea></label>'; }
    function seg(id, label, opts, val) { return '<div class="field"><span class="field__label">' + label + '</span><div class="seg">' + opts.map(function (o) { return '<label class="seg__opt"><input type="radio" name="' + id + '" value="' + esc(o) + '"' + (o === val ? ' checked' : '') + ' /><span>' + esc(o) + '</span></label>'; }).join('') + '</div></div>'; }
    function nav(next) { return '<p class="gate__error" id="onb-err" hidden></p><div class="tx__actions onb__nav"><button class="btn btn--glass btn--sm" type="button" data-act="back">Zurück</button><button class="btn btn--solid btn--sm" type="button" data-act="next">' + next + '<span class="btn__rule"></span></button><button class="link-ul onb__discard" type="button" data-act="discard">Entwurf verwerfen</button></div>'; }
  }

  function showProposal(d) {
    var box = $('onb-proposal');
    var p = proposalCache && proposalCache.key === d.key ? Promise.resolve(proposalCache.p) : propose(d).then(function (p) { proposalCache = { key: d.key, p: p }; return p; });
    p.then(function (prop) {
      box.innerHTML = '<p class="pv__sub">' + (prop.source === 'ki' ? 'Die KI hat die geprüfte Vorlage „' + esc(prop.title) + '" an deine Angaben angepasst.' : 'Grundlage ist die geprüfte Vorlage „' + esc(prop.title) + '".') + ' Du kannst einzelne Schritte später ändern, überspringen oder verkleinern.</p>' +
        (prop.note ? '<p class="xp-note">' + esc(prop.note) + '</p>' : '') +
        prop.milestones.map(function (m, i) {
          return '<div class="glass glass--pad prop__ms"><div class="micro">Meilenstein ' + (i + 1) + '</div><div class="prop__title">' + esc(m.title) + '</div><ol class="prop__steps">' +
            m.steps.map(function (s) { return '<li><span>' + esc(s.title) + '</span><span class="prop__min">' + s.min_minutes + '–' + s.max_minutes + ' Min</span></li>'; }).join('') + '</ol></div>';
        }).join('') +
        (prop.assumptions && prop.assumptions.length ? '<p class="xp-note">Annahmen: ' + prop.assumptions.map(esc).join(' · ') + '</p>' : '') +
        '<div class="tx__actions onb__nav"><button class="btn btn--glass btn--sm" type="button" data-act="back">Zurück</button><button class="btn btn--solid btn--sm" type="button" data-act="accept">Diesen Weg übernehmen<span class="btn__rule"></span></button></div>';
    });
  }

  function collect(d) {
    vStart.querySelectorAll('[data-f]').forEach(function (el) { d[el.getAttribute('data-f')] = el.value.trim(); });
    vStart.querySelectorAll('input[type="radio"]:checked').forEach(function (el) { d[el.name] = el.value; });
    var s = $('onb-summary'); if (s) d.summary = s.value.trim();
    var t = $('onb-title'); if (t) d.title = t.value.trim();
    var tx = $('onb-text'); if (tx) d.text = tx.value.trim();
    return d;
  }
  function onbErr(t) { var e = $('onb-err'); if (e) { e.textContent = t; e.hidden = false; } }

  vStart.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (chip) { var ta = $('onb-text'); ta.value = (ta.value ? ta.value + ' ' : '') + chip.getAttribute('data-chip'); ta.focus(); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    var d = collect(draft() || { key: S.uuid(), step: 0, text: '' });
    if (act === 'mode-goal' || act === 'mode-block') {
      if (!d.text) return onbErr('Beschreibe kurz, worum es geht.');
      d.mode = act === 'mode-goal' ? 'goal' : 'block'; d.step = 1; d.summary = '';
      d.topic = (T.topicFor(d.text) || {}).id || '';
    } else if (act === 'back') { d.step = Math.max(0, d.step - 1); if (d.step < 2) d.summary = ''; }
    else if (act === 'discard') { clearDraft(); proposalCache = null; renderStart(); return; }
    else if (act === 'next') {
      if (d.step === 1 && d.mode === 'goal' && (!d.result || !d.situation)) return onbErr('Bitte beide Fragen kurz beantworten.');
      if (d.step === 1 && d.mode === 'block' && (!d.work || !d.blocker)) return onbErr('Bitte beide Fragen kurz beantworten.');
      if (d.step === 2 && !d.summary) return onbErr('Die Zusammenfassung darf nicht leer sein.');
      if (d.step === 2 && d.mode === 'block') { saveDraft(d); return createRequest(d); }
      if (d.step === 2 && d.mode === 'goal' && !d.title) return onbErr('Bitte gib deinem Ziel einen Titel.');
      d.step += 1;
    } else if (act === 'accept') {
      b.disabled = true;
      if (proposalCache && proposalCache.key === d.key) createGoal(d, proposalCache.p);
      return;
    }
    saveDraft(d); renderStart(); window.scrollTo(0, 0);
  });

  function createRequest(d) {
    if (st.busy) return;
    st.busy = true;
    var fmtMap = { 'Sprechen (Audio)': 'audio', 'Sprechen (Video)': 'video', 'Schreiben': 'chat' };
    S.insert('help_requests', {
      client_key: d.key, goal_id: null, step_id: null, topic: d.topic || (T.topicFor(d.work + ' ' + d.blocker) || {}).id || 'idee',
      original_text: [d.text, d.work, d.blocker].filter(Boolean).join(' — ').slice(0, 1200), summary: d.summary,
      desired_outcome: 'Klarheit bei: ' + d.blocker.slice(0, 160), help_type: d.help || 'mitdenken',
      format: fmtMap[d.format] || 'audio', duration_minutes: d.duration === '30 Minuten' ? 30 : 15, language: 'de',
      offer_kind: 'austausch', price_limit: 0, context_card: { anliegen: d.work, blockade: d.blocker, hilfe: T.helpLabel(d.help), dauer: d.duration },
      status: 'entwurf'
    }).then(function (req) {
      st.busy = false; clearDraft(); S.track('help_requested', { source: 'blockade' });
      location.hash = '#live';
      if (window.FVLive) window.FVLive.open(req);
    }).catch(function (e) { st.busy = false; fail(e); });
  }

  /* ---------- Heute ---------- */
  function stepCard(s, compact) {
    var g = st.goal, bl = blockers(s);
    return '<article class="glass glass--pad-lg task' + (s.status === 'blockiert' ? ' is-blocked' : '') + '">' +
      '<div class="task__top"><span class="micro task__state">' + STATUS[s.status] + (bl.length ? ' · wartet auf Voraussetzung' : '') + '</span><span class="task__min">Etwa ' + s.min_minutes + ' bis ' + s.max_minutes + ' Minuten</span></div>' +
      '<h2 class="task__title">' + esc(s.title) + '</h2>' +
      '<p class="task__action">' + esc(s.action) + '</p>' +
      (compact ? '' : '<p class="task__why"><strong>Warum:</strong> ' + esc(s.reason) + '</p>') +
      '<p class="task__done"><strong>Erledigt, wenn:</strong> ' + esc(s.criterion) + '</p>' +
      (s.status === 'blockiert' && s.note ? '<p class="task__block"><strong>Blockade:</strong> ' + esc(s.note) + '</p>' : '') +
      '<div class="tx__actions">' +
      (s.status === 'offen' && !bl.length ? '<button class="btn btn--solid btn--sm" data-act="start" data-id="' + s.id + '">Diesen Schritt starten<span class="btn__rule"></span></button>' : '') +
      (s.status === 'in_arbeit' || s.status === 'blockiert' ? '<button class="btn btn--solid btn--sm" data-act="open" data-id="' + s.id + '">Ergebnis speichern<span class="btn__rule"></span></button>' : '') +
      '<button class="btn btn--glass btn--sm" data-act="help" data-id="' + s.id + '">Unterstützung finden</button>' +
      (s.status !== 'blockiert' ? '<button class="btn btn--glass btn--sm" data-act="open" data-id="' + s.id + '" data-mode="block">Ich hänge fest</button>' : '<button class="btn btn--glass btn--sm" data-act="open" data-id="' + s.id + '" data-mode="shrink">Aufgabe verkleinern</button>') +
      '</div></article>';
  }

  function renderToday() {
    var openReq = st.requests[0];
    var pendingOutcome = st.outcomes.filter(function (o) { return o.status === 'entwurf'; })[0];
    if (!st.goal && !openReq) {
      vToday.innerHTML = '<div class="pv"><div class="eyebrow">Heute</div><h1 class="pv__title">Wobei möchtest du heute weiterkommen?</h1>' +
        '<p class="pv__sub">Beschreibe dein Ziel oder woran du gerade festhängst. Daraus entsteht ein erster konkreter Schritt.</p>' +
        '<div class="tx__actions"><a class="btn btn--solid" href="#start">Anliegen beschreiben<span class="btn__rule"></span></a></div></div>';
      return;
    }
    var h = '<div class="pv"><div class="eyebrow">Heute</div>';
    if (st.goal) {
      var c = current(), done = c.steps.filter(function (s) { return s.status === 'erledigt'; }).length, total = c.steps.filter(function (s) { return s.status !== 'ersetzt'; }).length;
      h += '<h1 class="pv__title">' + esc(st.goal.title) + '</h1><p class="pv__sub">' + esc(GOAL_STATUS[st.goal.status]) + ' · ' + done + ' von ' + total + ' Schritten deines Weges erledigt</p>';
      if (st.goal.status !== 'aktiv') h += '<div class="glass glass--pad"><p>Dieses Ziel ist ' + esc(GOAL_STATUS[st.goal.status].toLowerCase()) + '.</p><div class="tx__actions">' + (st.goal.status === 'pausiert' ? '<button class="btn btn--solid btn--sm" data-act="goal-resume">Fortsetzen<span class="btn__rule"></span></button>' : '') + '<a class="btn btn--glass btn--sm" href="#start">Neues Anliegen</a></div></div>';
      else {
        var next = nextActions();
        h += '<div class="micro today__label">Deine nächste Handlung</div>' + (next.length ? next.map(function (s, i) { return stepCard(s, i > 0); }).join('') : '<div class="glass glass--pad"><p>Alle verfügbaren Schritte sind erledigt. Markiere dein Ziel als erreicht oder passe deinen Weg an.</p><div class="tx__actions"><a class="btn btn--solid btn--sm" href="#weg">Zu meinem Weg<span class="btn__rule"></span></a></div></div>');
      }
    }
    if (openReq) h += '<div class="glass glass--pad today__req"><div class="micro">Offenes Hilfegesuch</div><p class="today__req-t">' + esc(openReq.summary) + '</p><p class="xp-note">Status: ' + esc({ entwurf: 'Noch nicht gesucht', suchend: 'Suche läuft', reserviert: 'Person angefragt', bestaetigt: 'Bestätigt' }[openReq.status] || openReq.status) + '</p><div class="tx__actions"><a class="btn btn--solid btn--sm" href="#live" data-act="req" data-id="' + openReq.id + '">Weiter zur Live-Hilfe<span class="btn__rule"></span></a></div></div>';
    if (pendingOutcome) h += '<div class="glass glass--pad today__req"><div class="micro">Gesprächsergebnis wartet auf dich</div><p>' + esc(pendingOutcome.next_action || 'Ein Gesprächsergebnis ist noch nicht bestätigt.') + '</p><div class="tx__actions"><a class="btn btn--glass btn--sm" href="#austausch">Ergebnis ansehen</a></div></div>';
    if (st.goal) {
      var c2 = current();
      h += '<div class="micro today__label">Meilensteine</div><div class="today__ms">' + c2.ms.map(function (m) {
        var ss = stepsOf(m).filter(function (s) { return s.status !== 'ersetzt'; }), d2 = ss.filter(function (s) { return s.status === 'erledigt'; }).length, sk = ss.filter(function (s) { return s.status === 'uebersprungen'; }).length;
        return '<div class="stat"><div class="today__ms-t">' + esc(m.title) + '</div><div class="stat__label">' + d2 + ' von ' + ss.length + ' Schritten erledigt' + (sk ? ' · ' + sk + ' übersprungen' : '') + '</div><div class="progress__track"><div class="progress__fill" style="width:' + (ss.length ? Math.round(d2 / ss.length * 100) : 0) + '%"></div></div></div>';
      }).join('') + '</div>';
      var res = c2.steps.concat(c2.older).filter(function (s) { return s.status === 'erledigt' && s.result; }).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).slice(0, 3);
      if (res.length) h += '<div class="micro today__label">Letzte Ergebnisse</div><ul class="act glass glass--pad">' + res.map(function (s) { return '<li class="act__item"><span class="act__text">' + esc(s.result) + '</span><span class="act__meta">' + esc(s.title) + ' · ' + fmt(s.updated_at) + ' · Selbstangabe</span></li>'; }).join('') + '</ul>';
    }
    vToday.innerHTML = h + '</div>';
  }

  /* ---------- Mein Weg ---------- */
  function stepRow(s) {
    var bl = blockers(s), open = st.open === s.id;
    var h = '<li class="wstep wstep--' + s.status + (bl.length ? ' is-locked' : '') + (open ? ' is-open' : '') + '">' +
      '<button class="wstep__head" type="button" data-act="toggle" data-id="' + s.id + '" aria-expanded="' + open + '"><span class="wstep__mark" aria-hidden="true"></span><span class="wstep__title">' + esc(s.title) + (s.origin === 'verkleinert' ? ' <span class="wstep__tag">verkleinert</span>' : '') + (s.origin === 'gespraech' ? ' <span class="wstep__tag">aus Gespräch</span>' : '') + '</span><span class="wstep__state">' + (bl.length && s.status === 'offen' ? 'Gesperrt' : STATUS[s.status]) + '</span></button>';
    if (open) {
      h += '<div class="wstep__body">' +
        '<p>' + esc(s.action) + '</p>' +
        '<p class="task__why"><strong>Warum:</strong> ' + esc(s.reason) + '</p>' +
        '<p class="task__why"><strong>Zeitspanne:</strong> etwa ' + s.min_minutes + ' bis ' + s.max_minutes + ' Minuten · <strong>Erledigt, wenn:</strong> ' + esc(s.criterion) + '</p>' +
        (bl.length ? '<p class="task__block"><strong>Voraussetzung:</strong> erst „' + bl.map(function (b) { return esc(b.title); }).join('", „') + '". Mit Vorwissen kannst du den Schritt trotzdem als erledigt markieren oder begründet überspringen.</p>' : '') +
        (s.support_type ? '<p class="task__why"><strong>Sinnvolle Unterstützung:</strong> ' + esc(T.helpLabel(s.support_type)) + '</p>' : '') +
        (s.status === 'blockiert' && s.note ? '<p class="task__block"><strong>Blockade:</strong> ' + esc(s.note) + '</p>' : '') +
        (s.status === 'uebersprungen' && s.skip_reason ? '<p class="task__why"><strong>Übersprungen, weil:</strong> ' + esc(s.skip_reason) + '</p>' : '') +
        '<label class="field"><span class="field__label">Dein Ergebnis</span><textarea class="field__input" id="res-' + s.id + '" rows="2" maxlength="1200" placeholder="Was hast du erarbeitet?"' + (s.status === 'ersetzt' ? ' disabled' : '') + '>' + esc(s.result || '') + '</textarea></label>' +
        '<div class="tx__actions" id="acts-' + s.id + '">' + actions(s, bl) + '</div>' +
        '<div class="wstep__extra" id="extra-' + s.id + '"></div>' +
        '<details class="wstep__hist"><summary>Verlauf</summary><ul>' + (s.history || []).map(function (x) { return '<li>' + fmt(x.at) + ' · ' + esc(STATUS[x.status] || x.status) + ' · ' + esc(x.by || '') + (x.note ? ' — ' + esc(x.note) : '') + '</li>'; }).join('') + '</ul></details>' +
        '</div>';
    }
    return h + '</li>';
  }

  function actions(s, bl) {
    var a = [], allow = NEXT[s.status];
    if (allow.indexOf('in_arbeit') > -1 && !bl.length && s.status !== 'erledigt') a.push('<button class="btn btn--solid btn--sm" data-act="start" data-id="' + s.id + '">Starten<span class="btn__rule"></span></button>');
    if (allow.indexOf('erledigt') > -1) a.push('<button class="btn btn--' + (bl.length ? 'glass' : 'solid') + ' btn--sm" data-act="done" data-id="' + s.id + '">' + (bl.length ? 'Schon erledigt (Vorwissen)' : 'Ergebnis speichern & erledigt') + '</button>');
    if (allow.indexOf('blockiert') > -1) a.push('<button class="btn btn--glass btn--sm" data-act="block" data-id="' + s.id + '">Ich hänge fest</button>');
    if (s.status === 'blockiert') a.push('<button class="btn btn--glass btn--sm" data-act="shrink" data-id="' + s.id + '">Aufgabe verkleinern</button>');
    if (s.status !== 'ersetzt' && s.status !== 'erledigt') a.push('<button class="btn btn--glass btn--sm" data-act="help" data-id="' + s.id + '">Unterstützung finden</button>');
    if (allow.indexOf('uebersprungen') > -1) a.push('<button class="link-ul" type="button" data-act="skip" data-id="' + s.id + '">Begründet überspringen</button>');
    if (s.status === 'erledigt') a.push('<button class="btn btn--glass btn--sm" data-act="reopen" data-id="' + s.id + '">Wieder öffnen</button>');
    if (s.status === 'uebersprungen') a.push('<button class="btn btn--glass btn--sm" data-act="unskip" data-id="' + s.id + '">Doch bearbeiten</button>');
    return a.join('');
  }

  function renderWeg() {
    if (!st.goal) {
      vWeg.innerHTML = '<div class="pv"><div class="eyebrow">Mein Weg</div><h1 class="pv__title">Noch kein Ziel</h1><p class="pv__sub">Lege ein Ziel an, damit ein persönlicher Weg entsteht.</p><div class="tx__actions"><a class="btn btn--solid" href="#start">Anliegen beschreiben<span class="btn__rule"></span></a></div></div>';
      return;
    }
    var g = st.goal, c = current();
    var h = '<div class="pv"><div class="weg__goals">' + st.goals.map(function (x) { return '<button class="sug' + (x.id === g.id ? ' is-on' : '') + '" type="button" data-act="goal" data-id="' + x.id + '">' + esc(x.title) + '</button>'; }).join('') + '<a class="sug" href="#start">+ Neues Ziel</a></div>' +
      '<div class="eyebrow">Mein Weg · Version ' + g.path_version + ' · ' + esc(GOAL_STATUS[g.status]) + '</div><h1 class="pv__title">' + esc(g.title) + '</h1>' +
      '<div class="glass glass--pad weg__goal"><p><strong>Gewünschtes Ergebnis:</strong> ' + esc(g.desired_result) + '</p><p><strong>Ausgangslage:</strong> ' + esc(g.situation) + '</p><p class="xp-note">' + esc(g.timeframe || '') + (g.hours_per_week ? ' · ' + esc(g.hours_per_week) + ' pro Woche' : '') + ' · angelegt am ' + fmt(g.created_at) + '</p>' +
      '<div class="tx__actions">' +
      (g.status === 'aktiv' ? '<button class="btn btn--glass btn--sm" data-act="revise">Weg anpassen</button><button class="btn btn--glass btn--sm" data-act="goal-pause">Pausieren</button><button class="btn btn--glass btn--sm" data-act="goal-reached">Als erreicht markieren</button>' : '') +
      (g.status === 'pausiert' ? '<button class="btn btn--solid btn--sm" data-act="goal-resume">Fortsetzen<span class="btn__rule"></span></button>' : '') +
      '<button class="link-ul" type="button" data-act="goal-archive">Archivieren</button></div><div id="revise-box"></div></div>';
    c.ms.forEach(function (m, i) {
      var ss = stepsOf(m).filter(function (s) { return s.status !== 'ersetzt'; }), d = ss.filter(function (s) { return s.status === 'erledigt'; }).length;
      h += '<section class="glass glass--pad weg__ms"><div class="weg__ms-head"><div><div class="micro">Meilenstein ' + (i + 1) + '</div><h2 class="weg__ms-t">' + esc(m.title) + '</h2></div><span class="stat__label">' + d + ' von ' + ss.length + ' Schritten erledigt</span></div><ol class="wsteps">' + ss.map(stepRow).join('') + '</ol></section>';
    });
    if (c.older.length) h += '<details class="glass glass--pad weg__older"><summary>Erledigt in früheren Versionen (' + c.older.length + ')</summary><ul class="act">' + c.older.map(function (s) { return '<li class="act__item"><span class="act__text">' + esc(s.title) + '</span><span class="act__meta">Version ' + s.version + ' · ' + esc(STATUS[s.status]) + (s.result ? ' · ' + esc(s.result) : '') + '</span></li>'; }).join('') + '</ul></details>';
    vWeg.innerHTML = h + '</div>';
  }

  function renderAll() {
    var r = (location.hash || '#heute').slice(1);
    if (r === 'heute') renderToday();
    if (r === 'weg') renderWeg();
    if (r === 'start') renderStart();
  }

  /* ---------- Interaktion Heute / Weg ---------- */
  function onAction(e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), s = id ? byId(id) : null;
    if (act === 'toggle') { st.open = st.open === id ? null : id; renderWeg(); return; }
    if (act === 'goal') { prefGoal(id); st.open = null; load().then(renderAll); return; }
    if (act === 'goal-pause') return setGoalStatus('pausiert');
    if (act === 'goal-resume') return setGoalStatus('aktiv');
    if (act === 'goal-reached') { if (window.confirm('Ziel als erreicht markieren?')) setGoalStatus('erreicht'); return; }
    if (act === 'goal-archive') { if (window.confirm('Ziel archivieren? Es bleibt gespeichert, erscheint aber nicht mehr in der Übersicht.')) setGoalStatus('archiviert'); return; }
    if (act === 'req') { var rq = st.requests.filter(function (x) { return x.id === id; })[0]; if (rq && window.FVLive) setTimeout(function () { window.FVLive.open(rq); }, 0); return; }
    if (act === 'revise') return showRevise();
    if (act === 'revise-ok') { b.disabled = true; return reviseGoal(st.reviseProp); }
    if (act === 'revise-cancel') { $('revise-box').innerHTML = ''; return; }
    if (!s) return;
    if (act === 'open') { location.hash = '#weg'; st.open = s.id; setTimeout(function () { renderWeg(); var m = b.getAttribute('data-mode'); if (m) document.querySelector('[data-act="' + m + '"][data-id="' + s.id + '"]').click(); }, 0); return; }
    if (act === 'start') return setStatus(s, 'in_arbeit');
    if (act === 'reopen' || act === 'unskip') return setStatus(s, act === 'reopen' ? 'in_arbeit' : 'offen');
    if (act === 'help') { if (window.FVLive) window.FVLive.prefill({ goal: st.goal, step: s }); location.hash = '#live'; return; }
    var resEl = $('res-' + s.id), extra = $('extra-' + s.id);
    if (act === 'done') {
      var res = resEl ? resEl.value.trim() : '';
      if (!res) { toast('Notiere kurz dein Ergebnis – so bleibt dein Fortschritt nachvollziehbar.'); if (resEl) resEl.focus(); return; }
      return setStatus(s, 'erledigt', { result: res.slice(0, 1200), note: blockers(s).length ? 'Vorwissen' : '' });
    }
    if (act === 'block') { extra.innerHTML = '<label class="field"><span class="field__label">Was hält dich auf?</span><textarea class="field__input" id="blk-' + s.id + '" rows="2" maxlength="400"></textarea></label><div class="tx__actions"><button class="btn btn--solid btn--sm" data-act="block-ok" data-id="' + s.id + '">Blockade festhalten</button></div>'; return; }
    if (act === 'block-ok') { var n = $('blk-' + s.id).value.trim(); if (!n) return toast('Beschreibe kurz, woran es hängt.'); return setStatus(s, 'blockiert', { note: n }); }
    if (act === 'skip') { extra.innerHTML = '<label class="field"><span class="field__label">Warum überspringst du diesen Schritt?</span><textarea class="field__input" id="skp-' + s.id + '" rows="2" maxlength="300"></textarea></label><div class="tx__actions"><button class="btn btn--glass btn--sm" data-act="skip-ok" data-id="' + s.id + '">Überspringen</button></div>'; return; }
    if (act === 'skip-ok') { var r = $('skp-' + s.id).value.trim(); if (!r) return toast('Eine kurze Begründung ist nötig.'); return setStatus(s, 'uebersprungen', { skip_reason: r }); }
    if (act === 'shrink') { extra.innerHTML = '<p class="task__why">Wähle einen kleineren Einstieg:</p><div class="tx__actions">' + T.shrinkOptions(s).map(function (o) { return '<button class="btn btn--glass btn--sm" data-act="shrink-ok" data-id="' + s.id + '" data-opt="' + o.id + '">' + esc(o.label) + '</button>'; }).join('') + '</div>'; return; }
    if (act === 'shrink-ok') { var o = T.shrinkOptions(s).filter(function (x) { return x.id === b.getAttribute('data-opt'); })[0]; return shrink(s, o); }
  }

  function showRevise() {
    var box = $('revise-box'), g = st.goal, c = current();
    box.innerHTML = '<p class="task__why">Neuer Vorschlag wird vorbereitet …</p>';
    propose({ text: g.original_text || '', result: g.desired_result || '', situation: g.situation || '', summary: g.summary || '', timeframe: g.timeframe, hours: g.hours_per_week }).then(function (p) {
      st.reviseProp = p;
      var oldOpen = c.steps.filter(function (s) { return !isDone(s); }).map(function (s) { return s.title; });
      var newTitles = []; p.milestones.forEach(function (m) { m.steps.forEach(function (s) { newTitles.push(s.title); }); });
      var removed = oldOpen.filter(function (t) { return newTitles.indexOf(t) < 0; }), added = newTitles.filter(function (t) { return oldOpen.indexOf(t) < 0 && !c.steps.some(function (s) { return s.title === t && isDone(s); }); });
      box.innerHTML = '<div class="revise"><div class="micro">Vorgeschlagene Änderung (Version ' + (g.path_version + 1) + ')</div>' + (p.note ? '<p class="xp-note">' + esc(p.note) + '</p>' : '') +
        '<p class="task__why">Erledigte und übersprungene Schritte bleiben erhalten.</p>' +
        (removed.length ? '<p class="task__block"><strong>Fallen weg:</strong> ' + removed.map(esc).join(' · ') + '</p>' : '') +
        (added.length ? '<p class="task__why"><strong>Neu:</strong> ' + added.map(esc).join(' · ') + '</p>' : '') +
        (!removed.length && !added.length ? '<p class="task__why">Keine inhaltlichen Änderungen an offenen Schritten.</p>' : '') +
        '<div class="tx__actions"><button class="btn btn--solid btn--sm" data-act="revise-ok">Neue Version übernehmen<span class="btn__rule"></span></button><button class="btn btn--glass btn--sm" data-act="revise-cancel">Abbrechen</button></div></div>';
    });
  }

  vToday.addEventListener('click', onAction);
  vWeg.addEventListener('click', onAction);

  /* ---------- Schnittstelle ---------- */
  window.FVP = {
    reload: function () { return load().then(renderAll); },
    state: function () { return st; },
    activeStep: function () { return nextActions()[0] || null; },
    addStepFromOutcome: function (goalId, text) {
      var g = st.goals.filter(function (x) { return x.id === goalId; })[0];
      if (!g) return Promise.reject(S.err('NOT_FOUND', 'Ziel nicht gefunden.'));
      var c = current(), m = c.ms[c.ms.length - 1];
      var firstOpen = c.ms.filter(function (mm) { return stepsOf(mm).some(function (s) { return !isDone(s) && s.status !== 'ersetzt'; }); })[0];
      m = firstOpen || m;
      return S.insert('steps', {
        goal_id: g.id, milestone_id: m.id, version: g.path_version, order_no: 99, title: text.slice(0, 80), action: text.slice(0, 300),
        reason: 'Aus einem Gespräch übernommen.', min_minutes: 15, max_minutes: 30, criterion: 'Du hast die Handlung umgesetzt und das Ergebnis notiert.',
        support_type: null, requires: [], status: 'offen', result: '', note: '', origin: 'gespraech', history: [{ at: new Date().toISOString(), status: 'offen', by: 'aus Gespräch übernommen' }]
      }).then(load).then(renderAll);
    }
  };

  document.addEventListener('fv:route', function (e) { var r = e.detail && e.detail.route; if (r === 'heute' || r === 'weg' || r === 'start') load().then(renderAll).catch(fail); });
  document.addEventListener('fv:signin', function () { load().then(renderAll).catch(fail); });
})();
