const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const store = require('./store');
const { summarizeWithAI, buildPdf, transcribeAudioFallback } = require('./call-summary');
const { classifyTopic, areAssociativelyRelated } = require('./topic-matcher');
const { generateImpulse } = require('./live-impulse');

// Globales Sicherheitsnetz: ein einzelner unerwarteter Fehler (z.B. beim Lesen einer
// JSON-Datei mitten in einem parallelen Schreibvorgang) soll NICHT mehr den ganzen
// Server-Prozess killen. Ohne das crasht bei neueren Node-Versionen der komplette
// Prozess bei jeder "unhandled promise rejection" — das war die Ursache für den
// Render-Absturz "Exited with status 1".
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unbehandelte Promise-Ablehnung (Server läuft trotzdem weiter):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Unerwarteter Fehler (Server läuft trotzdem weiter):', err.message, err.stack);
});

const PDF_DIR = path.join(__dirname, 'data', 'call-pdfs');
function ensurePdfDir() {
  if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
}

const REPORT_BAN_THRESHOLD = 3; // ab so vielen Meldungen wird automatisch gesperrt
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Nicht eingeloggt.' });
  }
  if (!isAdminEmail(req.session.user.email)) {
    return res.status(403).json({ error: 'Kein Zugriff auf den Admin-Bereich.', yourEmail: req.session.user.email });
  }
  next();
}

async function sendVerificationEmail(email, token) {
  const link = APP_URL + '/api/verify-email?token=' + token;

  if (!RESEND_API_KEY) {
    console.log('⚠️  RESEND_API_KEY nicht gesetzt — E-Mail wird NICHT verschickt.');
    console.log('    Bestätigungslink für ' + email + ': ' + link);
    return { sent: false };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'FlowValu <onboarding@resend.dev>',
        to: [email],
        subject: 'Bestätige deine E-Mail für FlowValu',
        html: '<p>Willkommen bei FlowValu!</p><p>Klick auf den Link, um deine E-Mail-Adresse zu bestätigen:</p><p><a href="' + link + '">' + link + '</a></p><p>Der Link ist 24 Stunden gültig.</p>'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Fehler beim E-Mail-Versand:', res.status, errText);
      return { sent: false, error: errText };
    }
    return { sent: true };
  } catch (err) {
    // Registrierung soll nicht scheitern, nur weil der Mailversand gerade klemmt
    console.error('E-Mail-Versand technisch fehlgeschlagen:', err.message);
    console.log('    Bestätigungslink für ' + email + ' (manuell teilen, falls nötig): ' + link);
    return { sent: false, error: err.message };
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'flowvalu-dev-secret-bitte-in-produktion-aendern',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 Tage eingeloggt bleiben
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware); // gleiche Session auch für Socket.io-Verbindungen nutzbar machen

app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- Auth-Routen ---------------- */

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben.' });
  if (store.findUserByEmail(email)) return res.status(400).json({ error: 'Für diese E-Mail existiert bereits ein Konto.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(24).toString('hex');
  const users = store.readUsers();
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    banned: false,
    reportCount: 0,
    emailVerified: !RESEND_API_KEY, // ohne konfigurierten Mailversand (lokales Testen) automatisch bestätigt
    verificationToken,
    verificationTokenExpires: Date.now() + 1000 * 60 * 60 * 24, // 24 Stunden gültig
    createdAt: new Date().toISOString()
  };
  users.push(user);
  store.writeUsers(users);

  if (RESEND_API_KEY) {
    await sendVerificationEmail(user.email, verificationToken);
  }

  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true, email: user.email, emailVerified: user.emailVerified });
});

app.get('/api/verify-email', (req, res) => {
  const { token } = req.query;
  const users = store.readUsers();
  const user = users.find(u => u.verificationToken === token);

  if (!user) {
    return res.status(400).send('<h1>Ungültiger Link</h1><p>Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.</p>');
  }
  if (user.verificationTokenExpires && Date.now() > user.verificationTokenExpires) {
    return res.status(400).send('<h1>Link abgelaufen</h1><p>Bitte fordere in der App einen neuen Bestätigungslink an.</p>');
  }

  user.emailVerified = true;
  user.verificationToken = null;
  user.verificationTokenExpires = null;
  store.writeUsers(users);

  res.send('<h1>E-Mail bestätigt ✓</h1><p>Du kannst dieses Fenster schließen und in FlowValu weitermachen.</p>');
});

