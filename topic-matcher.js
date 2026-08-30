const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { fetchWithTimeout } = require('./fetch-with-timeout');

/**
 * Feste Liste breiter Themen-Cluster. Damit "KFZ-Werkstatt" und "Autofirma gründen"
 * im selben Topf landen, ordnen wir jede Eingabe EINEM oder ZWEI dieser Cluster zu,
 * statt nach exakten Wörtern zu suchen.
 */
const TOPIC_TAGS = [
  'Fahrzeuge & Mobilität',
  'Landwirtschaft & Natur',
  'Essen & Kulinarik',
  'Mode & Beauty',
  'Musik & Audio',
  'Kunst & Design',
  'Software & Tech',
  'Business & Gründung',
  'Handwerk & Bauen',
  'Gesundheit & Wohlbefinden',
  'Bildung & Wissen',
  'Reisen & Freizeit',
  'Schreiben & Medien',
  'Sonstiges'
];

// Einfache Stichwort-Liste als Fallback, falls kein API-Key gesetzt ist oder der
// Aufruf fehlschlägt. Pro Kategorie mehrere Wortformen/Synonyme, damit auch Varianten
// wie "Bäckerei" oder "backen" erkannt werden.
const FALLBACK_KEYWORDS = {
  'Fahrzeuge & Mobilität': ['auto', 'autos', 'autofirma', 'autohaus', 'autowerkstatt', 'autoteile', 'autoverkauf', 'autopflege', 'gebrauchtwagen', 'kfz', 'werkstatt', 'motorrad', 'fahrzeug', 'fahrzeuge', 'reifen', 'verkehr', 'lkw', 'e-auto', 'elektroauto', 'tuning', 'fahrrad'],
  'Landwirtschaft & Natur': ['landwirtschaft', 'bauernhof', 'blume', 'blumen', 'blumenladen', 'blumengeschäft', 'garten', 'pflanze', 'pflanzen', 'acker', 'feld', 'tiere', 'natur', 'gärtnerei', 'ernte'],
  'Essen & Kulinarik': ['kochen', 'koche', 'koch', 'gekocht', 'kochbuch', 'kochkurs', 'kochshow', 'backen', 'bäckerei', 'bäcker', 'konditor', 'café', 'restaurant', 'restaurantkette', 'rezept', 'küche', 'essen', 'gastro', 'gastronomie', 'topf', 'kochtopf', 'menü', 'speisekarte', 'catering'],
  'Mode & Beauty': ['mode', 'modelabel', 'kleidung', 'style', 'beauty', 'kosmetik', 'schmuck', 'friseur', 'boutique'],
  'Musik & Audio': ['musik', 'song', 'podcast', 'band', 'beat', 'sound', 'instrument', 'playlist', 'album'],
  'Kunst & Design': ['design', 'kunst', 'malen', 'illustration', 'grafik', 'logo', 'zeichnen', 'gestalten', 'branding'],
  'Software & Tech': ['app', 'apps', 'software', 'code', 'quellcode', 'programmcode', 'programmieren', 'programmiere', 'website', 'ki', 'tech', 'game', 'spiel', 'algorithmus'],
  'Business & Gründung': ['firma', 'startup', 'gründen', 'gründung', 'firmengründung', 'business', 'marketing', 'unternehmen', 'kunden', 'geschäftsidee', 'selbstständig'],
  'Handwerk & Bauen': ['bauen', 'handwerk', 'möbel', 'werkstatt', 'diy', 'reparatur', 'holz', 'schreiner', 'tischler'],
  'Gesundheit & Wohlbefinden': ['fitness', 'ernährung', 'gesundheit', 'sport', 'yoga', 'wellness', 'training'],
  'Bildung & Wissen': ['lernen', 'schule', 'uni', 'studium', 'wissenschaft', 'kurs', 'ausbildung'],
  'Reisen & Freizeit': ['reisen', 'urlaub', 'abenteuer', 'hobby', 'ausflug', 'trip'],
  'Schreiben & Medien': ['schreiben', 'buch', 'text', 'film', 'video', 'content', 'roman', 'blog', 'geschichte']
};

// Baut pro Kategorie eine Regex, die Wörter nur bei echten Wortgrenzen matcht —
// verhindert falsche Treffer wie "auto" in "Automatik" oder "code" in "Codewort".
const FALLBACK_KEYWORD_REGEX = Object.fromEntries(
  Object.entries(FALLBACK_KEYWORDS).map(([tag, words]) => {
    const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return [tag, new RegExp('(?<![a-zA-ZäöüÄÖÜß])(?:' + pattern + ')(?![a-zA-ZäöüÄÖÜß])', 'giu')];
  })
);

