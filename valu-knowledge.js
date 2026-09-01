const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { fetchWithTimeout } = require('./fetch-with-timeout');

/**
 * Liest ein Mentor-Video-Transkript und extrahiert 2-5 knappe, eigenständige
 * Tipps/Erkenntnisse daraus — das ist der Baustein, mit dem Valu "aus Mentor-Videos
 * lernt": kein Modell-Training, sondern eine wachsende, durchsuchbare Wissensbasis
 * aus echten Inhalten, die später in Impulse/Antworten einfließen kann.
 * Gibt ein leeres Array zurück, wenn kein Key gesetzt ist oder nichts Verwertbares
 * im Transkript steht — erfindet nie Inhalte.
 */
async function extractKnowledgeFromTranscript(transcriptText, reelTitle) {
  if (!ANTHROPIC_API_KEY || !transcriptText || !transcriptText.trim()) return [];

  try {
    const prompt = `Hier ist die Abschrift eines kurzen Video-Tipps ("Reel") eines Mentors auf FlowValu${reelTitle ? ' mit dem Titel "' + reelTitle + '"' : ''}.

Abschrift:
"""
${transcriptText}
"""

Extrahiere 2 bis 5 knappe, EIGENSTÄNDIGE Tipps oder Erkenntnisse aus dem Video — jeder Punkt muss für sich verständlich sein, auch ohne das ganze Video gesehen zu haben. Nur echte, konkrete Inhalte — keine Füllsätze wie "das war interessant". Wenn im Transkript nichts Verwertbares steht (z.B. nur Begrüßung, kein Inhalt), gib ein leeres Array zurück.

Antworte AUSSCHLIESSLICH mit einem JSON-Array aus Strings, keine Einleitung, kein Markdown. Beispiel: ["Tipp 1", "Tipp 2"]`;

    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.error('Wissens-Extraktion: Anthropic API Fehler', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    const raw = data.content && data.content[0] && data.content[0].text;
    if (!raw) return [];

    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : [];
  } catch (err) {
    console.error('Wissens-Extraktion fehlgeschlagen:', err.message);
    return [];
  }
}

module.exports = { extractKnowledgeFromTranscript };