app.post('/api/resend-verification', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const users = store.readUsers();
  const user = users.find(u => u.email === req.session.user.email);
  if (!user) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

  user.verificationToken = crypto.randomBytes(24).toString('hex');
  user.verificationTokenExpires = Date.now() + 1000 * 60 * 60 * 24;
  store.writeUsers(users);

  const result = await sendVerificationEmail(user.email, user.verificationToken);
  res.json({ ok: true, sent: result.sent });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = store.findUserByEmail(email || '');
  if (!user) return res.status(400).json({ error: 'E-Mail oder Passwort falsch.' });
  if (user.banned) return res.status(403).json({ error: 'Dieses Konto wurde wegen mehrerer Meldungen gesperrt.' });

  const match = await bcrypt.compare(password || '', user.passwordHash);
  if (!match) return res.status(400).json({ error: 'E-Mail oder Passwort falsch.' });

  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true, email: user.email, emailVerified: user.emailVerified });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const dbUser = store.findUserByEmail(req.session.user.email);
  res.json({ user: req.session.user, emailVerified: dbUser ? dbUser.emailVerified : false });
});

/* ---------------- Profil-Routen ---------------- */

app.get('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const user = store.findUserByEmail(req.session.user.email);
  res.json({
    displayName: user.displayName || '',
    avatarDataUrl: user.avatarDataUrl || null,
    liveImpulsesEnabled: user.liveImpulsesEnabled !== false, // Standard: an
    rating: store.getUserRatingSummary(req.session.user.email)
  });
});

app.post('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { displayName, avatarDataUrl, liveImpulsesEnabled } = req.body || {};

  if (displayName !== undefined && String(displayName).length > 40) {
    return res.status(400).json({ error: 'Anzeigename darf höchstens 40 Zeichen haben.' });
  }
  if (avatarDataUrl && (typeof avatarDataUrl !== 'string' || !avatarDataUrl.startsWith('data:image/') || avatarDataUrl.length > 400000)) {
    return res.status(400).json({ error: 'Ungültiges Bild oder Bild zu groß.' });
  }

  const users = store.readUsers();
  const user = users.find(u => u.email === req.session.user.email);
  if (!user) return res.status(404).json({ error: 'Konto nicht gefunden.' });

  if (displayName !== undefined) user.displayName = String(displayName).trim();
  if (avatarDataUrl !== undefined) user.avatarDataUrl = avatarDataUrl;
  if (liveImpulsesEnabled !== undefined) user.liveImpulsesEnabled = !!liveImpulsesEnabled;

  store.writeUsers(users);
  res.json({ ok: true });
});

/* ---------------- Verlauf-Route ---------------- */

/* ---------------- Call-PDF-Download (dauerhaft, auch aus dem Verlauf) ---------------- */
app.get('/api/call-pdf/:token', (req, res) => {
  if (!req.session.user) return res.status(401).send('Nicht eingeloggt.');
  const match = store.findMatchByPdfToken(req.params.token);
  if (!match) return res.status(404).send('Diese Zusammenfassung wurde nicht gefunden.');
  const isParticipant = match.userAEmail === req.session.user.email || match.userBEmail === req.session.user.email;
  if (!isParticipant && !isAdminEmail(req.session.user.email)) {
    return res.status(403).send('Kein Zugriff auf diese Zusammenfassung.');
  }
  const filePath = path.join(PDF_DIR, req.params.token + '.pdf');
  if (!fs.existsSync(filePath)) return res.status(404).send('Die PDF-Datei ist nicht mehr vorhanden.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="flowvalu-call-zusammenfassung.pdf"');
  res.send(fs.readFileSync(filePath));
});

/* ---------------- Audio-Fallback-Transkription (Whisper) für Browser ohne Web Speech API ---------------- */
// type: () => true statt fest 'audio/webm' — Safari/iOS liefert z.B. audio/mp4, das sonst
// stillschweigend abgelehnt worden wäre (req.body wäre leer geblieben statt geparst zu werden).
app.post('/api/transcribe-audio', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { roomId, mimeType } = req.query;
  if (!roomId || !req.body || !req.body.length) return res.status(400).json({ error: 'roomId und Audiodaten erforderlich.' });

  const text = await transcribeAudioFallback(req.body, mimeType || req.headers['content-type']);
  if (!text) return res.json({ ok: true, transcribed: false });

  if (!transcripts[roomId]) transcripts[roomId] = [];
  const label = store.getPublicProfile(req.session.user.email).displayName;
  const segment = { speakerEmail: req.session.user.email, speakerLabel: label, text, timestamp: Date.now() };
  transcripts[roomId].push(segment);
  roomActivity[roomId] = Date.now();
  try {
    store.resolveOpenImpulse(roomId, true);
  } catch (err) {
    console.error('Impuls-Erfolg konnte nicht vermerkt werden:', err.message);
  }

  const sId = userSockets[req.session.user.email];
  const otherMembers = (rooms[roomId] || []).filter(id => id !== sId);
  otherMembers.forEach(id => { const s = io.sockets.sockets.get(id); if (s) s.emit('transcript_update', segment); });

  res.json({ ok: true, transcribed: true });
});

