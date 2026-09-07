const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { fetchWithTimeout } = require('./fetch-with-timeout');

/**
 * Fasst die echten Call-Zusammenfassungen einer Woche zu "Deine Woche mit
 * FlowValu" zusammen (Thema 5): wichtige Ideen, wiederkehrende Themen, offene
 * Punkte, nächste Schritte — abgeleitet aus dem, was wirklich besprochen wurde.
 * Gibt bei fehlendem Key/Fehler null zurück statt etwas zu erfinden — der Aufrufer
 * zeigt dann die Rohdaten (Ideen-/Aufgaben-Liste) ohne KI-Synthese an.
 */
async function buildWeeklyRecap(summaries, displayName) {
  if (!ANTHROPIC_API_KEY || !summaries.length) return null;

  try {
    const allIdeas = summaries.flatMap(s => s.ideas);
    const allActionItems = summaries.flatMap(s => s.actionItems);
    const callTexts = summaries.map((s, i) => `Call ${i + 1}: ${s.summary}`).join('\n\n');

    const prompt = `Hier sind die echten Zusammenfassungen aller Calls, die ${displayName || 'diese Person'} in den letzten 7 Tagen auf FlowValu hatte (einer App zum gemeinsamen Brainstorming bei Denkblockaden).

Call-Zusammenfassungen:
"""
${callTexts}
"""

Bisherige Ideen aus diesen Calls: ${allIdeas.length ? allIdeas.join('; ') : '(keine notiert)'}
Bisherige nächste Schritte: ${allActionItems.length ? allActionItems.join('; ') : '(keine notiert)'}

Erstelle einen kurzen, persönlichen Wochenrückblick mit GENAU diesen 4 Abschnitten:
1. Wichtigste Ideen der Woche (max. 3, nur wirklich Erwähntes)
2. Wiederkehrende Themen (Muster über mehrere Calls hinweg, falls erkennbar — sonst "Noch kein klares Muster erkennbar")
3. Offene Punkte (was noch unklar/ungelöst wirkt)
4. Nächste Schritte (konkret, aus den Calls abgeleitet)

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in diesem Format, keine Einleitung, kein Markdown:
{"topIdeas": ["..."], "recurringThemes": "...", "openPoints": ["..."], "nextSteps": ["..."]}`;

    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.error('Wochenrückblick: Anthropic API Fehler', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const raw = data.content && data.content[0] && data.content[0].text;
    if (!raw) return null;

    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Wochenrückblick fehlgeschlagen:', err.message);
    return null;
  }
}

module.exports = { buildWeeklyRecap };
