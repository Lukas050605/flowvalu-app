const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { fetchWithTimeout } = require('./fetch-with-timeout');

// Generische Impulse als Fallback, falls kein API-Key gesetzt ist oder der Call fehlschlägt.
// Bewusst allgemein gehalten, damit sie zu praktisch jeder Denkblockade passen.
const GENERIC_IMPULSES = [
  'Was wäre die verrückteste, "völlig falsche" Idee, die euch gerade einfällt?',
  'Wenn Zeit und Geld keine Rolle spielen würden — was würdet ihr sofort ausprobieren?',
  'Was würde ein Kind dazu sagen, wenn es das Problem hören würde?',
  'Gibt es etwas an der Idee, das ihr komplett weglassen könntet?',
  'Was hat in einer ganz anderen Branche schon funktioniert und könnte hier passen?',
  'Was wäre das genaue Gegenteil von dem, was ihr bisher überlegt habt?',
  'Wenn ihr nur einen einzigen Satz behalten dürftet — welcher wäre das?'
];

function randomGenericImpulse() {
  return GENERIC_IMPULSES[Math.floor(Math.random() * GENERIC_IMPULSES.length)];
}

/**
 * Generiert einen kurzen, konkreten Impuls, um ein ins Stocken geratenes
 * Brainstorming-Gespräch wieder in Gang zu bringen.
 * Nutzt den bisherigen Gesprächsverlauf + die ursprünglichen Denkblockaden beider
 * Personen als Kontext. Fällt auf einen generischen Impuls zurück, wenn kein
 * API-Key gesetzt ist oder der Aufruf fehlschlägt — die Funktion liefert also nie null.
 */
async function generateImpulse({ transcriptText, hangups, participantNames }) {
  if (!ANTHROPIC_API_KEY) return randomGenericImpulse();

  try {
    const hangupContext = (hangups || []).filter(Boolean).map((h, i) => (participantNames[i] || 'Person') + ' hängt an: "' + h + '"').join('\n');

    const prompt = `Zwei Personen (${(participantNames || []).join(' und ')}) sind in einem Video-Call auf FlowValu, einer App, die Menschen mit kreativen Denkblockaden zum gemeinsamen Brainstorming verbindet. Das Gespräch stockt gerade — es herrscht seit einer Weile Stille oder es kommt nicht voran.

Ursprüngliche Blockaden:
${hangupContext || '(keine Angabe)'}

Bisheriger Gesprächsausschnitt:
"""
${transcriptText || '(noch nichts gesagt)'}
"""

Formuliere EINEN kurzen, konkreten Impuls (max. 2 Sätze) auf Deutsch, der das Gespräch wieder in Gang bringt. Kein Small Talk, keine Floskeln wie "Wie geht's euch" — eine echte inhaltliche Frage oder ein Denkanstoß, der zum Thema passt. Antworte AUSSCHLIESSLICH mit dem Impuls selbst, keine Einleitung, keine Anführungszeichen.`;

    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.error('Impuls-Generierung: Anthropic API Fehler', res.status, await res.text());
      return randomGenericImpulse();
    }

    const data = await res.json();
    const raw = data.content && data.content[0] && data.content[0].text;
    const cleaned = raw && raw.trim().replace(/^["']|["']$/g, '');
    return cleaned || randomGenericImpulse();
  } catch (err) {
    console.error('Impuls-Generierung fehlgeschlagen:', err.message);
    return randomGenericImpulse();
  }
}

module.exports = { generateImpulse };
