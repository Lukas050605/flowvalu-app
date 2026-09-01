const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const { fetchWithTimeout } = require('./fetch-with-timeout');

// Aufweck-Wörter, mit denen man "Valu" im Call direkt ansprechen kann. Bewusst mehrere
// Varianten, weil Live-Spracherkennung oft ungenau ist (z.B. "Falu" statt "Valu").
const WAKE_WORDS = ['valu', 'falu', 'flowvalu', 'flow valu'];

/**
 * Prüft, ob ein neu transkribierter Satz Valu direkt anspricht.
 */
function isAddressedToValu(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return WAKE_WORDS.some(w => lower.includes(w));
}

/**
 * Generiert Valus Antwort auf eine direkte Frage/Ansprache im Call.
 * Bezieht sich auf das bisherige Gespräch UND (falls vorhanden) auf Wissens-Schnipsel
 * aus Mentor-Reels, die zum Thema passen — das ist der Baustein, mit dem Valu
 * "aus Mentor-Videos lernt": echte Inhalte fließen als Kontext mit ein, statt dass
 * irgendwo im Hintergrund ein Modell neu trainiert wird.
 * Gibt bei fehlendem Key/Fehler eine ehrliche Ausweich-Antwort zurück, nie null.
 */
async function generateValuAnswer({ transcriptText, question, hangups, participantNames, knowledgeSnippets }) {
  const fallback = 'Entschuldigt, da bin ich mir gerade nicht sicher — sprecht gerne weiter, ich hör weiter zu.';
  if (!ANTHROPIC_API_KEY) return fallback;

  try {
    const hangupContext = (hangups || []).filter(Boolean)
      .map((h, i) => (participantNames[i] || 'Person') + ' hängt an: "' + h + '"')
      .join('\n');

    const knowledgeBlock = (knowledgeSnippets || []).length
      ? `\nDinge, die Mentoren in ihren Reels dazu schon geteilt haben (nutze sie, wenn sie wirklich passen — nicht erzwingen):\n${knowledgeSnippets.map(k => '- ' + k).join('\n')}\n`
      : '';

    const prompt = `Du bist "Valu", die KI-Assistentin von FlowValu — einer App, die Menschen mit Denkblockaden zum gemeinsamen Brainstorming verbindet. Du bist gerade in einem Video-Call zwischen ${(participantNames || []).join(' und ')} und wurdest direkt angesprochen.

Ausgangslage:
${hangupContext || '(keine Angabe)'}
${knowledgeBlock}
Bisheriges Gespräch:
"""
${transcriptText || '(noch nichts gesagt)'}
"""

Der letzte Satz, mit dem du angesprochen wurdest: "${question}"

Antworte als Valu — freundlich, direkt, wie eine echte, kompetente Gesprächsteilnehmerin, NICHT wie ein Chatbot mit Floskeln. Max. 3 Sätze. Wenn die Frage nicht eindeutig ist oder du nichts Sinnvolles beitragen kannst, sag das ehrlich, statt etwas zu erfinden. Antworte AUSSCHLIESSLICH mit dem, was du sagen würdest — keine Anführungszeichen, keine Meta-Kommentare.`;

    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.error('Valu-Antwort: Anthropic API Fehler', res.status, await res.text());
      return fallback;
    }
    const data = await res.json();
    const raw = data.content && data.content[0] && data.content[0].text;
    const cleaned = raw && raw.trim().replace(/^["']|["']$/g, '');
    return cleaned || fallback;
  } catch (err) {
    console.error('Valu-Antwort fehlgeschlagen:', err.message);
    return fallback;
  }
}

/**
 * Generiert Valus Antwort in einem EIGENSTÄNDIGEN Chat (nicht im Call) — man kann
 * sie jederzeit über das eigene Icon fragen, unabhängig davon, ob man gerade
 * gematcht ist. Nutzt den bisherigen Chat-Verlauf mit Valu statt eines Call-
 * Transkripts, und kann optional die eigene aktuelle Blockade + Mentor-Wissen
 * mit einbeziehen.
 */
async function generateValuChatAnswer({ conversationHistory, question, userHangup, displayName, knowledgeSnippets }) {
  const fallback = 'Entschuldige, da bin ich mir gerade nicht sicher — magst du das nochmal anders formulieren?';
  if (!ANTHROPIC_API_KEY) return fallback;

  try {
    const historyBlock = (conversationHistory || []).length
      ? conversationHistory.slice(-10).map(m => (m.role === 'user' ? (displayName || 'Nutzer') : 'Valu') + ': ' + m.text).join('\n')
      : '(noch kein bisheriges Gespräch)';

    const knowledgeBlock = (knowledgeSnippets || []).length
      ? `\nDinge, die Mentoren in ihren Reels dazu schon geteilt haben (nutze sie, wenn sie wirklich passen — nicht erzwingen):\n${knowledgeSnippets.map(k => '- ' + k).join('\n')}\n`
      : '';

    const prompt = `Du bist "Valu", die KI-Assistentin von FlowValu — einer App, die Menschen mit Denkblockaden zum gemeinsamen Brainstorming verbindet. ${displayName || 'Jemand'} schreibt dir gerade direkt im Chat (nicht in einem Call mit einer anderen Person).

${userHangup ? 'Woran die Person gerade hängt: "' + userHangup + '"' : ''}
${knowledgeBlock}
Bisheriger Chat-Verlauf mit dir:
"""
${historyBlock}
"""

Neue Nachricht: "${question}"

Antworte als Valu — freundlich, direkt, wie eine echte, kompetente Gesprächspartnerin, NICHT wie ein Chatbot mit Floskeln. Max. 4 Sätze. Wenn du etwas nicht weißt, sag das ehrlich, statt es zu erfinden. Antworte AUSSCHLIESSLICH mit dem, was du sagen würdest — keine Anführungszeichen, keine Meta-Kommentare.`;

    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      console.error('Valu-Chat: Anthropic API Fehler', res.status, await res.text());
      return fallback;
    }
    const data = await res.json();
    const raw = data.content && data.content[0] && data.content[0].text;
    const cleaned = raw && raw.trim().replace(/^["']|["']$/g, '');
    return cleaned || fallback;
  } catch (err) {
    console.error('Valu-Chat fehlgeschlagen:', err.message);
    return fallback;
  }
}

module.exports = { isAddressedToValu, generateValuAnswer, generateValuChatAnswer, WAKE_WORDS };
