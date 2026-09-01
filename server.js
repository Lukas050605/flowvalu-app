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
const { classifyTopic, computeAssociationScore } = require('./topic-matcher');
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

const REELS_DIR = path.join(__dirname, 'data', 'reels-videos');
function ensureReelsDir() {
  if (!fs.existsSync(REELS_DIR)) fs.mkdirSync(REELS_DIR, { recursive: true });
}

// Ordnet einem MIME-Type die passende Dateiendung zu (fürs Speichern auf der Platte)
function extensionForVideoMimeType(mimeType) {
  const type = (mimeType || '').toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime') || type.includes('mov')) return 'mov';
  if (type.includes('ogg')) return 'ogv';
  return 'webm';
}

const REPORT_BAN_THRESHOLD = 3; // ab so vielen Meldungen wird automatisch gesperrt
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// Liefert den Mentor-Status für die UI/API — entweder die ECHTEN Werte, oder (nur für
// Admins, die sich selbst eine Vorschau-Stufe gesetzt haben) simulierte "So-tun-als-ob"-
// Werte. Betrifft NIE echte Nutzer-Daten, nur die Anzeige für den Admin-Account selbst.
function getEffectiveMentorStatus(email) {
  const user = store.findUserByEmail(email);
  if (isAdminEmail(email) && user && user.mentorDebugTier !== undefined && user.mentorDebugTier !== null) {
    const tier = user.mentorDebugTier;
    const limits = { 0: 0, 1: store.MENTOR_TIER1_UPLOAD_LIMIT, 2: store.MENTOR_TIER2_UPLOAD_LIMIT };
    const ratingCounts = { 0: 0, 1: store.MENTOR_TIER1_MIN_MONTHLY_RATINGS, 2: store.MENTOR_TIER2_MIN_MONTHLY_RATINGS };
    return {
      tier,
      uploadLimit: limits[tier] || 0,
      usedThisMonth: 0,
      remainingThisMonth: limits[tier] || 0,
      monthlyRatingCount: ratingCounts[tier] || 0,
      canUploadNow: (limits[tier] || 0) > 0,
      isSimulated: true
    };
  }
  return store.getMentorStatus(email);
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

app.get('/api/popular-chips', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  res.json({ chips: store.getPopularCustomChips(6) });
});

app.get('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const user = store.findUserByEmail(req.session.user.email);
  const mentorStatus = getEffectiveMentorStatus(req.session.user.email);
  res.json({
    displayName: user.displayName || '',
    avatarDataUrl: user.avatarDataUrl || null,
    bio: user.bio || '',
    workingOnChips: user.workingOnChips || [],
    onboardingComplete: !!user.onboardingComplete,
    liveImpulsesEnabled: user.liveImpulsesEnabled !== false, // Standard: an
    gender: user.gender || '',
    matchPreference: user.matchPreference || 'gemischt',
    mentorMode: !!user.mentorMode,
    rating: store.getUserRatingSummary(req.session.user.email),
    canUploadReels: mentorStatus.canUploadNow,
    mentorStatus,
    reelsThreshold: {
      minRating: store.MENTOR_REEL_MIN_RATING,
      tier1: { minMonthlyRatings: store.MENTOR_TIER1_MIN_MONTHLY_RATINGS, uploadLimit: store.MENTOR_TIER1_UPLOAD_LIMIT },
      tier2: { minMonthlyRatings: store.MENTOR_TIER2_MIN_MONTHLY_RATINGS, uploadLimit: store.MENTOR_TIER2_UPLOAD_LIMIT }
    }
  });
});