// Cache: normalisierter Text -> Tags. Verhindert wiederholte API-Calls für identische
// Eingaben. Bewusst simpel gehalten (kein Limit nötig, da Prozess bei Redeploy eh neu startet).
const cache = new Map();
const MAX_CACHE_SIZE = 2000;

function normalize(text) {
  return String(text || '').trim().toLowerCase().slice(0, 300);
}

/**
 * Wörter-Baum: verknüpft einzelne Begriffe mit inhaltlich naheliegenden anderen Begriffen,
 * unabhängig von den festen Themen-Kategorien oben. Damit werden auch assoziative
 * Verbindungen wie "Uhr" <-> "Zeit" oder "Kochtopf" <-> "Kochen" erkannt, selbst wenn
 * kein API-Key gesetzt ist. Jeder Eintrag zeigt auf direkt verwandte Begriffe (ein "Ast");
 * über mehrere Äste hinweg (z.B. Uhr -> Zeit -> Termin -> Planung) entsteht der Baum.
 */
const WORD_TREE = {
  uhr: ['zeit', 'wecker', 'zeitmessung', 'armbanduhr'],
  zeit: ['uhr', 'stunde', 'minute', 'kalender', 'termin', 'zeitmanagement'],
  wecker: ['uhr', 'zeit', 'aufstehen'],
  kalender: ['zeit', 'termin', 'planung', 'organisation'],
  termin: ['zeit', 'kalender', 'planung'],
  planung: ['termin', 'kalender', 'organisation', 'projekt'],
  organisation: ['planung', 'struktur', 'projekt', 'management'],

  blume: ['garten', 'pflanze', 'natur', 'strauß'],
  garten: ['blume', 'pflanze', 'natur', 'landwirtschaft', 'gemüse'],
  pflanze: ['garten', 'blume', 'natur', 'landwirtschaft'],
  natur: ['garten', 'pflanze', 'landwirtschaft', 'tiere', 'umwelt'],
  landwirtschaft: ['garten', 'natur', 'bauernhof', 'ernte', 'feld'],
  bauernhof: ['landwirtschaft', 'tiere', 'feld', 'ernte'],

  auto: ['fahrzeug', 'motor', 'werkstatt', 'mobilität', 'verkehr'],
  fahrzeug: ['auto', 'motor', 'mobilität', 'verkehr', 'lkw'],
  motor: ['auto', 'fahrzeug', 'technik', 'mechanik'],
  werkstatt: ['auto', 'reparatur', 'handwerk', 'mechanik', 'autopflege'],
  autopflege: ['auto', 'werkstatt', 'fahrzeug'],
  mobilität: ['auto', 'fahrzeug', 'verkehr', 'reisen'],

  kochen: ['essen', 'rezept', 'küche', 'kochtopf', 'zutaten'],
  essen: ['kochen', 'rezept', 'küche', 'restaurant', 'ernährung'],
  kochtopf: ['kochen', 'küche', 'zutaten'],
  rezept: ['kochen', 'essen', 'küche', 'backen'],
  backen: ['kochen', 'rezept', 'bäckerei', 'süß'],
  küche: ['kochen', 'essen', 'rezept', 'restaurant'],
  restaurant: ['essen', 'küche', 'gastronomie', 'café'],

  design: ['kunst', 'gestaltung', 'grafik', 'ästhetik', 'branding'],
  kunst: ['design', 'malen', 'kreativität', 'ästhetik'],
  grafik: ['design', 'illustration', 'branding', 'logo'],
  branding: ['design', 'logo', 'marketing', 'marke'],

  musik: ['sound', 'komposition', 'instrument', 'rhythmus'],
  sound: ['musik', 'audio', 'klang'],

  programmieren: ['software', 'code', 'technik', 'app', 'entwicklung'],
  software: ['programmieren', 'app', 'technik', 'entwicklung'],
  technik: ['programmieren', 'software', 'motor', 'mechanik', 'innovation'],

  firma: ['business', 'unternehmen', 'gründung', 'geschäft'],
  business: ['firma', 'unternehmen', 'marketing', 'geschäft', 'strategie'],
  gründung: ['firma', 'business', 'startup', 'idee'],
  marketing: ['business', 'branding', 'kunden', 'werbung'],

  fitness: ['sport', 'training', 'gesundheit', 'bewegung'],
  sport: ['fitness', 'training', 'bewegung', 'wettkampf'],
  gesundheit: ['fitness', 'ernährung', 'wohlbefinden', 'sport'],
  ernährung: ['essen', 'gesundheit', 'kochen'],

  reisen: ['urlaub', 'abenteuer', 'mobilität', 'freizeit'],
  urlaub: ['reisen', 'freizeit', 'erholung'],

  schreiben: ['text', 'buch', 'geschichte', 'roman', 'content'],
  buch: ['schreiben', 'roman', 'geschichte', 'lesen'],
  roman: ['buch', 'schreiben', 'geschichte']
};