/* ---------------- Admin-Bereich ---------------- */
app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const reports = store.readReports();
  const matches = store.readMatches();

  const enriched = reports
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => {
      const reportedUser = store.findUserByEmail(r.reportedEmail);
      const match = r.matchId ? matches.find(m => m.id === r.matchId) : null;
      return {
        id: r.id,
        reporterEmail: r.reporterEmail,
        reportedEmail: r.reportedEmail,
        reason: r.reason,
        createdAt: r.createdAt,
        reportedUserBanned: reportedUser ? !!reportedUser.banned : null,
        reportedUserReportCount: reportedUser ? (reportedUser.reportCount || 0) : null,
        pdfUrl: match && match.pdfToken ? '/api/call-pdf/' + match.pdfToken : null
      };
    });

  res.json({ reports: enriched });
});

app.post('/api/admin/unban', requireAdmin, (req, res) => {
  const { email } = req.body || {};
  const users = store.readUsers();
  const user = users.find(u => u.email === (email || '').toLowerCase());
  if (!user) return res.status(404).json({ error: 'Konto nicht gefunden.' });
  user.banned = false;
  user.reportCount = 0;
  store.writeUsers(users);
  res.json({ ok: true });
});

app.get('/api/history', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const myEmail = req.session.user.email;
  const matches = store.readMatches();

  const mine = matches
    .filter(m => m.userAEmail === myEmail || m.userBEmail === myEmail)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 30)
    .map(m => {
      const partnerEmail = m.userAEmail === myEmail ? m.userBEmail : m.userAEmail;
      const partnerTopic = m.userAEmail === myEmail ? m.userBTopic : m.userATopic;
      const partnerProfile = store.getPublicProfile(partnerEmail);
      return {
        partnerEmail,
        partnerDisplayName: partnerProfile.displayName,
        partnerAvatar: partnerProfile.avatarDataUrl,
        topic: partnerTopic,
        hadCall: m.hadCall,
        pdfUrl: m.pdfToken ? '/api/call-pdf/' + m.pdfToken : null,
        startedAt: m.startedAt,
        online: !!userSockets[partnerEmail]
      };
    });

  res.json({ history: mine });
});

/* ---------------- Matching, Chat, Call, Melden ---------------- */

let waiting = [];           // [{ socketId, profile, email }]
let rooms = {};             // roomId -> [socketIdA, socketIdB]
let callRequests = {};      // roomId -> Set(socketId)
let userSockets = {};       // email -> socketId (für Melden/Sperren/Verlauf)
let roomToMatchId = {};     // roomId -> matches.json Eintrags-ID (um hadCall/pdfToken nachzutragen)
let transcripts = {};       // roomId -> [{ speakerEmail, speakerLabel, text, timestamp }]
let summaryInProgress = new Set(); // roomIds, die gerade ihre PDF erzeugen (Doppel-Erzeugung verhindern)

// Serialisiert alle Vorgänge, die die Warteschlange (waiting[]) anfassen. Ohne das
// könnten zwei Leute, die fast gleichzeitig beitreten, sich gegenseitig verpassen:
// join_queue wartet jetzt erst auf classifyTopic() (ein API-Call), bevor die
// Warteschlange geprüft wird — in dieser Wartezeit könnte ein zweiter Beitritt
// dieselbe (noch leere) Warteschlange sehen, und beide landen als getrennte
// Einträge dort, statt sich zu matchen. Diese Sperre stellt sicher, dass immer nur
// eine "prüfen + eintragen"-Operation gleichzeitig läuft.
let matchingLock = Promise.resolve();
function withMatchingLock(taskFn) {
  const run = () => Promise.resolve().then(taskFn).catch(err => console.error('Matching-Vorgang fehlgeschlagen:', err.message));
  matchingLock = matchingLock.then(run, run);
  return matchingLock;
}

// -------- Live-Impuls bei Denkblockade während des Calls --------
const SILENCE_THRESHOLD_MS = 25 * 1000;   // ab so viel Stille gilt das Gespräch als "stockend"
const IMPULSE_COOLDOWN_MS = 60 * 1000;    // Mindestabstand zwischen zwei Impulsen
const MAX_IMPULSES_PER_CALL = 4;          // Obergrenze, damit die KI nicht nervt
const IMPULSE_CHECK_INTERVAL_MS = 5 * 1000;

let roomActivity = {};       // roomId -> Timestamp der letzten Sprachaktivität
let roomImpulseState = {};   // roomId -> { count, lastImpulseAt }
let roomImpulseTimers = {};  // roomId -> Interval-Handle

