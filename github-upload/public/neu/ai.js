/* Flow Valu — KI-Anbindung (ChatGPT oder Claude) + lokale Mindmap ohne KI.
   Der API-Schlüssel liegt vorerst im Browser. Für den echten Betrieb über den Server laufen lassen. */
(function () {
  'use strict';

  var DEFAULTS = { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5' };
  var KEY = 'fv-ai-settings';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (x) { return {}; }
  }
  function settings() {
    var s = read();
    var provider = s.provider === 'anthropic' ? 'anthropic' : 'openai';
    var keys = s.keys || {}, models = s.models || {};
    return { provider: provider, key: keys[provider] || '', model: models[provider] || DEFAULTS[provider], keys: keys, models: models };
  }
  function save(provider, key, model) {
    var s = read();
    s.provider = provider;
    s.keys = s.keys || {}; s.models = s.models || {};
    s.keys[provider] = key;
    s.models[provider] = model || DEFAULTS[provider];
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (x) {}
  }
  function label(p) { return p === 'anthropic' ? 'Claude' : 'ChatGPT'; }

  /* messages: [{role:'system'|'user'|'assistant', content}] */
  function chat(messages, opts) {
    opts = opts || {};
    var s = settings();
    if (!s.key) return Promise.reject(new Error('Kein KI-Schlüssel hinterlegt. Trage ihn unter KI-Einstellungen ein.'));

    if (s.provider === 'openai') {
      var body = { model: s.model, messages: messages, temperature: 0.3 };
      if (opts.json) body.response_format = { type: 'json_object' };
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
        body: JSON.stringify(body)
      }).then(handle).then(function (d) {
        return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
      });
    }

    var system = messages.filter(function (m) { return m.role === 'system'; }).map(function (m) { return m.content; }).join('\n\n');
    var rest = messages.filter(function (m) { return m.role !== 'system'; });
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': s.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: s.model, max_tokens: opts.maxTokens || 1500, system: system, messages: rest })
    }).then(handle).then(function (d) {
      return (d.content || []).map(function (c) { return c.text || ''; }).join('');
    });
  }

  function handle(res) {
    return res.json().catch(function () { return {}; }).then(function (d) {
      if (!res.ok) {
        var msg = (d && d.error && (d.error.message || d.error.type)) || ('Fehler ' + res.status);
        if (res.status === 401) msg = 'Der API-Schlüssel wurde abgelehnt. Bitte prüfen.';
        throw new Error(msg);
      }
      return d;
    });
  }

  function parseJson(text) {
    var t = String(text || '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('Die KI hat kein gültiges Ergebnis geliefert.');
    return JSON.parse(t.slice(a, b + 1));
  }

  function clean(data, fallbackTitle) {
    var d = data || {};
    var mm = d.mindmap || {};
    var branches = Array.isArray(mm.branches) ? mm.branches : [];
    return {
      title: String(d.title || fallbackTitle || 'Gesprächsnotiz').slice(0, 80),
      summary: String(d.summary || '').slice(0, 1200),
      mindmap: {
        center: String(mm.center || d.title || 'Gespräch').slice(0, 40),
        branches: branches.slice(0, 6).map(function (b) {
          return {
            label: String((b && b.label) || '').slice(0, 40),
            children: (Array.isArray(b && b.children) ? b.children : []).slice(0, 4).map(function (c) { return String(c).slice(0, 70); })
          };
        }).filter(function (b) { return b.label; })
      },
      tasks: (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 10).map(function (t) {
        return typeof t === 'string' ? { text: t.slice(0, 200), owner: '' } : { text: String(t.text || '').slice(0, 200), owner: String(t.owner || '').slice(0, 40) };
      }).filter(function (t) { return t.text; })
    };
  }

  function transcriptText(lines) {
    return lines.map(function (l) { return '[' + l.who + '] ' + l.text; }).join('\n');
  }

  function mindmapAI(meta) {
    var text = transcriptText(meta.transcript);
    if (text.length > 24000) text = text.slice(-24000);
    var sys = 'Du erstellst aus einer Gesprächsmitschrift eine strukturierte Notiz auf Deutsch für die Plattform Flow Valu (persönliche und berufliche Entwicklung). ' +
      'Antworte ausschließlich mit JSON in genau dieser Form: ' +
      '{"title": string (max. 8 Wörter), "summary": string (2–4 Sätze), ' +
      '"mindmap": {"center": string (max. 4 Wörter), "branches": [{"label": string (max. 4 Wörter), "children": [string (max. 8 Wörter)]}]}, ' +
      '"tasks": [{"text": string (konkreter nächster Schritt), "owner": string (Name oder leer)}]}. ' +
      '3 bis 6 Äste mit je 2 bis 4 Unterpunkten. Nur Inhalte, die im Gespräch vorkommen. Keine Einleitung, kein Markdown.';
    var user = 'Thema: ' + (meta.topic || '–') + '\nTeilnehmende: ' + meta.me + ', ' + meta.partner + '\n\nMitschrift:\n' + text;
    return chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, maxTokens: 1800 })
      .then(parseJson)
      .then(function (d) { return clean(d, 'Gespräch: ' + (meta.topic || '')); });
  }

  /* ---------- Lokale Mindmap ohne KI ---------- */
  var STOP = ('aber alle allem allen aller alles also auch auf aus bei beim bin bis bist dann das dass dein deine dem den der des dich die dies diese diesem diesen dieser doch dort durch ein eine einem einen einer eines einfach etwas euch euer für gar gibt habe haben hast hat hatte hier ich ihr ihre im immer in ist ja jetzt kann kannst kein keine man mal mehr mein meine mich mir mit muss nach nicht nichts noch nur ob oder ohne schon sehr sein seine sich sie sind so soll sollte über um und uns unser unter viel vom von vor wann war waren was weil weiß wenn wer werde werden wie wieder wir wird wirklich wo würde zu zum zur zwar genau okay also halt eben gerade dann denn ganz gut ja nein mhm ähm äh').split(' ');

  function local(meta) {
    var lines = meta.transcript;
    var all = lines.map(function (l) { return l.text; }).join(' ');
    var sentences = all.split(/(?<=[.!?])\s+|\n+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 8; });
    if (!sentences.length) sentences = lines.map(function (l) { return l.text; });

    var counts = {};
    all.toLowerCase().replace(/[^a-zäöüß0-9\s-]/g, ' ').split(/\s+/).forEach(function (w) {
      if (w.length < 4 || STOP.indexOf(w) > -1) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);

    function short(s, n) { var ws = s.split(/\s+/); return ws.slice(0, n).join(' ') + (ws.length > n ? ' …' : ''); }
    function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

    var branches = top.map(function (w) {
      var kids = sentences.filter(function (s) { return s.toLowerCase().indexOf(w) > -1; }).slice(0, 3).map(function (s) { return short(s, 8); });
      return { label: cap(w), children: kids };
    });

    var taskRe = /(ich werde|ich will|ich muss|wir sollten|wir müssen|lass uns|nächste[rn]? schritt|bis (morgen|montag|dienstag|mittwoch|donnerstag|freitag|nächste)|aufgabe|ich schicke|ich melde)/i;
    var tasks = sentences.filter(function (s) { return taskRe.test(s); }).slice(0, 8).map(function (s) { return { text: short(s, 18), owner: '' }; });

    return clean({
      title: 'Gespräch: ' + (meta.topic || 'Austausch'),
      summary: 'Gespräch zwischen ' + meta.me + ' und ' + meta.partner + (meta.topic ? ' zum Thema ' + meta.topic : '') + '. ' +
        (top.length ? 'Häufigste Schwerpunkte: ' + top.slice(0, 3).map(cap).join(', ') + '.' : '') +
        ' (Ohne KI erstellt — für eine bessere Mindmap einen KI-Schlüssel hinterlegen.)',
      mindmap: { center: meta.topic || 'Gespräch', branches: branches },
      tasks: tasks
    });
  }

  function mindmap(meta) {
    if (!settings().key) return Promise.resolve({ data: local(meta), source: 'lokal' });
    return mindmapAI(meta)
      .then(function (d) { return { data: d, source: label(settings().provider) }; })
      .catch(function (e) { return { data: local(meta), source: 'lokal', error: e.message }; });
  }

  function ask(question, context) {
    var sys = 'Du bist der KI-Begleiter von Flow Valu in einem Live-Gespräch zwischen zwei Menschen, die an ihren Zielen arbeiten. ' +
      'Antworte auf Deutsch, kurz und konkret: höchstens 5 Sätze oder eine kurze Liste. Gib nächste Schritte statt langer Erklärungen.';
    var msgs = [{ role: 'system', content: sys }];
    if (context) msgs.push({ role: 'user', content: 'Kontext aus dem Gespräch (Auszug):\n' + context }, { role: 'assistant', content: 'Verstanden.' });
    msgs.push({ role: 'user', content: question });
    return chat(msgs, { maxTokens: 600 });
  }

  window.FVAI = {
    settings: settings, save: save, label: label, defaults: DEFAULTS,
    hasKey: function () { return !!settings().key; },
    chat: chat, ask: ask, mindmap: mindmap, transcriptText: transcriptText
  };

  /* ---------- Einstellungsseite ---------- */
  var form = document.getElementById('ai-settings');
  if (!form) return;
  var keyIn = document.getElementById('ai-key'), modelIn = document.getElementById('ai-model'), msg = document.getElementById('ai-settings-msg');

  function current() { var r = form.querySelector('input[name="provider"]:checked'); return r ? r.value : 'openai'; }
  function fill(provider) {
    var s = settings();
    keyIn.value = (s.keys && s.keys[provider]) || '';
    modelIn.value = (s.models && s.models[provider]) || DEFAULTS[provider];
    keyIn.placeholder = provider === 'anthropic' ? 'sk-ant-…' : 'sk-…';
  }
  function say(text, ok) { msg.textContent = text; msg.hidden = false; msg.classList.toggle('is-ok', !!ok); }

  var s0 = settings();
  var r0 = form.querySelector('input[value="' + s0.provider + '"]');
  if (r0) r0.checked = true;
  fill(s0.provider);

  form.addEventListener('change', function (e) { if (e.target.name === 'provider') { fill(current()); msg.hidden = true; } });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    save(current(), keyIn.value.trim(), modelIn.value.trim());
    say('Gespeichert. ' + label(current()) + ' ist jetzt aktiv.', true);
  });
  document.getElementById('ai-test').addEventListener('click', function () {
    save(current(), keyIn.value.trim(), modelIn.value.trim());
    say('Teste Verbindung …', true);
    chat([{ role: 'user', content: 'Antworte nur mit: OK' }], { maxTokens: 10 })
      .then(function () { say('Verbindung zu ' + label(current()) + ' funktioniert.', true); })
      .catch(function (err) { say(err.message, false); });
  });
})();