app.post('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { displayName, avatarDataUrl, liveImpulsesEnabled, gender, matchPreference, mentorMode, bio, workingOnChips, onboardingComplete } = req.body || {};

  if (displayName !== undefined && String(displayName).length > 40) {
    return res.status(400).json({ error: 'Anzeigename darf höchstens 40 Zeichen haben.' });
  }
  if (avatarDataUrl && (typeof avatarDataUrl !== 'string' || !avatarDataUrl.startsWith('data:image/') || avatarDataUrl.length > 400000)) {
    return res.status(400).json({ error: 'Ungültiges Bild oder Bild zu groß.' });
  }
  if (bio !== undefined && String(bio).length > 200) {
    return res.status(400).json({ error: 'Bio darf höchstens 200 Zeichen haben.' });
  }
  if (workingOnChips !== undefined && (!Array.isArray(workingOnChips) || workingOnChips.length > 5 || workingOnChips.some(c => typeof c !== 'string' || c.length > 30))) {
    return res.status(400).json({ error: 'Maximal 5 Themen, je höchstens 30 Zeichen.' });
  }
  const VALID_GENDERS = ['', 'weiblich', 'männlich', 'divers'];
  if (gender !== undefined && !VALID_GENDERS.includes(gender)) {
    return res.status(400).json({ error: 'Ungültige Geschlechts-Angabe.' });
  }
  const VALID_MATCH_PREFS = ['gemischt', 'gleichgeschlechtlich'];
  if (matchPreference !== undefined && !VALID_MATCH_PREFS.includes(matchPreference)) {
    return res.status(400).json({ error: 'Ungültige Matching-Präferenz.' });
  }
  if (matchPreference === 'gleichgeschlechtlich' && !gender && !(store.findUserByEmail(req.session.user.email) || {}).gender) {
    return res.status(400).json({ error: 'Für "Nur gleiches Geschlecht" muss ein Geschlecht angegeben sein.' });
  }

  const users = store.readUsers();
  const user = users.find(u => u.email === req.session.user.email);
  if (!user) return res.status(404).json({ error: 'Konto nicht gefunden.' });

  if (displayName !== undefined) user.displayName = String(displayName).trim();
  if (avatarDataUrl !== undefined) user.avatarDataUrl = avatarDataUrl;
  if (liveImpulsesEnabled !== undefined) user.liveImpulsesEnabled = !!liveImpulsesEnabled;
  if (gender !== undefined) user.gender = gender || null;
  if (matchPreference !== undefined) user.matchPreference = matchPreference;
  if (mentorMode !== undefined) user.mentorMode = !!mentorMode;
  if (bio !== undefined) user.bio = String(bio).trim();
  if (workingOnChips !== undefined) user.workingOnChips = workingOnChips.map(c => c.trim()).filter(Boolean);
  if (onboardingComplete !== undefined) user.onboardingComplete = !!onboardingComplete;

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

/* ---------------- Mentor-Reels: Video-Upload, Feed, Wiedergabe, Löschen ---------------- */

// Öffentlicher Feed aller hochgeladenen Reels (neueste zuerst) — sichtbar für alle
// eingeloggten Nutzer, nicht nur für Mentoren selbst.
app.get('/api/reels', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  res.json({ reels: store.getReelsFeed() });
});

// Video-Upload: nur wer die Bewertungs-Schwelle UND das monatliche Kontingent noch
// nicht aufgebraucht hat, darf hochladen — wird HIER SERVERSEITIG geprüft, nie nur
// im Frontend versteckt.
app.post('/api/reels/upload', express.raw({ type: () => true, limit: '80mb' }), (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });

  const status = getEffectiveMentorStatus(req.session.user.email);
  if (status.tier === 0) {
    return res.status(403).json({ error: `Du brauchst mindestens ${store.MENTOR_TIER1_MIN_MONTHLY_RATINGS} Bewertungen in diesem Monat (Ø mind. ${store.MENTOR_REEL_MIN_RATING}★), um Reels hochzuladen.` });
  }
  if (status.remainingThisMonth <= 0) {
    return res.status(403).json({ error: `Monatliches Upload-Kontingent aufgebraucht (${status.uploadLimit} Videos/Monat auf deiner Stufe). Setzt sich am 1. des nächsten Monats zurück.` });
  }
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'Keine Videodaten erhalten.' });
  }

  const { title, mimeType } = req.query;
  const cleanTitle = (title || '').toString().slice(0, 80);
  const ext = extensionForVideoMimeType(mimeType);
  const token = crypto.randomUUID();

  try {
    ensureReelsDir();
    fs.writeFileSync(path.join(REELS_DIR, token + '.' + ext), req.body);
    store.addReel({ token, uploaderEmail: req.session.user.email, title: cleanTitle, mimeType: mimeType || 'video/webm' });
    res.json({ ok: true, token });
  } catch (err) {
    console.error('Reel-Upload fehlgeschlagen:', err.message);
    res.status(500).json({ error: 'Video konnte nicht gespeichert werden.' });
  }
});