function startImpulseWatcher(roomId) {
  const members = rooms[roomId] || [];
  let anyoneWantsImpulses = true;
  try {
    anyoneWantsImpulses = members.some(id => {
      const s = io.sockets.sockets.get(id);
      if (!s || !s.data.email) return true;
      const dbUser = store.findUserByEmail(s.data.email);
      return !dbUser || dbUser.liveImpulsesEnabled !== false;
    });
  } catch (err) {
    console.error('Prüfung der Impuls-Einstellung fehlgeschlagen, starte Watcher trotzdem:', err.message);
  }
  if (!anyoneWantsImpulses) return; // niemand im Call will die Funktion — Watcher spart sich die Arbeit

  roomActivity[roomId] = Date.now();
  roomImpulseState[roomId] = { count: 0, lastImpulseAt: 0 };

  roomImpulseTimers[roomId] = setInterval(async () => {
    try {
      const members = rooms[roomId];
      if (!members) { stopImpulseWatcher(roomId); return; }

      const state = roomImpulseState[roomId];
      if (!state || state.count >= MAX_IMPULSES_PER_CALL) return;

      const sinceActivity = Date.now() - (roomActivity[roomId] || Date.now());
      const sinceLastImpulse = Date.now() - state.lastImpulseAt;
      if (sinceActivity < SILENCE_THRESHOLD_MS || sinceLastImpulse < IMPULSE_COOLDOWN_MS) return;

      // Nur an Mitglieder schicken, die die Funktion in ihrem Profil aktiviert haben lassen
      const targetIds = members.filter(id => {
        const s = io.sockets.sockets.get(id);
        if (!s || !s.data.email) return false;
        const dbUser = store.findUserByEmail(s.data.email);
        return !dbUser || dbUser.liveImpulsesEnabled !== false; // Standard: an
      });
      if (targetIds.length === 0) return; // beide/alle haben die Funktion ausgeschaltet — nichts generieren

      state.lastImpulseAt = Date.now();
      state.count += 1;

      const transcript = transcripts[roomId] || [];
      const transcriptText = transcript.slice(-12).map(s => s.speakerLabel + ': ' + s.text).join('\n');
      const participantEmails = members
        .map(id => { const s = io.sockets.sockets.get(id); return s ? s.data.email : null; })
        .filter(Boolean);
      const participantNames = participantEmails.map(e => store.getPublicProfile(e).displayName);
      const hangups = members.map(id => {
        const s = io.sockets.sockets.get(id);
        return s && s.data.lastProfile ? s.data.lastProfile.hangup : '';
      });

      // Persönliches Gedächtnis: Ideen dieser Personen aus früheren, ANDEREN Calls
      let personalHistory = [];
      try {
        personalHistory = participantEmails.flatMap(e => store.getRecentIdeasForUser(e, roomId, 2));
      } catch (err) {
        console.error('Persönliches Gedächtnis konnte nicht geladen werden:', err.message);
      }

      // Globales Lernen: Beispiele für Impulse, die in der Vergangenheit nachweislich geholfen haben
      let effectiveExamples = [];
      try {
        effectiveExamples = store.getEffectiveImpulseExamples(3);
      } catch (err) {
        console.error('Erfolgreiche Impuls-Beispiele konnten nicht geladen werden:', err.message);
      }

      const impulse = await generateImpulse({ transcriptText, hangups, participantNames, personalHistory, effectiveExamples });
      targetIds.forEach(id => io.to(id).emit('live_impulse', { text: impulse }));

      // Fürs globale Lernen protokollieren — ob er geholfen hat, stellt sich erst später
      // heraus (siehe transcript_chunk-Handler und call_ended weiter unten)
      try {
        store.logImpulse({ roomId, text: impulse });
      } catch (err) {
        console.error('Impuls konnte nicht protokolliert werden:', err.message);
      }
    } catch (err) {
      // Wichtig: dieser try/catch umschließt JETZT den kompletten Interval-Durchlauf.
      // Ein Fehler hier (z.B. beim Lesen der users.json) darf nur diesen einen
      // Tick überspringen, aber NIEMALS den ganzen Server-Prozess crashen.
      console.error('Live-Impuls-Check fehlgeschlagen:', err.message);
    }
  }, IMPULSE_CHECK_INTERVAL_MS);
}

function stopImpulseWatcher(roomId) {
  if (roomImpulseTimers[roomId]) {
    clearInterval(roomImpulseTimers[roomId]);
    delete roomImpulseTimers[roomId];
  }
  delete roomActivity[roomId];
  delete roomImpulseState[roomId];
}

