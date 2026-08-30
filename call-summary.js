const PDFDocument = require('pdfkit');
const { fetchWithTimeout } = require('./fetch-with-timeout');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Ruft Claude auf und bittet um eine strukturierte JSON-Antwort.
 * Gibt bei Erfolg { summary, ideas: [], actionItems: [] } zurück, sonst null.
 */
async function callClaudeForStructuredSummary(transcriptText, participantNames) {
  const prompt = `Hier ist das Protokoll eines Gesprächs zwischen ${participantNames.join(' und ')} auf FlowValu, einer App, die Menschen mit Denkblockaden verbindet.

Transkript:
"""
${transcriptText}
"""

Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt (keine Einleitung, kein Markdown, keine Code-Blöcke) in genau diesem Format:
{
  "summary": "2-3 Sätze, worum es im Gespräch ging",
  "ideas": ["Idee 1", "Idee 2", ...],
  "actionItems": ["Konkreter nächster Schritt 1", "Konkreter nächster Schritt 2", ...]
}

Lass "ideas" oder "actionItems" als leeres Array [], wenn dazu nichts Konkretes im Gespräch vorkam.`;

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    console.error('Anthropic API Fehler:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text = data.content && data.content[0] && data.content[0].text;
  return parseStructuredSummary(text);
}

/**
 * Parst die von Claude zurückgegebene Antwort in ein sauberes Objekt.
 * Exportiert, damit sich diese Logik unabhängig vom echten API-Aufruf testen lässt.
 */
function parseStructuredSummary(rawText) {
  if (!rawText) return null;
  try {
    // Falls die KI trotz Anweisung Markdown-Codeblöcke drumrum baut, diese entfernen
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || '',
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : []
    };
  } catch (err) {
    // Kein gültiges JSON — als Fließtext-Zusammenfassung ohne Struktur behandeln
    return { summary: rawText.trim(), ideas: [], actionItems: [] };
  }
}

/**
 * Fasst ein Transkript mit Claude zusammen. Gibt null zurück, wenn kein API-Key
 * gesetzt ist oder der Aufruf fehlschlägt — der Aufrufer soll dann auf das rohe
 * Transkript zurückfallen.
 */
async function summarizeWithAI(transcriptText, participantNames) {
  if (!ANTHROPIC_API_KEY) {
    console.log('⚠️  ANTHROPIC_API_KEY nicht gesetzt — PDF enthält nur das rohe Protokoll, keine KI-Zusammenfassung.');
    return null;
  }
  try {
    return await callClaudeForStructuredSummary(transcriptText, participantNames);
  } catch (err) {
    console.error('KI-Zusammenfassung fehlgeschlagen:', err.message);
    return null;
  }
}

/**
 * Whisper-Fallback: transkribiert eine Audiodatei (Buffer, z. B. webm/opus) zu Text.
 * Für Browser ohne eingebaute Live-Spracherkennung (Firefox, Safari).
 * Gibt null zurück, wenn kein Key gesetzt ist oder der Aufruf fehlschlägt.
 */
async function transcribeAudioFallback(audioBuffer) {
  if (!OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY nicht gesetzt — Audio-Fallback-Transkription übersprungen.');
    return null;
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'de');

    const res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
      body: form
    }, 20000); // Audio-Upload braucht länger als eine normale Textanfrage

    if (!res.ok) {
      console.error('Whisper API Fehler:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.text || null;
  } catch (err) {
    console.error('Audio-Fallback-Transkription fehlgeschlagen:', err.message);
    return null;
  }
}

/**
 * Baut das PDF-Dokument und gibt es als Buffer zurück.
 * aiSummary ist entweder null oder { summary, ideas: [], actionItems: [] }.
 */
function buildPdf({ participantNames, startedAt, aiSummary, transcript }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#4c3fb0').text('FlowValu — Call-Zusammenfassung', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#666').text(
      'Zwischen ' + participantNames.join(' und ') + '  ·  ' + new Date(startedAt).toLocaleString('de-DE')
    );
    doc.moveDown(1.2);

    if (aiSummary && aiSummary.summary) {
      doc.fontSize(14).fillColor('#111').text('Zusammenfassung', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#222').text(aiSummary.summary, { align: 'left' });
      doc.moveDown(0.8);

      if (aiSummary.ideas && aiSummary.ideas.length) {
        doc.fontSize(12).fillColor('#111').text('Ideen');
        doc.moveDown(0.3);
        aiSummary.ideas.forEach(idea => {
          doc.fontSize(10.5).fillColor('#222').text('•  ' + idea);
        });
        doc.moveDown(0.7);
      }

      if (aiSummary.actionItems && aiSummary.actionItems.length) {
        doc.fontSize(12).fillColor('#111').text('Nächste Schritte');
        doc.moveDown(0.3);
        aiSummary.actionItems.forEach(item => {
          doc.fontSize(10.5).fillColor('#222').text('[ ]  ' + item);
        });
        doc.moveDown(0.7);
      }
      doc.moveDown(0.5);
    } else {
      doc.fontSize(10).fillColor('#999').text('(Keine KI-Zusammenfassung verfügbar — hier das vollständige Protokoll.)');
      doc.moveDown(1);
    }

    doc.fontSize(14).fillColor('#111').text('Vollständiges Protokoll', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(9.5).fillColor('#333');
    if (transcript.length === 0) {
      doc.text('Kein Protokoll aufgezeichnet (Spracherkennung war evtl. nicht verfügbar oder aus).');
    } else {
      transcript.forEach(seg => {
        doc.fillColor('#7c6ff0').text(seg.speakerLabel + ':', { continued: true }).fillColor('#333').text(' ' + seg.text);
      });
    }

    doc.end();
  });
}

module.exports = { summarizeWithAI, buildPdf, parseStructuredSummary, transcribeAudioFallback };