// Häufige deutsche Füllwörter, die für sich genommen keine inhaltliche Verbindung
// bedeuten (sonst würden z.B. zwei beliebige Sätze schon über "ich" oder "und" verbunden).
const STOPWORDS = new Set([
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mich', 'dich', 'uns', 'euch',
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'aber', 'doch', 'denn', 'also',
  'ist', 'sind', 'war', 'waren', 'sein', 'bin', 'bist', 'seid',
  'habe', 'hast', 'hat', 'haben', 'hatte', 'hatten',
  'will', 'willst', 'wollen', 'wollte', 'werde', 'wirst', 'wird', 'werden', 'würde',
  'kann', 'kannst', 'können', 'könnte', 'muss', 'musst', 'müssen', 'soll', 'sollst', 'sollen', 'sollte',
  'mit', 'bei', 'zu', 'zum', 'zur', 'auf', 'in', 'im', 'an', 'am', 'für', 'von', 'vom',
  'nach', 'über', 'unter', 'aus', 'als', 'wie', 'was', 'wer', 'wo', 'wann', 'warum',
  'nicht', 'auch', 'noch', 'nur', 'schon', 'mal', 'gerade', 'gern', 'gerne', 'sehr',
  'mein', 'meine', 'meinen', 'meinem', 'meiner', 'dein', 'deine',
  'thema', 'idee', 'name', 'namen', 'brauche', 'suche', 'mag', 'finde', 'komme', 'weiter',
  // Generische Gründungs-/Business-Begriffe: würden sonst z.B. "Café-Business" und
  // "Autopflege-Business" trivial verbinden, nur weil beide "business"/"aufbauen"
  // wörtlich enthalten — obwohl die eigentlichen Branchen nichts miteinander zu tun haben.
  'business', 'firma', 'unternehmen', 'aufbauen', 'aufgebaut', 'gründen', 'gegründet',
  'start', 'startup', 'geschäft', 'gewerbe', 'aufmachen', 'eröffnen', 'eröffnung'
]);

// Sehr einfache Endungs-Kappung (kein echter Lemmatizer, aber deckt die häufigsten
// deutschen Verb-/Nomen-Endungen ab), damit z.B. "kochen", "koche" und "gekocht"
// im Wörter-Baum auf denselben Ast treffen. Längere Endungen zuerst prüfen.
const STEM_SUFFIXES = ['ierungen', 'ierung', 'isierung', 'schaften', 'schaft', 'heiten', 'keiten', 'ieren', 'ierst', 'ieret', 'iere', 'iert', 'heit', 'keit', 'ung', 'est', 'en', 'er', 'te', 'ten', 'st', 'e'];

function stem(word) {
  for (const suf of STEM_SUFFIXES) {
    if (word.length - suf.length >= 3 && word.endsWith(suf)) {
      return word.slice(0, -suf.length);
    }
  }
  return word;
}

// Baut aus dem (von Hand geschriebenen, teils einseitigen) WORD_TREE eine
// beidseitige, gestemmte Version: wenn "uhr" auf "zeit" zeigt, funktioniert die
// Suche automatisch auch von "zeit" aus zu "uhr", ohne das doppelt eintragen zu müssen.
function buildSymmetricStemmedTree(tree) {
  const adjacency = {};
  const addEdge = (a, b) => {
    if (!adjacency[a]) adjacency[a] = new Set();
    if (a !== b) adjacency[a].add(b);
  };
  Object.entries(tree).forEach(([key, values]) => {
    const sKey = stem(key);
    values.forEach(value => {
      const sValue = stem(value);
      addEdge(sKey, sValue);
      addEdge(sValue, sKey);
    });
  });
  const result = {};
  Object.entries(adjacency).forEach(([k, set]) => { result[k] = Array.from(set); });
  return result;
}