function logMatch(emailA, emailB, profileA, profileB, roomId) {
  const matches = store.readMatches();
  const entry = {
    id: crypto.randomUUID(),
    roomId,
    userAEmail: emailA,
    userBEmail: emailB,
    userATopic: profileA.hangup || '',
    userBTopic: profileB.hangup || '',
    hadCall: false,
    startedAt: new Date().toISOString()
  };
  matches.push(entry);
  store.writeMatches(matches);
  roomToMatchId[roomId] = entry.id;
}

function markCallHappened(roomId) {
  const matchId = roomToMatchId[roomId];
  if (!matchId) return;
  const matches = store.readMatches();
  const entry = matches.find(m => m.id === matchId);
  if (entry) {
    entry.hadCall = true;
    store.writeMatches(matches);
  }
}

// Wie viele Wartende maximal per Direkt-Vergleich geprüft werden (Kosten/Latenz begrenzen)
const MAX_ASSOCIATIVE_CHECKS = 6;

// Findet ein gemeinsames Tag zwischen zwei Themen-Cluster-Listen, sonst null.
function sharedTag(tagsA, tagsB) {
  if (!Array.isArray(tagsA) || !Array.isArray(tagsB)) return null;
  return tagsA.find(t => tagsB.includes(t)) || null;
}

// Gibt { idx, matchedTag } zurück oder null, wenn niemand passt.
// WICHTIG: Die Unterscheidung läuft über den MODUS (mode), nicht darüber, ob ein
// fester Chip (topic) gewählt wurde — sonst würde "Nach Thema" ohne Chip-Auswahl
// (z.B. bei "Autopflege" oder "Blumen", die in keinen der 5 festen Chips passen)
// versehentlich wie "Zufällig" behandelt und am Ende wahllos irgendwen matchen.
//
// Reihenfolge im Thema-Modus: 1) exakte Chip-Auswahl  2) gemeinsames KI-Kategorie-
// Cluster (z.B. "KFZ" und "Autofirma" -> beide "Fahrzeuge & Mobilität")  3) direkter
// assoziativer Vergleich der Freitexte über den Wörter-Baum (z.B. "Uhr bauen" <->
// "Thema Zeit"). Gibt es KEINE dieser Verbindungen, wird NICHT gematcht (return null)
// — anders als im Zufalls-Modus, wo als letzter Ausweg irgendwer gematcht wird.
async function findPartnerIndex(profile) {
  if (profile.mode === 'thema') {
    if (profile.topic) {
      const idx = waiting.findIndex(w => w.profile.topic === profile.topic);
      if (idx !== -1) return { idx, matchedTag: profile.topic };
    }

    let idx = waiting.findIndex(w => sharedTag(w.profile.aiTags, profile.aiTags));
    if (idx !== -1) return { idx, matchedTag: sharedTag(waiting[idx].profile.aiTags, profile.aiTags) };

    idx = await findAssociativeIndex(profile);
    if (idx !== -1) return { idx, matchedTag: null };

    return null; // keine echte Verbindung gefunden -> lieber warten als wahllos matchen
  }

  // Zufalls-Modus: bevorzugt inhaltlich passende Leute, matcht als letzten Ausweg aber irgendwen
  if (!waiting.length) return null;

  let idx = waiting.findIndex(w => sharedTag(w.profile.aiTags, profile.aiTags));
  if (idx !== -1) return { idx, matchedTag: sharedTag(waiting[idx].profile.aiTags, profile.aiTags) };

  idx = await findAssociativeIndex(profile);
  if (idx !== -1) return { idx, matchedTag: null };

  return { idx: 0, matchedTag: null };
}

// Prüft die ersten paar Wartenden per Direkt-Vergleich (Claude ja/nein) auf inhaltliche
// Verwandtschaft, unabhängig von den festen Kategorien. Gibt den Index zurück oder -1.
// Läuft PARALLEL statt nacheinander: so dauert die Prüfung im schlimmsten Fall nur
// einmal die Zeit für einen API-Aufruf (bzw. dessen Timeout), statt bis zu
// MAX_ASSOCIATIVE_CHECKS-mal hintereinander — das würde sonst die Warteschlange für
// ALLE Nutzer unnötig lange blockieren, da diese Prüfung innerhalb der Matching-Sperre läuft.
async function findAssociativeIndex(profile) {
  const candidates = waiting.slice(0, MAX_ASSOCIATIVE_CHECKS);
  if (!candidates.length) return -1;

  const results = await Promise.all(
    candidates.map(c => areAssociativelyRelated(profile.hangup, c.profile.hangup).catch(() => false))
  );
  return results.findIndex(r => r === true);
}

