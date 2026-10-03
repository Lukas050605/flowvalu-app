/* Flow Valu – kontrollierte Themen und geprüfte Wegvorlagen (Pilot: nebenberuflich ein Angebot aufbauen). */
(function () {
  'use strict';

  var TOPICS = [
    { id: 'angebot', label: 'Angebot formulieren', re: /angebot|leistung|produkt|dienstleist/ },
    { id: 'zielgruppe', label: 'Erste Zielgruppe finden', re: /zielgruppe|kunden?gruppe|nische|wer kauft/ },
    { id: 'kundengespraech', label: 'Kundengespräche', re: /kundengespr|akquise|verkauf|vertrieb|pitch/ },
    { id: 'preise', label: 'Preise darstellen', re: /preis|kosten|honorar|stundensatz/ },
    { id: 'idee', label: 'Idee durchdenken', re: /idee|abwägen|entscheid|option|möglichkeit/ },
    { id: 'gruendung', label: 'Nebenberuflich gründen', re: /gründ|gewerbe|selbstst|nebenberuf|nebenbei|unternehm/ },
    { id: 'finanzen', label: 'Finanzen', re: /finanz|geld|spar|invest|unabh/ },
    { id: 'fuehrung', label: 'Führung', re: /führung|leader|team|chef/ },
    { id: 'karriere', label: 'Karriere & Beruf', re: /karriere|job|beruf|bewerb|wechsel/ },
    { id: 'disziplin', label: 'Fokus & Routine', re: /disziplin|routine|fokus|gewohn|aufschieb/ }
  ];

  var HELP_TYPES = [
    { id: 'mitdenken', label: 'Mitdenken' },
    { id: 'erklaeren', label: 'Etwas erklärt bekommen' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'entscheidung', label: 'Entscheidung strukturieren' },
    { id: 'umsetzen', label: 'Gemeinsam umsetzen' }
  ];

  function topicFor(text) {
    var low = String(text || '').toLowerCase();
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].re.test(low)) return TOPICS[i];
    return null;
  }
  function topicLabel(id) { var t = TOPICS.filter(function (x) { return x.id === id; })[0]; return t ? t.label : (id || ''); }
  function helpLabel(id) { var t = HELP_TYPES.filter(function (x) { return x.id === id; })[0]; return t ? t.label : (id || ''); }

  // Schritt: [Titel, Handlung, Grund, min, max, Abschlusskriterium, Hilfsart|null, Voraussetzungen (Indizes im Meilenstein)]
  function S(t, a, r, mn, mx, c, h, req) {
    return { title: t, action: a, reason: r, min_minutes: mn, max_minutes: mx, criterion: c, support_type: h || null, requires: req || [] };
  }

  var TEMPLATES = {
    angebot: {
      id: 'angebot-nebenberuflich-v1',
      title: 'Nebenberuflich ein eigenes Angebot aufbauen',
      milestones: [
        { title: 'Ein verständliches Angebot liegt vor', steps: [
          S('Problem und Zielgruppe notieren', 'Schreibe in Stichpunkten auf, welches Problem du für wen lösen möchtest.', 'Ohne klares Problem bleibt das Angebot beliebig.', 10, 20, 'Zwei bis drei Stichpunkte zu Problem und Zielgruppe sind gespeichert.', 'mitdenken'),
          S('Ein konkretes Angebot formulieren', 'Schreibe, wem du welches Problem mit welcher Leistung löst.', 'Der Satz macht dein Angebot für ein erstes Feedback verständlich.', 15, 30, 'Ein verständlicher Angebotssatz liegt vor.', 'feedback', [0]),
          S('Feedback zum Angebotssatz holen', 'Lass eine Person mit Erfahrung in Angebotsentwicklung deinen Satz lesen und notiere ihre Rückfragen.', 'Fremde Rückfragen zeigen, wo der Nutzen noch unklar ist.', 15, 30, 'Mindestens eine Rückmeldung ist notiert.', 'feedback', [1]),
          S('Angebotssatz überarbeiten', 'Überarbeite deinen Satz anhand der Rückmeldung.', 'So wird aus dem Entwurf eine Fassung, die du zeigen kannst.', 10, 20, 'Die überarbeitete Fassung ist gespeichert.', null, [2])
        ] },
        { title: 'Erste Zielgruppe ist greifbar', steps: [
          S('Drei mögliche Personen notieren', 'Notiere drei Menschen aus deinem Umfeld, die das Problem haben könnten.', 'Konkrete Personen machen die Zielgruppe prüfbar.', 10, 20, 'Drei Namen oder Beschreibungen sind notiert.', 'mitdenken'),
          S('Ein kurzes Gespräch vorbereiten', 'Schreibe fünf offene Fragen, mit denen du das Problem verstehst, ohne zu verkaufen.', 'Gute Fragen liefern ehrliche Antworten.', 20, 40, 'Fünf Fragen sind gespeichert.', 'feedback', [0]),
          S('Ein erstes Gespräch führen', 'Führe ein Gespräch mit einer der notierten Personen und halte drei Erkenntnisse fest.', 'Echte Antworten ersetzen Vermutungen.', 30, 60, 'Drei Erkenntnisse aus dem Gespräch sind notiert.', null, [1])
        ] },
        { title: 'Preis ist verständlich dargestellt', steps: [
          S('Leistungsumfang festlegen', 'Beschreibe, was genau im Angebot enthalten ist und was nicht.', 'Ein klarer Umfang macht den Preis nachvollziehbar.', 15, 30, 'Umfang mit Ein- und Ausschlüssen ist notiert.', null),
          S('Einen Startpreis mit Begründung notieren', 'Notiere einen Startpreis und in einem Satz, wie du darauf kommst.', 'Eine Begründung hilft dir im Gespräch.', 15, 30, 'Preis und Begründung sind gespeichert.', 'entscheidung', [0]),
          S('Preis mit einer Person durchsprechen', 'Besprich Preis und Umfang mit jemandem, der ähnliche Angebote kennt.', 'Eine zweite Perspektive zeigt blinde Flecken.', 15, 30, 'Mindestens eine Rückmeldung zum Preis ist notiert.', 'feedback', [1])
        ] }
      ]
    },
    allgemein: {
      id: 'ziel-klaeren-v1',
      title: 'Ziel klären und ersten Schritt finden',
      milestones: [
        { title: 'Das Ziel ist klar beschrieben', steps: [
          S('Gewünschtes Ergebnis in einem Satz', 'Schreibe in einem Satz, woran du erkennst, dass du dein Ziel erreicht hast.', 'Ein prüfbares Ergebnis macht nächste Schritte sichtbar.', 10, 15, 'Ein Ergebnissatz ist gespeichert.', 'mitdenken'),
          S('Bisherige Versuche notieren', 'Notiere, was du schon ausprobiert hast und was dabei passiert ist.', 'So wiederholst du nichts, was schon nicht funktioniert hat.', 10, 20, 'Mindestens ein bisheriger Versuch ist notiert.', null),
          S('Kleinsten nächsten Schritt festlegen', 'Lege eine Handlung fest, die du in unter 30 Minuten erledigen kannst.', 'Ein kleiner Schritt senkt die Hürde zum Anfangen.', 10, 15, 'Eine konkrete Handlung ist gespeichert.', 'entscheidung', [0])
        ] },
        { title: 'Der erste Schritt ist erledigt', steps: [
          S('Den kleinsten Schritt ausführen', 'Erledige die festgelegte Handlung.', 'Umsetzung zeigt, was wirklich fehlt.', 15, 30, 'Das Ergebnis ist kurz beschrieben.', null),
          S('Mit jemandem durchdenken', 'Besprich dein Ergebnis mit einer Person, die dir eine zweite Perspektive gibt.', 'Austausch hilft, den nächsten Schritt realistisch zu wählen.', 15, 30, 'Eine Erkenntnis aus dem Gespräch ist notiert.', 'mitdenken', [0])
        ] }
      ]
    }
  };

  function templateFor(text) {
    var t = topicFor(text);
    if (t && ['angebot', 'zielgruppe', 'kundengespraech', 'preise', 'gruendung'].indexOf(t.id) > -1) return TEMPLATES.angebot;
    return TEMPLATES.allgemein;
  }

  // Verkleinern-Optionen für einen blockierten Schritt
  function shrinkOptions(step) {
    return [
      { id: 'vorbereitung', label: '10 Minuten Vorbereitung', title: 'Vorbereitung: ' + step.title, action: 'Nimm dir 10 Minuten und sammle, was du für „' + step.title + '" brauchst.', min: 5, max: 10, criterion: 'Eine kurze Liste mit dem Nötigen ist notiert.' },
      { id: 'entwurf', label: 'Ein erster Entwurf', title: 'Erster Entwurf: ' + step.title, action: 'Schreibe eine unfertige erste Fassung – sie muss nicht gut sein.', min: 10, max: 20, criterion: 'Ein Entwurf ist gespeichert, egal wie roh.' },
      { id: 'rueckfrage', label: 'Eine konkrete Rückfrage', title: 'Rückfrage zu: ' + step.title, action: 'Formuliere die eine Frage, deren Antwort dich weiterbringen würde.', min: 5, max: 10, criterion: 'Die Rückfrage ist notiert.' }
    ];
  }

  window.FVT = { TOPICS: TOPICS, HELP_TYPES: HELP_TYPES, TEMPLATES: TEMPLATES, topicFor: topicFor, topicLabel: topicLabel, helpLabel: helpLabel, templateFor: templateFor, shrinkOptions: shrinkOptions };
})();