const STEMMED_WORD_TREE = buildSymmetricStemmedTree(WORD_TREE);

// Zerlegt einen Text in einzelne, normalisierte, gestemmte Wörter und filtert
// Füllwörter heraus, damit nur inhaltlich tragende Begriffe für den Wörter-Baum-
// Vergleich übrig bleiben. Bindestriche werden als Trenner behandelt (z.B. "Kochtopf-Marke").
function tokenize(text) {
  return normalize(text)
    .replace(/[^a-zäöüßé\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

// Erweitert eine Wortliste um verwandte Begriffe aus dem Wörter-Baum, standardmäßig
// zwei Äste tief (z.B. Uhr -> Zeit -> Termin), damit auch mittelbare Verbindungen zählen.
function expandWithWordTree(words, depth = 2) {
  const result = new Set(words);
  let frontier = new Set(words);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    frontier.forEach(w => {
      (STEMMED_WORD_TREE[w] || []).forEach(rel => {
        if (!result.has(rel)) { result.add(rel); next.add(rel); }
      });
    });
    if (next.size === 0) break;
    frontier = next;
  }
  return result;
}

// Prüft, ob zwei Texte über den Wörter-Baum verbunden sind (z.B. "Uhr bauen" und
// "Thema Zeit" -> beide erweitert landen bei "zeit"). Gibt das verbindende Wort zurück
// oder null. Funktioniert komplett offline, ganz ohne API-Aufruf.
function findWordTreeConnection(textA, textB) {
  const expandedA = expandWithWordTree(tokenize(textA));
  const expandedB = expandWithWordTree(tokenize(textB));
  for (const word of expandedA) {
    if (expandedB.has(word)) return word;
  }
  return null;
}

function classifyWithKeywords(text) {
  const lower = normalize(text);
  const scored = Object.entries(FALLBACK_KEYWORD_REGEX)
    .map(([tag, regex]) => {
      const hits = lower.match(regex);
      return { tag, count: hits ? hits.length : 0 };
    })
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count);

  return scored.length ? scored.slice(0, 2).map(s => s.tag) : ['Sonstiges'];
}

async function classifyWithAI(text) {
  const prompt = `Ordne die folgende Aussage einer oder zwei der folgenden festen Kategorien zu. Wähle NUR aus dieser Liste, erfinde keine neuen Kategorien:
${TOPIC_TAGS.map(t => '- ' + t).join('\n')}

Aussage: "${text}"

Antworte AUSSCHLIESSLICH mit einem JSON-Array aus 1-2 Kategorie-Namen (exakt wie oben geschrieben), keine Einleitung, kein Markdown. Beispiel: ["Fahrzeuge & Mobilität"]`;

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    console.error('Themen-Erkennung: Anthropic API Fehler', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const raw = data.content && data.content[0] && data.content[0].text;
  if (!raw) return null;

  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    // nur Tags übernehmen, die wirklich aus unserer festen Liste stammen
    const valid = parsed.filter(t => TOPIC_TAGS.includes(t));
    return valid.length ? valid.slice(0, 2) : null;
  } catch (err) {
    return null;
  }
}

/**
 * Ordnet einen freien Text 1-2 breiten Themen-Clustern zu.
 * Nutzt Claude, wenn ein API-Key gesetzt ist, sonst eine Stichwort-Liste.
 * Ergebnisse werden gecacht, damit derselbe Text nicht zweimal angefragt wird.
 */
async function classifyTopic(text) {
  const key = normalize(text);
  if (!key) return ['Sonstiges'];
  if (cache.has(key)) return cache.get(key);

  let tags = null;
  if (ANTHROPIC_API_KEY) {
    try {
      tags = await classifyWithAI(text);
    } catch (err) {
      console.error('Themen-Erkennung fehlgeschlagen, nutze Stichwort-Fallback:', err.message);
    }
  }
  if (!tags) tags = classifyWithKeywords(text);

  if (cache.size >= MAX_CACHE_SIZE) cache.clear(); // simpler Schutz vor unbegrenztem Wachstum
  cache.set(key, tags);
  return tags;
}

// Cache für Paar-Vergleiche: "textA|||textB" (sortiert) -> true/false
const pairCache = new Map();
const MAX_PAIR_CACHE_SIZE = 5000;

function pairKey(textA, textB) {
  const a = normalize(textA);
  const b = normalize(textB);
  return a < b ? a + '|||' + b : b + '|||' + a;
}

/**
 * Bewertet, wie stark zwei freie Texte inhaltlich/assoziativ zusammenpassen —
 * als Prozentwert von 0 (keine Verbindung) bis 100 (praktisch dasselbe Thema),
 * statt nur ja/nein. Dadurch lässt sich bei mehreren Wartenden die BESTE
 * Übereinstimmung auswählen, statt einfach die erste zu nehmen, die irgendwie passt.
 *
 * Beispiel: "Ich will eine Uhr bauen" und "Idee zum Thema Zeit" bekommen einen hohen
 * Prozentwert, auch wenn sie in unterschiedliche feste Kategorien fallen würden.
 *
 * Nutzt Claude, wenn ein API-Key gesetzt ist. Ohne Key (oder bei fehlgeschlagenem
 * Aufruf) wird ein lokaler Näherungswert über den Wörter-Baum berechnet (Jaccard-
 * Ähnlichkeit der erweiterten Wortmengen) — gröber als die KI, aber immer noch
 * abgestuft statt nur ja/nein.
 */
async function computeAssociationScore(textA, textB) {
  if (!textA || !textB) return 0;
  const key = pairKey(textA, textB);
  if (pairCache.has(key)) return pairCache.get(key);

  let score = 0;
  let checkedWithAI = false;

  if (ANTHROPIC_API_KEY) {
    try {
      const prompt = `Zwei Personen auf einer Brainstorming-App haben unabhängig voneinander geschrieben, woran sie gerade denken:

Person A: "${textA}"
Person B: "${textB}"

Wie stark hängen diese beiden Aussagen thematisch/inhaltlich zusammen (auch über mehrere Ecken, z.B. gleicher Gegenstand, gleiches Konzept, gleiche Branche)?

WICHTIG: Zähle NUR echte fachliche/thematische Nähe (gleiches Themengebiet, gleiche Branche, gleicher Gegenstand). Zähle NICHT oberflächliche, strukturelle Ähnlichkeiten wie "beide gründen ein Unternehmen", "beide brauchen einen Namen", "beide sind kreative Ideen" oder "beide brauchen Kunden" — das sind keine echten Verbindungen.
Beispiel für eine ECHTE Verbindung: "Café eröffnen" und "Bäckerei eröffnen" (beide Gastronomie/Lebensmittel) -> hoher Wert.
Beispiel für KEINE Verbindung trotz oberflächlicher Ähnlichkeit: "Blumenladen eröffnen" und "Autowerkstatt eröffnen" (beide gründen zwar ein Geschäft, aber völlig unterschiedliche Branchen) -> niedriger Wert (unter 20).

Bewerte die Verbindung als Prozentzahl von 0 bis 100 (0 = überhaupt keine echte Verbindung, 100 = praktisch dasselbe Thema). Antworte AUSSCHLIESSLICH mit der Zahl, kein Prozentzeichen, kein weiterer Text.`;

      const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 10,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (res.ok) {
        const data = await res.json();
        const raw = (data.content && data.content[0] && data.content[0].text || '').trim();
        const parsed = parseInt(raw.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsed)) {
          score = Math.max(0, Math.min(100, parsed));
          checkedWithAI = true;
        }
      } else {
        console.error('Prozent-Bewertung: Anthropic API Fehler', res.status, await res.text());
      }
    } catch (err) {
      console.error('Prozent-Bewertung fehlgeschlagen:', err.message);
    }
  }

  // Ohne Key oder bei fehlgeschlagenem API-Aufruf: Jaccard-Ähnlichkeit über den
  // Wörter-Baum als grober, aber ebenfalls abgestufter Näherungswert.
  if (!checkedWithAI) {
    const setA = expandWithWordTree(tokenize(textA));
    const setB = expandWithWordTree(tokenize(textB));
    if (setA.size > 0 && setB.size > 0) {
      let intersectionSize = 0;
      setA.forEach(w => { if (setB.has(w)) intersectionSize++; });
      const unionSize = new Set([...setA, ...setB]).size;
      score = unionSize > 0 ? Math.round((intersectionSize / unionSize) * 100) : 0;
    }
  }

  if (pairCache.size >= MAX_PAIR_CACHE_SIZE) pairCache.clear();
  pairCache.set(key, score);
  return score;
}

module.exports = { classifyTopic, computeAssociationScore, findWordTreeConnection, TOPIC_TAGS };
