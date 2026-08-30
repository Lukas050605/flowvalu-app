const PDFDocument = require('pdfkit');
const { fetchWithTimeout } = require('./fetch-with-timeout');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Ruft Claude auf und bittet um eine strukturierte JSON-Antwort.
 * Gibt bei Erfolg { summary, ideas: [], actionItems: [], aiSolutions: [] } zurück, sonst null.
 */
async function callClaudeForStructuredSummary(transcriptText, participantNames, hangups) {
  const hangupContext = (hangups || []).filter(Boolean)
    .map((h, i) => (participantNames[i] || 'Person') + ' hing ursprünglich an: "' + h + '"')
    .join('\n');

  const prompt = `Hier ist das Protokoll eines Gesprächs zwischen ${participantNames.join(' und ')} auf FlowValu, einer App, die Menschen mit Denkblockaden verbindet.

Ursprüngliche Denkblockaden, mit denen die Personen in den Call gegangen sind:
${hangupContext || '(keine Angabe)'}

Transkript:
"""
${transcriptText}
"""

Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt (keine Einleitung, kein Markdown, keine Code-Blöcke) in genau diesem Format:
{
  "summary": "2-3 Sätze, worum es im Gespräch ging",
  "ideas": ["Idee 1 aus dem Gespräch", "Idee 2 aus dem Gespräch", ...],
  "actionItems": ["Konkreter nächster Schritt 1", "Konkreter nächster Schritt 2", ...],
  "aiSolutions": ["Eigener, konkreter Lösungsvorschlag 1 für die ursprüngliche(n) Blockade(n)", "Vorschlag 2", ...]
}

Wichtig zu "aiSolutions": Das sind DEINE EIGENEN, zusätzlichen Vorschläge, um die ursprüngliche(n) Denkblockade(n) zu lösen — nicht nur eine Wiederholung dessen, was im Gespräch schon gesagt wurde. Nutze dein eigenes Wissen, um 2-4 konkrete, umsetzbare Lösungsansätze zu ergänzen, die im Gespräch noch nicht (oder nur am Rande) vorkamen. Beziehe dich klar auf die ursprüngliche Blockade.

Lass "ideas", "actionItems" oder "aiSolutions" als leeres Array [], wenn dazu wirklich nichts Sinnvolles beizutragen ist.`;

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
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
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      aiSolutions: Array.isArray(parsed.aiSolutions) ? parsed.aiSolutions : []
    };
  } catch (err) {
    // Kein gültiges JSON — als Fließtext-Zusammenfassung ohne Struktur behandeln
    return { summary: rawText.trim(), ideas: [], actionItems: [], aiSolutions: [] };
  }
}

/**
 * Fasst ein Transkript mit Claude zusammen. Gibt null zurück, wenn kein API-Key
 * gesetzt ist oder der Aufruf fehlschlägt — der Aufrufer soll dann auf das rohe
 * Transkript zurückfallen.
 */
async function summarizeWithAI(transcriptText, participantNames, hangups) {
  if (!ANTHROPIC_API_KEY) {
    console.log('⚠️  ANTHROPIC_API_KEY nicht gesetzt — PDF enthält nur das rohe Protokoll, keine KI-Zusammenfassung.');
    return null;
  }
  try {
    return await callClaudeForStructuredSummary(transcriptText, participantNames, hangups);
  } catch (err) {
    console.error('KI-Zusammenfassung fehlgeschlagen:', err.message);
    return null;
  }
}

// Bekannte Phrasen, die Whisper bei Stille oder kaputten Audiodateien manchmal "halluziniert"
// (erfindet), obwohl gar nichts Verständliches zu hören war. Kommt so ein Text zurück,
// behandeln wir das wie "nichts transkribiert", statt es als echte Aussage zu übernehmen.
const WHISPER_HALLUCINATION_PATTERNS = [
  /kein\s*mikrofon/i,
  /untertitel(ung)?\s*durch/i,
  /vielen\s*dank\s*(fürs?)?\s*zuschauen/i,
  /copyright/i,
  /www\.[a-z0-9-]+\.[a-z]{2,}/i,
  /amara\.org/i,
  /^\s*$/,
];