io.use((socket, next) => {
  const sessionUser = socket.request.session && socket.request.session.user;
  if (!sessionUser) {
    return next(new Error('not_authenticated'));
  }
  const dbUser = store.findUserByEmail(sessionUser.email);
  if (!dbUser || !dbUser.emailVerified) {
    return next(new Error('email_not_verified'));
  }
  socket.data.email = sessionUser.email;
  next();
});

io.on('connection', (socket) => {
  userSockets[socket.data.email] = socket.id;

  socket.on('join_queue', (profile) => {
    processJoinQueue(socket, profile);
  });

  async function processJoinQueue(socket, profile) {
    profile = profile || {};

    // Freitext ("Woran hängst du gerade?") einem breiten Themen-Cluster zuordnen,
    // damit z.B. "KFZ-Werkstatt" und "Autofirma gründen" als verwandt erkannt werden.
    // Läuft bewusst AUSSERHALB der Matching-Sperre: das greift auf keinen gemeinsamen
    // Zustand zu, kann also für mehrere Leute gleichzeitig laufen, ohne dass sich
    // jemand gegenseitig blockiert.
    try {
      profile.aiTags = await classifyTopic(profile.hangup);
    } catch (err) {
      console.error('Themen-Klassifizierung fehlgeschlagen:', err.message);
      profile.aiTags = ['Sonstiges'];
    }

    // Falls sich der Nutzer zwischenzeitlich schon getrennt hat (Tab zu etc.), abbrechen
    if (socket.disconnected) return;

    socket.data.lastProfile = profile;

    // Ab hier wird die gemeinsame Warteschlange gelesen und verändert — das MUSS
    // serialisiert laufen, sonst können sich zwei Leute wieder gegenseitig verpassen.
    await withMatchingLock(() => matchOrEnqueue(socket, profile));
  }

  async function matchOrEnqueue(socket, profile) {
    const match = await findPartnerIndex(profile);

    if (match) {
      const partner = waiting.splice(match.idx, 1)[0];
      const roomId = crypto.randomUUID();
      rooms[roomId] = [partner.socketId, socket.id];

      socket.join(roomId);
      const partnerSocket = io.sockets.sockets.get(partner.socketId);
      if (partnerSocket) partnerSocket.join(roomId);

      socket.data.roomId = roomId;
      if (partnerSocket) partnerSocket.data.roomId = roomId;

      logMatch(partner.email, socket.data.email, partner.profile, profile, roomId);

      socket.emit('matched', {
        roomId, partnerProfile: partner.profile, youAre: 'b', matchedTag: match.matchedTag,
        partnerDisplay: store.getPublicProfile(partner.email)
      });
      if (partnerSocket) {
        partnerSocket.emit('matched', {
          roomId, partnerProfile: profile, youAre: 'a', matchedTag: match.matchedTag,
          partnerDisplay: store.getPublicProfile(socket.data.email)
        });
      }
    } else {
      waiting.push({ socketId: socket.id, profile, email: socket.data.email });
      socket.emit('waiting', { position: waiting.length });
    }
  }

  socket.on('chat_message', ({ roomId, text }) => {
    if (!roomId || !text) return;
    socket.to(roomId).emit('chat_message', { text, from: 'partner' });
  });

  socket.on('call_request', ({ roomId }) => {
    if (!roomId) return;
    if (!callRequests[roomId]) callRequests[roomId] = new Set();
    callRequests[roomId].add(socket.id);

    const members = rooms[roomId] || [];
    const bothReady = members.length === 2 && members.every(id => callRequests[roomId].has(id));

    if (bothReady) {
      delete callRequests[roomId];
      markCallHappened(roomId);
      startImpulseWatcher(roomId);
      members.forEach((id) => {
        const isOfferer = id === members[0];
        io.to(id).emit('start_call', { isOfferer });
      });
    } else {
      socket.to(roomId).emit('call_requested_by_partner');
    }
  });

  socket.on('webrtc_signal', ({ roomId, data }) => {
    if (!roomId) return;
    socket.to(roomId).emit('webrtc_signal', data);
  });

  /* -------- Call-Protokoll & KI-Zusammenfassung -------- */
  socket.on('transcript_chunk', ({ roomId, text }) => {
    if (!roomId || !text) return;
    if (!transcripts[roomId]) transcripts[roomId] = [];
    const label = store.getPublicProfile(socket.data.email).displayName;
    const segment = { speakerEmail: socket.data.email, speakerLabel: label, text, timestamp: Date.now() };
    transcripts[roomId].push(segment);
    roomActivity[roomId] = Date.now();
    io.to(roomId).emit('transcript_update', segment);

    // Globales Lernen: wird nach einem Impuls wieder geredet, hat er offenbar geholfen
    try {
      store.resolveOpenImpulse(roomId, true);
    } catch (err) {
      console.error('Impuls-Erfolg konnte nicht vermerkt werden:', err.message);
    }
  });

  socket.on('call_ended', async ({ roomId }) => {
    if (!roomId || summaryInProgress.has(roomId)) return;
    const members = rooms[roomId];
    if (!members) return;
    summaryInProgress.add(roomId);
    stopImpulseWatcher(roomId);

    // Globales Lernen: falls seit dem letzten Impuls nicht mehr geredet wurde, war er
    // offenbar nicht hilfreich — das MUSS vor dem summaryInProgress-try-Block passieren,
    // damit es auch bei einem Fehler in der PDF-Erstellung nicht verloren geht.
    try {
      store.resolveAllOpenImpulsesForRoom(roomId, false);
    } catch (err) {
      console.error('Offene Impulse konnten nicht abgeschlossen werden:', err.message);
    }

    try {
      const transcript = transcripts[roomId] || [];
      const participantEmails = members
        .map(id => { const s = io.sockets.sockets.get(id); return s ? s.data.email : null; })
        .filter(Boolean);
      const participantNames = participantEmails.map(e => store.getPublicProfile(e).displayName);

      const transcriptText = transcript.map(s => s.speakerLabel + ': ' + s.text).join('\n');
      const aiSummary = transcriptText ? await summarizeWithAI(transcriptText, participantNames) : null;

      // Persönliches Gedächtnis: Ideen aus diesem Call für zukünftige Calls dieser Personen merken
      if (aiSummary && (aiSummary.ideas.length || aiSummary.actionItems.length)) {
        try {
          store.addCallSummary({
            roomId, participantEmails,
            summary: aiSummary.summary, ideas: aiSummary.ideas, actionItems: aiSummary.actionItems
          });
        } catch (err) {
          console.error('Call-Zusammenfassung konnte nicht fürs Gedächtnis gespeichert werden:', err.message);
        }
      }

      const pdfBuffer = await buildPdf({
        participantNames,
        startedAt: transcript[0] ? transcript[0].timestamp : Date.now(),
        aiSummary,
        transcript
      });

      const token = crypto.randomUUID();
      ensurePdfDir();
      fs.writeFileSync(path.join(PDF_DIR, token + '.pdf'), pdfBuffer);

      // Token dauerhaft am Verlaufs-Eintrag speichern, damit später nochmal abrufbar
      const matchId = roomToMatchId[roomId];
      if (matchId) {
        const matches = store.readMatches();
        const entry = matches.find(m => m.id === matchId);
        if (entry) {
          entry.pdfToken = token;
          store.writeMatches(matches);
        }
      }

      participantEmails.forEach(email => {
        const sId = userSockets[email];
        const s = sId && io.sockets.sockets.get(sId);
        if (s) s.emit('call_summary_ready', { url: '/api/call-pdf/' + token, roomId });
      });
    } catch (err) {
      console.error('Fehler beim Erstellen der Call-Zusammenfassung:', err.message);
    } finally {
      delete transcripts[roomId];
      summaryInProgress.delete(roomId);
    }
  });

  // Bewertung nach einem Call: 1-5 Sterne auf Beliebtheit und Kreativität.
  // Validierung läuft über den persistenten Match-Eintrag (nicht die Live-Socket-Room),
  // damit man auch noch bewerten kann, nachdem man den Raum schon verlassen hat.
  socket.on('rate_partner', ({ roomId, beliebtheit, kreativitaet }) => {
    const raterEmail = socket.data.email;
    if (!raterEmail || !roomId) {
      socket.emit('rate_result', { ok: false, error: 'Ungültige Anfrage.' });
      return;
    }

    const match = store.readMatches().find(m =>
      m.roomId === roomId && (m.userAEmail === raterEmail || m.userBEmail === raterEmail)
    );
    if (!match) {
      socket.emit('rate_result', { ok: false, error: 'Dieser Call wurde nicht gefunden.' });
      return;
    }
    const ratedEmail = match.userAEmail === raterEmail ? match.userBEmail : match.userAEmail;

    const success = store.addRating({ roomId, raterEmail, ratedEmail, beliebtheit, kreativitaet });
    socket.emit('rate_result', {
      ok: success,
      error: success ? null : 'Ungültige Bewertung oder du hast diesen Call schon bewertet.'
    });
  });

  socket.on('report_user', ({ roomId, reason }) => {
    const members = rooms[roomId] || [];
    const otherSocketId = members.find(id => id !== socket.id);
    if (!otherSocketId) return;
    const otherSocket = io.sockets.sockets.get(otherSocketId);
    if (!otherSocket) return;

    const reportedEmail = otherSocket.data.email;
    const reporterEmail = socket.data.email;

    const reports = store.readReports();
    reports.push({
      id: crypto.randomUUID(),
      reporterEmail,
      reportedEmail,
      reason: reason || 'Kein Grund angegeben',
      roomId,
      matchId: roomToMatchId[roomId] || null, // um später das PDF/Protokoll zuordnen zu können
      createdAt: new Date().toISOString()
    });
    store.writeReports(reports);

    const users = store.readUsers();
    const reportedUser = users.find(u => u.email === reportedEmail);
    if (reportedUser) {
      reportedUser.reportCount = (reportedUser.reportCount || 0) + 1;
      if (reportedUser.reportCount >= REPORT_BAN_THRESHOLD) {
        reportedUser.banned = true;
        const reportedSocketId = userSockets[reportedEmail];
        const reportedSocket = reportedSocketId && io.sockets.sockets.get(reportedSocketId);
        if (reportedSocket) {
          reportedSocket.emit('you_are_banned');
          reportedSocket.disconnect(true);
        }
      }
    }
    store.writeUsers(users);

    socket.emit('report_submitted');
  });

  /* -------- Direkt-Einladung aus dem Verlauf ("Nochmal connecten") -------- */
  socket.on('invite_partner', ({ email }) => {
    const targetSocketId = userSockets[email];
    const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);

    if (!targetSocket) {
      socket.emit('invite_failed', { reason: 'offline' });
      return;
    }
    if (targetSocket.data.roomId) {
      socket.emit('invite_failed', { reason: 'busy' });
      return;
    }

    waiting = waiting.filter(w => w.socketId !== targetSocketId); // aus Warteschlange holen, falls dort
    socket.data.pendingInviteTo = email;
    targetSocket.emit('invite_received', {
      fromEmail: socket.data.email,
      fromDisplay: store.getPublicProfile(socket.data.email)
    });
  });

  socket.on('accept_invite', ({ fromEmail }) => {
    withMatchingLock(() => {
      const inviterSocketId = userSockets[fromEmail];
      const inviterSocket = inviterSocketId && io.sockets.sockets.get(inviterSocketId);

      if (!inviterSocket || inviterSocket.data.pendingInviteTo !== socket.data.email) {
        socket.emit('invite_failed', { reason: 'expired' });
        return;
      }

      waiting = waiting.filter(w => w.socketId !== socket.id);
      inviterSocket.data.pendingInviteTo = null;

      const roomId = crypto.randomUUID();
      rooms[roomId] = [inviterSocket.id, socket.id];
      inviterSocket.join(roomId);
      socket.join(roomId);
      inviterSocket.data.roomId = roomId;
      socket.data.roomId = roomId;

      const inviterProfile = inviterSocket.data.lastProfile || { hangup: 'Hey, wieder da!', topic: null };
      const accepterProfile = socket.data.lastProfile || { hangup: 'Hey, wieder da!', topic: null };

      logMatch(fromEmail, socket.data.email, inviterProfile, accepterProfile, roomId);

      inviterSocket.emit('matched', {
        roomId, partnerProfile: accepterProfile, youAre: 'a',
        partnerDisplay: store.getPublicProfile(socket.data.email)
      });
      socket.emit('matched', {
        roomId, partnerProfile: inviterProfile, youAre: 'b',
        partnerDisplay: store.getPublicProfile(fromEmail)
      });
    });
  });

  socket.on('decline_invite', ({ fromEmail }) => {
    const inviterSocketId = userSockets[fromEmail];
    const inviterSocket = inviterSocketId && io.sockets.sockets.get(inviterSocketId);
    if (inviterSocket) {
      inviterSocket.data.pendingInviteTo = null;
      inviterSocket.emit('invite_declined');
    }
  });

  socket.on('skip', () => {
    leaveCurrentRoom(socket, true);
  });

  socket.on('leave_queue', () => {
    waiting = waiting.filter(w => w.socketId !== socket.id);
  });

  socket.on('disconnect', () => {
    waiting = waiting.filter(w => w.socketId !== socket.id);
    leaveCurrentRoom(socket, true);
    if (userSockets[socket.data.email] === socket.id) {
      delete userSockets[socket.data.email];
    }
  });

  function leaveCurrentRoom(sock, notifyPartner) {
    const roomId = sock.data.roomId;
    if (!roomId) return;
    if (notifyPartner) sock.to(roomId).emit('partner_left');
    sock.leave(roomId);
    delete rooms[roomId];
    delete callRequests[roomId];
    stopImpulseWatcher(roomId);
    try {
      store.resolveAllOpenImpulsesForRoom(roomId, false);
    } catch (err) {
      console.error('Offene Impulse konnten nicht abgeschlossen werden:', err.message);
    }
    sock.data.roomId = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('FlowValu läuft auf Port ' + PORT));