// Video-Wiedergabe (streambar per <video src="...">)
app.get('/api/reels/:token/video', (req, res) => {
  if (!req.session.user) return res.status(401).send('Nicht eingeloggt.');
  const reel = store.findReelByToken(req.params.token);
  if (!reel) return res.status(404).send('Reel nicht gefunden.');
  const ext = extensionForVideoMimeType(reel.mimeType);
  const filePath = path.join(REELS_DIR, req.params.token + '.' + ext);
  if (!fs.existsSync(filePath)) return res.status(404).send('Videodatei nicht mehr vorhanden.');
  res.setHeader('Content-Type', reel.mimeType || 'video/webm');
  res.send(fs.readFileSync(filePath));
});

// Löschen: nur der Uploader selbst (oder ein Admin) darf ein Reel entfernen.
app.post('/api/reels/:token/delete', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const reel = store.findReelByToken(req.params.token);
  if (!reel) return res.status(404).json({ error: 'Reel nicht gefunden.' });

  const isOwner = reel.uploaderEmail === req.session.user.email;
  if (!isOwner && !isAdminEmail(req.session.user.email)) {
    return res.status(403).json({ error: 'Kein Zugriff.' });
  }

  const success = store.deleteReel(req.params.token, reel.uploaderEmail);
  if (success) {
    try {
      const ext = extensionForVideoMimeType(reel.mimeType);
      const filePath = path.join(REELS_DIR, req.params.token + '.' + ext);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Video-Datei konnte nicht gelöscht werden:', err.message);
    }
  }
  res.json({ ok: success });
});

/* ---------------- Async-Pinnwand: offene Fragen posten, andere antworten später ---------------- */

app.get('/api/pinboard', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  res.json({ posts: store.getPinboardPosts() });
});

app.post('/api/pinboard', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { text, topic } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text darf nicht leer sein.' });
  const post = store.addPinboardPost({ authorEmail: req.session.user.email, text, topic });
  if (!post) return res.status(400).json({ error: 'Beitrag konnte nicht erstellt werden.' });
  res.json({ ok: true, post });
});

app.get('/api/pinboard/:id', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const post = store.getPinboardPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  res.json({ post });
});

app.post('/api/pinboard/:id/reply', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Antwort darf nicht leer sein.' });
  const success = store.addPinboardReply(req.params.id, { authorEmail: req.session.user.email, text });
  if (!success) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  res.json({ ok: true });
});

app.post('/api/pinboard/:id/resolve', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { resolved } = req.body || {};
  const success = store.setPinboardPostResolved(req.params.id, req.session.user.email, !!resolved);
  if (!success) return res.status(403).json({ error: 'Nur der Autor kann den Status ändern.' });
  res.json({ ok: true });
});