function looksLikeWhisperHallucination(text) {
  return WHISPER_HALLUCINATION_PATTERNS.some(pattern => pattern.test(text));
}

// Ordnet einem MIME-Type die passende Dateiendung für den Whisper-Upload zu — wichtig,
// weil Whisper das Format anhand der Dateiendung erkennt, nicht (nur) am MIME-Type.
function extensionForMimeType(mimeType) {
  const type = (mimeType || '').toLowerCase();
  if (type.includes('mp4') || type.includes('m4a')) return 'mp4';
  if (type.includes('aac')) return 'aac';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  return 'webm'; // Standard-Fallback (Chrome/Firefox)
}

/**
 * Whisper-Fallback: transkribiert eine Audiodatei (Buffer) zu Text.
 * Für Browser ohne eingebaute Live-Spracherkennung (Firefox, Safari/iOS).
 * mimeType kommt vom Frontend, da unterschiedliche Browser unterschiedliche Formate
 * aufnehmen (z.B. Safari/iOS: audio/mp4 statt audio/webm) — ohne das korrekte Format
 * an Whisper weiterzureichen, kam es zu Fehldekodierungen und "halluzinierten" Texten.
 * Gibt null zurück, wenn kein Key gesetzt ist, der Aufruf fehlschlägt, oder der
 * zurückgegebene Text wie eine bekannte Whisper-Halluzination aussieht.
 */
async function transcribeAudioFallback(audioBuffer, mimeType) {
  if (!OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY nicht gesetzt — Audio-Fallback-Transkription übersprungen.');
    return null;
  }
  try {
    const ext = extensionForMimeType(mimeType);
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/webm' }), 'audio.' + ext);
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
    const text = data.text || null;
    if (text && looksLikeWhisperHallucination(text)) {
      console.log('⚠️  Whisper-Ausgabe sieht nach Halluzination aus, wird verworfen:', text);
      return null;
    }
    return text;
  } catch (err) {
    console.error('Audio-Fallback-Transkription fehlgeschlagen:', err.message);
    return null;
  }
}

/**
 * Baut das PDF-Dokument und gibt es als Buffer zurück.
 * aiSummary ist entweder null oder { summary, ideas: [], actionItems: [], aiSolutions: [] }.
 *
 * Design: Farbverlauf-Header im FlowValu-Look (passend zur App: lila -> blau),
 * gezeichnete Icons/Bullets statt reiner Text-Symbole, farbig markierte Abschnitte
 * (Zusammenfassung / KI-Lösungsvorschläge / Ideen / Nächste Schritte / Protokoll),
 * Fußzeile mit Branding + Seitenzahl auf jeder Seite.
 */
