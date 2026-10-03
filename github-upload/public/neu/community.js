/* Flow Valu – Austausch: Fragen, Fortschritte und Erfahrungen zu einem Weg.
   Kein beliebiger Feed: Beiträge hängen an Thema und Schritt, Standardfilter ist dein aktuelles Thema.
   Mit Server für alle Mitglieder sichtbar, im Testmodus nur in diesem Browser. */
(function () {
  'use strict';
  var root = document.getElementById('austausch-root');
  var T = window.FVT, B = window.FVB;
  if (!root || !T) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var toast = function (t) { if (window.FVUI) window.FVUI.toast(t); };
  var KINDS = { frage: 'Frage', fortschritt: 'Fortschritt', erfahrung: 'Erfahrung' };
  var st = { filter: null, kind: 'frage', open: {}, replies: {}, posts: [], helped: {}, uid: null };

  function me() {
    try {
      var n = sessionStorage.getItem('fv-me-name'); if (n) return n;
      var u = JSON.parse(localStorage.getItem('fv-demo-users') || '{}'), m = sessionStorage.getItem('fv-signed-in');
      return (u[m] && u[m].name) || 'Mitglied';
    } catch (x) { return 'Mitglied'; }
  }
  function context() {
    var s = window.FVP ? window.FVP.state() : null, g = s && s.goal, step = window.FVP ? window.FVP.activeStep() : null;
    var topic = (g && g.topic) || (g && (T.topicFor(g.title + ' ' + (g.original_text || '')) || {}).id) || '';
    return { topic: topic, step: step ? step.title : '' };
  }
  function ago(t) {
    var m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    if (m < 1) return 'gerade eben'; if (m < 60) return 'vor ' + m + ' Min'; var h = Math.round(m / 60); if (h < 24) return 'vor ' + h + ' Std';
    var d = Math.round(h / 24); return d === 1 ? 'gestern' : 'vor ' + d + ' Tagen';
  }

  /* ---------- Daten ---------- */
  var LKEY = 'fv-austausch-demo';
  function lread() { try { return JSON.parse(localStorage.getItem(LKEY) || '{"posts":[],"replies":[],"helped":{}}'); } catch (x) { return { posts: [], replies: [], helped: {} }; } }
  function lwrite(d) { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch (x) {} }
  function q(p) { return p.then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }

  var api = B ? {
    list: function (topic) {
      var x = B.sb.from('posts').select('*').order('created_at', { ascending: false }).limit(50);
      if (topic) x = x.eq('topic', topic);
      return Promise.all([q(x), q(B.sb.from('post_helpful').select('post_id'))]).then(function (r) {
        st.helped = {}; (r[1] || []).forEach(function (h) { st.helped[h.post_id] = true; }); return r[0];
      });
    },
    create: function (o) { return q(B.sb.from('posts').insert(o).select().single()); },
    remove: function (id) { return q(B.sb.from('posts').delete().eq('id', id)); },
    replies: function (id) { return q(B.sb.from('replies').select('*').eq('post_id', id).order('created_at')); },
    reply: function (id, body) { return q(B.sb.from('replies').insert({ post_id: id, author_name: me(), body: body })); },
    helpful: function (id) { return B.rpc('toggle_helpful', { p_post: id }); },
    report: function (id) { return B.rpc('report_post', { p_post: id }); }
  } : {
    list: function (topic) { var d = lread(); st.helped = d.helped || {}; return Promise.resolve(d.posts.filter(function (p) { return !topic || p.topic === topic; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })); },
    create: function (o) { var d = lread(); var p = Object.assign({ id: 'p' + Date.now().toString(36), user_id: 'me', created_at: new Date().toISOString(), reply_count: 0, helpful_count: 0 }, o); d.posts.push(p); lwrite(d); return Promise.resolve(p); },
    remove: function (id) { var d = lread(); d.posts = d.posts.filter(function (p) { return p.id !== id; }); d.replies = d.replies.filter(function (r) { return r.post_id !== id; }); lwrite(d); return Promise.resolve(); },
    replies: function (id) { return Promise.resolve(lread().replies.filter(function (r) { return r.post_id === id; })); },
    reply: function (id, body) { var d = lread(); d.replies.push({ id: 'r' + Date.now().toString(36), post_id: id, user_id: 'me', author_name: me(), body: body, created_at: new Date().toISOString() }); d.posts.forEach(function (p) { if (p.id === id) p.reply_count++; }); lwrite(d); return Promise.resolve(); },
    helpful: function (id) { var d = lread(); d.helped = d.helped || {}; var on = !d.helped[id]; if (on) d.helped[id] = true; else delete d.helped[id]; d.posts.forEach(function (p) { if (p.id === id) p.helpful_count += on ? 1 : -1; }); lwrite(d); return Promise.resolve(); },
    report: function () { return Promise.resolve(); }
  };

  /* ---------- Darstellung ---------- */
  function render() {
    var ctx = context();
    if (st.filter === null) st.filter = ctx.topic || '';
    var h = '<div class="pv"><div class="eyebrow">Austausch</div><h1 class="pv__title">Menschen auf ähnlichen Wegen</h1>' +
      '<p class="pv__sub">Stell eine Frage zu deinem aktuellen Schritt, teile einen Fortschritt oder eine Erfahrung.' + (B ? '' : ' Testmodus: Beiträge sind nur in diesem Browser sichtbar.') + '</p>' +
      '<form class="glass glass--pad-lg cm__form" id="cm-form">' +
      '<div class="seg">' + Object.keys(KINDS).map(function (k) { return '<label class="seg__opt"><input type="radio" name="cm-kind" value="' + k + '"' + (st.kind === k ? ' checked' : '') + ' /><span>' + KINDS[k] + '</span></label>'; }).join('') + '</div>' +
      '<textarea class="field__input cm__text" id="cm-body" rows="3" maxlength="1500" placeholder="' + (st.kind === 'frage' ? 'Woran hängst du gerade? Je konkreter, desto bessere Antworten.' : st.kind === 'fortschritt' ? 'Was hast du geschafft? Was hat dabei geholfen?' : 'Was hast du gelernt, das anderen helfen könnte?') + '"></textarea>' +
      '<div class="cm__meta"><label class="field cm__topic"><span class="field__label">Thema</span><select class="field__input" id="cm-topic">' +
      T.TOPICS.map(function (t) { return '<option value="' + t.id + '"' + (t.id === (ctx.topic || 'idee') ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') + '</select></label>' +
      (ctx.step ? '<label class="cop__row cm__step"><input type="checkbox" id="cm-step" checked /> <span>Mit meinem Schritt „' + esc(ctx.step) + '“ verknüpfen</span></label>' : '') +
      '</div><div class="tx__actions"><button class="btn btn--solid btn--sm" type="submit">Teilen<span class="btn__rule"></span></button></div></form>' +
      '<div class="topics cm__filter">' + '<button class="sug' + (st.filter === '' ? ' is-on' : '') + '" type="button" data-f="">Alle Themen</button>' +
      T.TOPICS.map(function (t) { return '<button class="sug' + (st.filter === t.id ? ' is-on' : '') + '" type="button" data-f="' + t.id + '">' + esc(t.label) + (t.id === ctx.topic ? ' · dein Thema' : '') + '</button>'; }).join('') + '</div>' +
      '<div id="cm-list" class="cm__list"><p class="lh__p">Lädt …</p></div></div>';
    root.innerHTML = h;
    loadList();
  }

  function loadList() {
    var box = document.getElementById('cm-list');
    api.list(st.filter).then(function (posts) {
      st.posts = posts;
      if (!posts.length) { box.innerHTML = '<div class="glass glass--pad"><p class="lh__p">' + (st.filter ? 'Zu „' + esc(T.topicLabel(st.filter)) + '“ gibt es noch keine Beiträge. Stell die erste Frage.' : 'Noch keine Beiträge.') + '</p></div>'; return; }
      box.innerHTML = posts.map(card).join('');
    }).catch(function (e) { box.innerHTML = '<p class="lh__p">Konnte nicht geladen werden: ' + esc(e.message) + '</p>'; });
  }

  function card(p) {
    var mine = B ? p.user_id === st.uid : true, open = st.open[p.id];
    return '<article class="glass glass--pad cm__post" data-id="' + p.id + '">' +
      '<div class="cm__head"><span class="cm__kind cm__kind--' + p.kind + '">' + KINDS[p.kind] + '</span><span class="cm__who">' + esc(p.author_name || 'Mitglied') + ' · ' + ago(p.created_at) + '</span></div>' +
      '<div class="cm__ctx">' + esc(T.topicLabel(p.topic)) + (p.step_title ? ' · Schritt: ' + esc(p.step_title) : '') + '</div>' +
      '<p class="cm__body">' + esc(p.body) + '</p>' +
      '<div class="cm__acts"><button class="link-ul' + (st.helped[p.id] ? ' is-on' : '') + '" type="button" data-a="help">Hilfreich' + (p.helpful_count ? ' · ' + p.helpful_count : '') + '</button>' +
      '<button class="link-ul" type="button" data-a="toggle">' + (p.kind === 'frage' ? 'Antworten' : 'Kommentare') + (p.reply_count ? ' · ' + p.reply_count : '') + '</button>' +
      (mine ? '<button class="link-ul" type="button" data-a="del">Löschen</button>' : '<button class="link-ul" type="button" data-a="report">Melden</button>') + '</div>' +
      (open ? '<div class="cm__replies">' + (st.replies[p.id] || []).map(function (r) { return '<div class="cm__reply"><span class="cm__who">' + esc(r.author_name || 'Mitglied') + ' · ' + ago(r.created_at) + '</span><p>' + esc(r.body) + '</p></div>'; }).join('') +
        '<form class="cm__rform" data-id="' + p.id + '"><input class="field__input" maxlength="1000" placeholder="' + (p.kind === 'frage' ? 'Deine Antwort – was würdest du konkret tun?' : 'Kommentar schreiben …') + '" /><button class="btn btn--glass btn--sm" type="submit">Senden</button></form></div>' : '') +
      '</article>';
  }

  /* ---------- Interaktion ---------- */
  root.addEventListener('change', function (e) {
    if (e.target.name === 'cm-kind') { st.kind = e.target.value; var t = document.getElementById('cm-body'), v = t.value; render(); document.getElementById('cm-body').value = v; }
  });
  root.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'cm-form') {
      var body = document.getElementById('cm-body').value.trim();
      if (body.length < 3) return toast('Schreib bitte etwas mehr.');
      var stepBox = document.getElementById('cm-step'), ctx = context();
      api.create({ author_name: me(), kind: st.kind, topic: document.getElementById('cm-topic').value, step_title: stepBox && stepBox.checked ? ctx.step : '', body: body })
        .then(function (p) { if (window.FVS) window.FVS.track('post_created', { kind: st.kind }); st.filter = p.topic; toast('Geteilt.'); render(); })
        .catch(function (x) { toast('Teilen fehlgeschlagen: ' + x.message); });
    }
    if (e.target.classList.contains('cm__rform')) {
      var id = e.target.getAttribute('data-id'), inp = e.target.querySelector('input'), txt = inp.value.trim();
      if (!txt) return;
      api.reply(id, txt).then(function () { return openReplies(id, true); }).catch(function (x) { toast(x.message); });
    }
  });
  root.addEventListener('click', function (e) {
    var f = e.target.closest('[data-f]');
    if (f) { st.filter = f.getAttribute('data-f'); render(); return; }
    var a = e.target.closest('[data-a]'); if (!a) return;
    var id = a.closest('.cm__post').getAttribute('data-id'), act = a.getAttribute('data-a');
    if (act === 'toggle') { if (st.open[id]) { delete st.open[id]; loadList(); } else openReplies(id); }
    if (act === 'help') api.helpful(id).then(loadList).catch(function (x) { toast(x.message); });
    if (act === 'del' && window.confirm('Beitrag löschen?')) api.remove(id).then(loadList).catch(function (x) { toast(x.message); });
    if (act === 'report' && window.confirm('Diesen Beitrag melden? Nach mehreren Meldungen wird er ausgeblendet und geprüft.')) api.report(id).then(function () { toast('Danke, der Beitrag wurde gemeldet.'); }).catch(function (x) { toast(x.message); });
  });
  function openReplies(id) {
    st.open[id] = true;
    return api.replies(id).then(function (r) { st.replies[id] = r; return loadList(); });
  }

  document.addEventListener('fv:route', function (e) {
    if (!e.detail || e.detail.route !== 'austausch') return;
    (B ? B.uid() : Promise.resolve(null)).then(function (u) { st.uid = u; render(); });
  });
  document.addEventListener('fv:signin', function () { st.filter = null; st.open = {}; });
})();