app.post('/api/pinboard/:id/delete', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const post = store.getPinboardPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  const isOwner = post.authorEmail === req.session.user.email;
  if (!isOwner && !isAdminEmail(req.session.user.email)) {
    return res.status(403).json({ error: 'Kein Zugriff.' });
  }
  const success = store.deletePinboardPost(req.params.id, post.authorEmail);
  res.json({ ok: success });
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

// Admin-Vorschau: setzt (nur) auf dem eigenen Admin-Account eine "So-tun-als-ob"-Stufe,
// damit man die Mentor-Reels-UI ansehen und wirklich testen kann, ohne 200 echte
// Bewertungen sammeln zu müssen. tier: 0, 1, 2 oder null (= zurück zu echten Daten).
app.post('/api/admin/mentor-preview', requireAdmin, (req, res) => {
  const { tier } = req.body || {};
  if (tier !== null && tier !== 0 && tier !== 1 && tier !== 2) {
    return res.status(400).json({ error: 'Ungültige Stufe (0, 1, 2 oder null erwartet).' });
  }
  store.setMentorDebugTier(req.session.user.email, tier);
  res.json({ ok: true, mentorStatus: getEffectiveMentorStatus(req.session.user.email) });
});

app.get('/api/admin/chips', requireAdmin, (req, res) => {
  res.json({ chips: store.getAllCustomChipsWithCounts() });
});

app.post('/api/admin/chips/delete', requireAdmin, (req, res) => {
  const { topic } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Thema erforderlich.' });
  const success = store.deleteCustomChip(topic);
  if (!success) return res.status(404).json({ error: 'Thema nicht gefunden.' });
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
      if (!members) { stopImpulseWatcher(roomId); stopGroupGrowth(roomId); return; }

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

// -------- Gruppen-Wachstum: aus dem 1:1-Call wird über Zeit eine Gruppe --------
// Start: 2 Personen reden. Alle 60 Minuten darf EINE weitere Person dazukommen
// (per Themen-Matching gegen die aktuelle Gruppe), bis maximal 6 Personen im Call sind.
const MAX_GROUP_SIZE = 6;
const GROUP_GROWTH_INTERVAL_MS = 60 * 60 * 1000;      // alle 60 Minuten darf eine Person dazukommen
const GROUP_GROWTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // wie oft wir zwischendurch nachschauen, ob die Stunde um ist

let roomMeta = {};          // roomId -> { lastGrowthAt }
let groupGrowthTimers = {}; // roomId -> Interval-Handle

function startGroupGrowth(roomId) {
  roomMeta[roomId] = { lastGrowthAt: Date.now() };
  groupGrowthTimers[roomId] = setInterval(() => {
    tryGrowGroup(roomId).catch(err => console.error('Gruppen-Wachstum fehlgeschlagen:', err.message));
  }, GROUP_GROWTH_CHECK_INTERVAL_MS);
}

function stopGroupGrowth(roomId) {
  if (groupGrowthTimers[roomId]) {
    clearInterval(groupGrowthTimers[roomId]);
    delete groupGrowthTimers[roomId];
  }
  delete roomMeta[roomId];
}

// Prüft, ob eine Stunde seit dem letzten Zuwachs vergangen ist, und sucht dann EINE
// passende Person aus der Warteschlange, die zum bisherigen Gruppen-Thema passt
// (gleiche Kategorie ODER hoher Prozent-Score gegenüber irgendeinem Gruppenmitglied).
async function tryGrowGroup(roomId) {
  const members = rooms[roomId];
  if (!members || members.length >= MAX_GROUP_SIZE) { stopGroupGrowth(roomId); return; }

  const meta = roomMeta[roomId];
  if (!meta || Date.now() - meta.lastGrowthAt < GROUP_GROWTH_INTERVAL_MS) return; // noch nicht wieder dran

  const memberProfiles = members
    .map(id => { const s = io.sockets.sockets.get(id); return s ? s.data.lastProfile : null; })
    .filter(Boolean);
  if (!memberProfiles.length) return;

  const groupTags = [...new Set(memberProfiles.flatMap(p => p.aiTags || []))];
  const candidates = waiting.slice(0, MAX_ASSOCIATIVE_CHECKS);
  if (!candidates.length) return; // niemand wartet gerade — später nochmal versuchen

  // 1) Schneller Weg: exakte Kategorie-Überschneidung mit irgendeinem Gruppenmitglied
  let chosen = candidates.find(w => sharedTag(w.profile.aiTags, groupTags));

  // 2) Sonst: höchsten Prozent-Score gegenüber IRGENDEINEM Gruppenmitglied ermitteln
  if (!chosen) {
    let bestScore = MIN_ASSOCIATION_PERCENT - 1;
    for (const candidate of candidates) {
      const scoresAgainstGroup = await Promise.all(
        memberProfiles.map(p => computeAssociationScore(p.hangup, candidate.profile.hangup).catch(() => 0))
      );
      const bestForThisCandidate = Math.max(0, ...scoresAgainstGroup);
      if (bestForThisCandidate > bestScore) { bestScore = bestForThisCandidate; chosen = candidate; }
    }
  }

  if (!chosen) return; // gerade niemand passend — nächste Prüfung versucht es wieder

  const newSocket = io.sockets.sockets.get(chosen.socketId);
  if (!newSocket || newSocket.disconnected) return;

  waiting = waiting.filter(w => w.socketId !== chosen.socketId);
  members.push(chosen.socketId);
  newSocket.join(roomId);
  newSocket.data.roomId = roomId;
  meta.lastGrowthAt = Date.now();

  const newDisplay = store.getPublicProfile(chosen.email);

  // Bestehende Mitglieder bauen die WebRTC-Verbindung zur neuen Person auf (sie
  // "kennen" den Raum schon, die neue Person nur die Liste der schon Anwesenden)
  members.forEach(id => {
    if (id === chosen.socketId) return;
    io.to(id).emit('group_member_joined', {
      newPeerId: chosen.socketId, newPeerProfile: chosen.profile, newPeerDisplay: newDisplay
    });
  });

  newSocket.emit('group_joined_existing_call', {
    roomId,
    existingPeers: members.filter(id => id !== chosen.socketId).map(id => {
      const s = io.sockets.sockets.get(id);
      return {
        peerId: id,
        peerProfile: s ? s.data.lastProfile : null,
        peerDisplay: s ? store.getPublicProfile(s.data.email) : null
      };
    })
  });

  if (members.length >= MAX_GROUP_SIZE) stopGroupGrowth(roomId);
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

// Prüft, ob zwei Profile laut ihren Geschlechts-Einstellungen überhaupt zueinander passen.
// "gleichgeschlechtlich" ist ein HARTER Ausschluss — wer das eingestellt hat, wird nur mit
// dem eigenen Geschlecht verbunden, unabhängig davon, wie gut sonst das Thema passen würde.
// Fehlt bei "gleichgeschlechtlich" die Geschlechts-Angabe, wird sicherheitshalber NICHT
// gematcht (lieber warten als versehentlich falsch zuordnen).
function isGenderCompatible(profileA, profileB) {
  const prefA = profileA.matchPreference || 'gemischt';
  const prefB = profileB.matchPreference || 'gemischt';

  if (prefA === 'gleichgeschlechtlich') {
    if (!profileA.gender || !profileB.gender || profileA.gender !== profileB.gender) return false;
  }
  if (prefB === 'gleichgeschlechtlich') {
    if (!profileA.gender || !profileB.gender || profileA.gender !== profileB.gender) return false;
  }
  return true;
}

// Findet ein gemeinsames Tag zwischen zwei Themen-Cluster-Listen, sonst null.
// Diese Kategorien sind zu allgemein, um allein einen Match zu rechtfertigen — sonst
// würden z.B. "Café-Business aufbauen" und "Autopflege-Business aufbauen" fälschlich
// matchen, nur weil beide "Business & Gründung" als Tag bekommen, obwohl die Branchen
// komplett unterschiedlich sind. "KFZ-Werkstatt" und "Autopflege-Business" sollen aber
// über die spezifischere Kategorie "Fahrzeuge & Mobilität" trotzdem zueinander finden.
const GENERIC_TAGS = new Set(['Business & Gründung', 'Sonstiges']);

function sharedTag(tagsA, tagsB) {
  if (!Array.isArray(tagsA) || !Array.isArray(tagsB)) return null;
  const specificA = tagsA.filter(t => !GENERIC_TAGS.has(t));
  const specificB = tagsB.filter(t => !GENERIC_TAGS.has(t));
  return specificA.find(t => specificB.includes(t)) || null;
}

// Gibt { idx, matchedTag } zurück oder null, wenn niemand passt.
// WICHTIG: Die Unterscheidung läuft über den MODUS (mode), nicht darüber, ob ein
// fester Chip (topic) gewählt wurde — sonst würde "Nach Thema" ohne Chip-Auswahl
// (z.B. bei "Autopflege" oder "Blumen", die in keinen der 5 festen Chips passen)
// versehentlich wie "Zufällig" behandelt und am Ende wahllos irgendwen matchen.
//
// Die Geschlechts-Kompatibilität wird IMMER ZUERST geprüft (harter Filter, gilt für
// beide Modi gleichermaßen) — erst innerhalb der dadurch übrig bleibenden Kandidaten
// greift die Themen-Logik.
//
// Reihenfolge im Thema-Modus: 1) exakte Chip-Auswahl  2) gemeinsames KI-Kategorie-
// Cluster (z.B. "KFZ" und "Autofirma" -> beide "Fahrzeuge & Mobilität")  3) direkter
// assoziativer Vergleich der Freitexte über den Wörter-Baum (z.B. "Uhr bauen" <->
// "Thema Zeit"). Gibt es KEINE dieser Verbindungen, wird NICHT gematcht (return null)
// — anders als im Zufalls-Modus, wo als letzter Ausweg irgendwer gematcht wird.
async function findPartnerIndex(profile) {
  const candidates = waiting.filter(w => isGenderCompatible(w.profile, profile));

  if (profile.mode === 'thema') {
    if (profile.topic) {
      const entry = candidates.find(w => w.profile.topic === profile.topic);
      if (entry) return { idx: waiting.indexOf(entry), matchedTag: profile.topic, matchScore: 100 };
    }

    let entry = candidates.find(w => sharedTag(w.profile.aiTags, profile.aiTags));
    if (entry) return { idx: waiting.indexOf(entry), matchedTag: sharedTag(entry.profile.aiTags, profile.aiTags), matchScore: 100 };

    const assocMatch = await findAssociativeMatch(candidates, profile);
    if (assocMatch) return { idx: waiting.indexOf(assocMatch.entry), matchedTag: null, matchScore: assocMatch.score };

    return null; // keine echte Verbindung gefunden -> lieber warten als wahllos matchen
  }

  // Zufalls-Modus: bevorzugt inhaltlich passende Leute, matcht als letzten Ausweg aber
  // irgendwen — ABER NUR unter den geschlechts-kompatiblen Kandidaten
  if (!candidates.length) return null;

  let entry = candidates.find(w => sharedTag(w.profile.aiTags, profile.aiTags));
  if (entry) return { idx: waiting.indexOf(entry), matchedTag: sharedTag(entry.profile.aiTags, profile.aiTags), matchScore: 100 };

  const assocMatch = await findAssociativeMatch(candidates, profile);
  if (assocMatch) return { idx: waiting.indexOf(assocMatch.entry), matchedTag: null, matchScore: assocMatch.score };

  return { idx: waiting.indexOf(candidates[0]), matchedTag: null, matchScore: null };
}

// Prüft die ersten paar (geschlechts-kompatiblen) Wartenden per Direkt-Vergleich
// (Claude ja/nein) auf inhaltliche Verwandtschaft, unabhängig von den festen
// Kategorien. Gibt den passenden Warteschlangen-Eintrag zurück oder null.
// Läuft PARALLEL statt nacheinander: so dauert die Prüfung im schlimmsten Fall nur
// einmal die Zeit für einen API-Aufruf (bzw. dessen Timeout), statt bis zu
// MAX_ASSOCIATIVE_CHECKS-mal hintereinander — das würde sonst die Warteschlange für
// ALLE Nutzer unnötig lange blockieren, da diese Prüfung innerhalb der Matching-Sperre läuft.
// Ab diesem Prozentwert gilt eine Verbindung als "echt genug" fürs Matching im Thema-Modus.
// Bewusst eher hoch angesetzt (60 statt z.B. 50), weil oberflächliche Ähnlichkeiten wie
// "beide gründen ein Geschäft" sonst zu leicht als Verbindung durchgehen können.
const MIN_ASSOCIATION_PERCENT = 60;

// Bewertet alle (geschlechts-kompatiblen) Kandidaten per Prozent-Score und wählt die
// BESTE Übereinstimmung, die den Mindestwert erreicht — statt einfach den ersten zu
// nehmen, der irgendwie passt. Läuft parallel (siehe Kommentar oben in server.js zu
// Timeout/Blockier-Risiko).
async function findAssociativeMatch(candidates, profile) {
  const subset = candidates.slice(0, MAX_ASSOCIATIVE_CHECKS);
  if (!subset.length) return null;

  const scores = await Promise.all(
    subset.map(c => computeAssociationScore(profile.hangup, c.profile.hangup).catch(() => 0))
  );

  let bestIdx = -1;
  let bestScore = MIN_ASSOCIATION_PERCENT - 1; // muss den Mindestwert übertreffen
  scores.forEach((score, i) => {
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });

  return bestIdx === -1 ? null : { entry: subset[bestIdx], score: scores[bestIdx] };
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

  // Live-Zähler: bei jedem Verbinden/Trennen die aktuelle Anzahl an alle senden.
  // io.sockets.sockets.size zählt nur Sockets, die die Auth-Middleware (io.use oben)
  // schon durchlaufen haben — also wirklich eingeloggte, aktive Verbindungen.
  io.emit('active_users_count', { count: io.sockets.sockets.size });

  socket.on('join_queue', (profile) => {
    processJoinQueue(socket, profile);
  });

  async function processJoinQueue(socket, profile) {
    profile = profile || {};

    // Geschlecht + Matching-Präferenz kommen IMMER aus dem gespeicherten Account,
    // niemals vom Client — sonst könnte man den Filter einfach umgehen, indem man
    // im Request andere Werte mitschickt.
    try {
      const dbUser = store.findUserByEmail(socket.data.email);
      profile.gender = (dbUser && dbUser.gender) || null;
      profile.matchPreference = (dbUser && dbUser.matchPreference) || 'gemischt';
      profile.mentorMode = !!(dbUser && dbUser.mentorMode);
    } catch (err) {
      console.error('Geschlechts-/Matching-Einstellung konnte nicht geladen werden:', err.message);
      profile.gender = null;
      profile.matchPreference = 'gemischt';
      profile.mentorMode = false;
    }

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

    // Eigene (nicht-feste) Themen-Chips zählen, damit beliebte Vorschläge für alle
    // Nutzer entstehen können (siehe /api/popular-chips).
    try {
      store.trackCustomChipUsage(profile.topic);
    } catch (err) {
      console.error('Themen-Chip konnte nicht gezählt werden:', err.message);
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
        roomId, partnerProfile: partner.profile, youAre: 'b', matchedTag: match.matchedTag, matchScore: match.matchScore,
        partnerDisplay: store.getPublicProfile(partner.email)
      });
      if (partnerSocket) {
        partnerSocket.emit('matched', {
          roomId, partnerProfile: profile, youAre: 'a', matchedTag: match.matchedTag, matchScore: match.matchScore,
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
      startGroupGrowth(roomId);
      // Jeder bekommt die ID des jeweils ANDEREN Mitglieds mit — die Verbindung wird
      // von Anfang an als "Mesh mit einem Peer" aufgebaut, damit später problemlos
      // weitere Peers dazukommen können, ohne die Verbindungslogik umzubauen.
      members.forEach((id) => {
        const peerId = members.find(m => m !== id);
        const peerSocket = io.sockets.sockets.get(peerId);
        io.to(id).emit('start_call', {
          isOfferer: id === members[0],
          peerId,
          peerProfile: peerSocket ? peerSocket.data.lastProfile : null,
          peerDisplay: peerSocket ? store.getPublicProfile(peerSocket.data.email) : null
        });
      });
    } else {
      socket.to(roomId).emit('call_requested_by_partner');
    }
  });

  // Jedes Signal ist jetzt an EINEN bestimmten Peer adressiert (nicht mehr an den
  // ganzen Raum gebroadcastet) — notwendig, sobald mehr als 2 Personen im Call sind,
  // da sich jedes Peer-Paar eigenständig per WebRTC verbinden muss (Mesh-Topologie).
  socket.on('webrtc_signal', ({ roomId, to, data }) => {
    if (!roomId || !to) return;
    io.to(to).emit('webrtc_signal', { from: socket.id, data });
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
    stopGroupGrowth(roomId);

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
      const hangups = members.map(id => {
        const s = io.sockets.sockets.get(id);
        return s && s.data.lastProfile ? s.data.lastProfile.hangup : '';
      });

      const transcriptText = transcript.map(s => s.speakerLabel + ': ' + s.text).join('\n');
      const aiSummary = transcriptText ? await summarizeWithAI(transcriptText, participantNames, hangups) : null;

      // Persönliches Gedächtnis: Ideen aus diesem Call für zukünftige Calls dieser Personen merken
      if (aiSummary && (aiSummary.ideas.length || aiSummary.actionItems.length || aiSummary.problemLoesungen.length)) {
        try {
          store.addCallSummary({
            roomId, participantEmails,
            summary: aiSummary.summary, ideas: aiSummary.ideas, actionItems: aiSummary.actionItems,
            problemLoesungen: aiSummary.problemLoesungen
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
    // Kurze Verzögerung, damit io.sockets.sockets die Trennung schon verarbeitet hat,
    // bevor wir die neue Zahl an alle Verbliebenen senden.
    setImmediate(() => io.emit('active_users_count', { count: io.sockets.sockets.size }));
  });

  function leaveCurrentRoom(sock, notifyPartner) {
    const roomId = sock.data.roomId;
    if (!roomId) return;

    const members = rooms[roomId];
    const remainingMembers = members ? members.filter(id => id !== sock.id) : [];

    sock.leave(roomId);
    sock.data.roomId = null;

    // Gruppen-Call mit noch mind. 2 verbleibenden Leuten: Raum bleibt für die anderen
    // bestehen, nur die gehende Person wird entfernt und alle anderen informiert.
    if (members && remainingMembers.length >= 2) {
      rooms[roomId] = remainingMembers;
      if (notifyPartner) {
        io.to(roomId).emit('group_member_left', { peerId: sock.id });
      }
      return;
    }

    // Sonst (1:1-Call oder nur noch 1 Person übrig): kompletter Raum wird aufgelöst,
    // wie bisher.
    if (notifyPartner) sock.to(roomId).emit('partner_left');
    delete rooms[roomId];
    delete callRequests[roomId];
    stopImpulseWatcher(roomId);
    stopGroupGrowth(roomId);
    try {
      store.resolveAllOpenImpulsesForRoom(roomId, false);
    } catch (err) {
      console.error('Offene Impulse konnten nicht abgeschlossen werden:', err.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('FlowValu läuft auf Port ' + PORT));