function buildPdf({ participantNames, startedAt, aiSummary, transcript }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Farbpalette passend zum App-Design (dunkles Theme mit Lila/Blau-Verlauf)
    const ACCENT = '#7c6ff0';
    const ACCENT2 = '#4c8dff';
    const INK = '#1f1b2e';
    const MUTED = '#7a758c';
    const LINE = '#e7e4f5';
    const AMBER = '#f5a524';
    const GREEN = '#22c55e';

    const PAGE_W = doc.page.width;
    const MARGIN = 50;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ---------- Kopfzeile (nur erste Seite): Farbverlauf-Banner im App-Look ----------
    function drawHeader() {
      const grad = doc.linearGradient(0, 0, PAGE_W, 0);
      grad.stop(0, ACCENT).stop(1, ACCENT2);
      doc.rect(0, 0, PAGE_W, 108).fill(grad);

      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(23).text('FlowValu', MARGIN, 30);
      doc.font('Helvetica').fontSize(10.5).fillColor('#ffffff', 0.9)
        .text('Call-Zusammenfassung', MARGIN, 58);
      doc.fontSize(9.5).fillColor('#ffffff', 0.75)
        .text(participantNames.join(' & ') + '   ·   ' + new Date(startedAt).toLocaleString('de-DE'), MARGIN, 76);

      doc.y = 130;
    }

    // ---------- Fußzeile auf jeder Seite: Branding + Seitenzahl ----------
    function drawFooter(pageNumber, totalPages) {
      const y = doc.page.height - 40;
      doc.moveTo(MARGIN, y - 8).lineTo(PAGE_W - MARGIN, y - 8).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('FlowValu · flowvalu-app.onrender.com', MARGIN, y, { continued: false });
      doc.fontSize(8).fillColor(MUTED)
        .text('Seite ' + pageNumber + ' / ' + totalPages, MARGIN, y, { width: CONTENT_W, align: 'right' });
    }

    // Kleines gefülltes Quadrat als Abschnitts-Icon (echte Emoji sind in Standard-PDF-Fonts nicht darstellbar)
    function sectionHeader(label, color) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.5);
      const y = doc.y;
      doc.roundedRect(MARGIN, y + 1, 12, 12, 3).fill(color);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(label, MARGIN + 20, y - 1);
      doc.moveDown(0.5);
    }

    // Bullet-Punkt mit farbigem Kreis statt "•"-Zeichen
    function bulletItem(text, color) {
      const y = doc.y + 3;
      doc.circle(MARGIN + 5, y, 3).fill(color);
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(text, MARGIN + 16, doc.y, { width: CONTENT_W - 16 });
      doc.moveDown(0.25);
    }

    // Action-Item mit echt gezeichneter Checkbox statt "[ ]"-Text
    function checkboxItem(text) {
      const y = doc.y + 1;
      doc.roundedRect(MARGIN, y, 10, 10, 2).lineWidth(1).strokeColor(ACCENT2).stroke();
      doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(text, MARGIN + 18, doc.y - 1, { width: CONTENT_W - 18 });
      doc.moveDown(0.3);
    }

    drawHeader();

    if (aiSummary && aiSummary.summary) {
      sectionHeader('Zusammenfassung', ACCENT);
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(aiSummary.summary, MARGIN, doc.y, { width: CONTENT_W });

      if (aiSummary.aiSolutions && aiSummary.aiSolutions.length) {
        sectionHeader('KI-Lösungsvorschläge', AMBER);
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
          .text('Zusätzliche Vorschläge unserer KI für eure ursprüngliche Denkblockade:', MARGIN, doc.y, { width: CONTENT_W });
        doc.moveDown(0.4);
        aiSummary.aiSolutions.forEach(s => bulletItem(s, AMBER));
      }

      if (aiSummary.ideas && aiSummary.ideas.length) {
        sectionHeader('Ideen aus dem Gespräch', ACCENT2);
        aiSummary.ideas.forEach(idea => bulletItem(idea, ACCENT2));
      }

      if (aiSummary.actionItems && aiSummary.actionItems.length) {
        sectionHeader('Nächste Schritte', GREEN);
        aiSummary.actionItems.forEach(item => checkboxItem(item));
      }
    } else {
      sectionHeader('Zusammenfassung', ACCENT);
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED)
        .text('Keine KI-Zusammenfassung verfügbar — hier das vollständige Protokoll.', MARGIN, doc.y, { width: CONTENT_W });
    }

    sectionHeader('Vollständiges Protokoll', '#9b96ad');
    if (transcript.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MUTED)
        .text('Kein Protokoll aufgezeichnet (Spracherkennung war evtl. nicht verfügbar oder aus).', MARGIN, doc.y, { width: CONTENT_W });
    } else {
      transcript.forEach(seg => {
        if (doc.y > doc.page.height - 100) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT2)
          .text(seg.speakerLabel + ':', MARGIN, doc.y, { continued: true, width: CONTENT_W });
        doc.font('Helvetica').fillColor(INK).text(' ' + seg.text, { width: CONTENT_W });
      });
    }

    // Fußzeile nachträglich auf ALLE Seiten zeichnen (erst jetzt kennen wir die Gesamtzahl)
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      drawFooter(i + 1, totalPages);
    }

    doc.end();
  });
}

module.exports = { summarizeWithAI, buildPdf, parseStructuredSummary, transcribeAudioFallback, looksLikeWhisperHallucination, extensionForMimeType };
