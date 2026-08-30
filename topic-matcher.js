const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
// Aufruf fehlschlägt. Bewusst grob gehalten, deckt aber die Alltagsfälle ab.
const FALLBACK_KEYWORDS = {
  'Fahrzeuge & Mobilität': ['auto', 'kfz', 'werkstatt', 'motorrad', 'fahrzeug', 'reifen', 'verkehr', 'lkw', 'e-auto'],
  'Landwirtschaft & Natur': ['landwirtschaft', 'bauernhof', 'blumen', 'garten', 'pflanze', 'acker', 'feld', 'tiere', 'natur'],
  'Essen & Kulinarik': ['kochen', 'koch', 'backen', 'café', 'restaurant', 'rezept', 'küche', 'essen', 'gastro', 'topf'],
  'Mode & Beauty': ['mode', 'kleidung', 'style', 'beauty', 'kosmetik', 'schmuck', 'friseur'],
  'Musik & Audio': ['musik', 'song', 'podcast', 'band', 'beat', 'sound', 'instrument'],
  'Kunst & Design': ['design', 'kunst', 'malen', 'illustration', 'grafik', 'logo', 'zeichnen'],
  'Software & Tech': ['app', 'software', 'code', 'programmier', 'website', 'ki ', 'tech', 'game'],
  'Business & Gründung': ['firma', 'startup', 'gründ', 'business', 'marketing', 'unternehmen', 'kunden'],
  'Handwerk & Bauen': ['bauen', 'handwerk', 'möbel', 'werkstatt', 'diy', 'reparatur', 'holz'],
  'Gesundheit & Wohlbefinden': ['fitness', 'ernährung', 'gesundheit', 'sport', 'yoga', 'wellness'],
  'Bildung & Wissen': ['lernen', 'schule', 'uni', 'studium', 'wissenschaft', 'kurs'],
  'Reisen & Freizeit': ['reisen', 'urlaub', 'abenteuer', 'hobby', 'ausflug'],
  'Schreiben & Medien': ['schreiben', 'buch', 'text', 'film', 'video', 'content', 'roman']
};

// Cache: normalisierter Text -> Tags. Verhindert wiederholte API-Calls für identische
// Eingaben. Bewusst simpel gehalten (kein Limit nötig, da Prozess bei Redeploy eh neu startet).
const cache = new Map();
const MAX_CACHE_SIZE = 2000;

function normalize(text) {
  return String(text || '').trim().toLowerCase().slice(0, 300);
}

function classifyWithKeywords(text) {
  const lower = normalize(text);
  const matches = [];
  for (const [tag, words] of Object.entries(FALLBACK_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) matches.push(tag);
  }
  return matches.length ? matches.slice(0, 2) : ['Sonstiges'];
}

async function classifyWithAI(text) {
  const prompt = `Ordne die folgende Aussage einer oder zwei der folgenden festen Kategorien zu. Wähle NUR aus dieser Liste, erfinde keine neuen Kategorien:
${TOPIC_TAGS.map(t => '- ' + t).join('\n')}

Aussage: "${text}"

Antworte AUSSCHLIESSLICH mit einem JSON-Array aus 1-2 Kategorie-Namen (exakt wie oben geschrieben), keine Einleitung, kein Markdown. Beispiel: ["Fahrzeuge & Mobilität"]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
 * Prüft per Claude, ob zwei freie Texte inhaltlich/assoziativ zusammenpassen könnten
 * — auch wenn sie in unterschiedliche feste Kategorien fallen würden.
 * Beispiel: "Ich will eine Uhr bauen" und "Idee zum Thema Zeit" sind verwandt,
 * auch wenn eines "Handwerk" und das andere "Sonstiges" wäre.
 * Gibt false zurück, wenn kein API-Key gesetzt ist oder der Aufruf fehlschlägt
 * (dann greift nur noch das grobe Kategorie-Matching).
 */
async function areAssociativelyRelated(textA, textB) {
  if (!textA || !textB) return false;
  const key = pairKey(textA, textB);
  if (pairCache.has(key)) return pairCache.get(key);

  let result = false;
  if (ANTHROPIC_API_KEY) {
    try {
      const prompt = `Zwei Personen auf einer Brainstorming-App haben unabhängig voneinander geschrieben, woran sie gerade denken:

Person A: "${textA}"
Person B: "${textB}"

Gibt es eine inhaltliche, assoziative oder thematische Verbindung zwischen beiden Aussagen (auch über mehrere Ecken, z.B. gleicher Gegenstand, gleiches Konzept, gleiche Branche)? Antworte AUSSCHLIESSLICH mit "ja" oder "nein", kein weiterer Text.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
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
        const raw = (data.content && data.content[0] && data.content[0].text || '').trim().toLowerCase();
        result = raw.startsWith('ja');
      } else {
        console.error('Assoziativ-Check: Anthropic API Fehler', res.status, await res.text());
      }
    } catch (err) {
      console.error('Assoziativ-Check fehlgeschlagen:', err.message);
    }
  }

  if (pairCache.size >= MAX_PAIR_CACHE_SIZE) pairCache.clear();
  pairCache.set(key, result);
  return result;
}

module.exports = { classifyTopic, areAssociativelyRelated, TOPIC_TAGS };
