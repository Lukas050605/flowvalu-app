const PDFDocument = require('pdfkit');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Fasst ein Transkript mit Claude zu Ideen/Kernpunkten zusammen.
 * Gibt null zurück, wenn kein API-Key gesetzt ist oder der Aufruf fehlschlägt —
 * der Aufrufer soll dann auf das rohe Transkript zurückfallen.
 */
async function summarizeWithAI(transcriptText, participantNames) {
  if (!ANTHROPIC_API_KEY) {
    console.log('⚠️  ANTHROPIC_API_KEY nicht gesetzt — PDF enthält nur das rohe Protokoll, keine KI-Zusammenfassung.');
    return null;
  }

  const prompt = `Hier ist das Protokoll eines Gesprächs zwischen ${participantNames.join(' und ')} auf FlowValu, einer App, die Menschen mit Denkblockaden verbindet.

Transkript:
"""
${transcriptText}
"""

Fasse in klarem Deutsch zusammen:
1. Worum es in dem Gespräch ging (2-3 Sätze)
2. Die wichtigsten Ideen, die aufkamen (als Liste)
3. Konkrete nächste Schritte, falls welche genannt wurden (als Liste, sonst weglassen)

Antworte NUR mit der Zusammenfassung in diesem Format, ohne Einleitung oder Meta-Kommentar.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
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
    return text || null;
  } catch (err) {
    console.error('KI-Zusammenfassung fehlgeschlagen:', err.message);
    return null;
  }
}

/**
 * Baut das PDF-Dokument und gibt es als Buffer zurück.
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

    if (aiSummary) {
      doc.fontSize(14).fillColor('#111').text('Zusammenfassung', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#222').text(aiSummary, { align: 'left' });
      doc.moveDown(1.2);
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

module.exports = { summarizeWithAI, buildPdf };
