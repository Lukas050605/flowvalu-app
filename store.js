const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.json');
const CALL_SUMMARIES_FILE = path.join(__dirname, 'data', 'call-summaries.json');
const IMPULSE_LOG_FILE = path.join(__dirname, 'data', 'impulse-log.json');
const RATINGS_FILE = path.join(__dirname, 'data', 'ratings.json');
const CUSTOM_CHIPS_FILE = path.join(__dirname, 'data', 'custom-chips.json');
const REELS_FILE = path.join(__dirname, 'data', 'reels.json');
const PINBOARD_FILE = path.join(__dirname, 'data', 'pinboard.json');

// Mentor-Stufen: zählt NUR Bewertungen aus dem AKTUELLEN Kalendermonat (setzt sich also
// automatisch jeden Monat zurück, ohne dass irgendwas manuell "resettet" werden muss).
// Stufe 1 ab 10 Bewertungen/Monat -> 5 Video-Uploads erlaubt.
// Stufe 2 ab 200 Bewertungen/Monat -> 100 Video-Uploads erlaubt.
// Zusätzlich muss der GESAMT-Bewertungsschnitt (alle Zeit) mindestens 4.0 sein — sonst
// könnte jemand mit vielen, aber schlechten Bewertungen trotzdem hochladen.
const MENTOR_REEL_MIN_RATING = 4.0;
const MENTOR_TIER1_MIN_MONTHLY_RATINGS = 10;
const MENTOR_TIER1_UPLOAD_LIMIT = 5;
const MENTOR_TIER2_MIN_MONTHLY_RATINGS = 200;
const MENTOR_TIER2_UPLOAD_LIMIT = 100;

function ensureDataFiles() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');
  if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');
  if (!fs.existsSync(CALL_SUMMARIES_FILE)) fs.writeFileSync(CALL_SUMMARIES_FILE, '[]');
  if (!fs.existsSync(IMPULSE_LOG_FILE)) fs.writeFileSync(IMPULSE_LOG_FILE, '[]');
  if (!fs.existsSync(RATINGS_FILE)) fs.writeFileSync(RATINGS_FILE, '[]');
  if (!fs.existsSync(CUSTOM_CHIPS_FILE)) fs.writeFileSync(CUSTOM_CHIPS_FILE, '{}');
  if (!fs.existsSync(REELS_FILE)) fs.writeFileSync(REELS_FILE, '[]');
  if (!fs.existsSync(PINBOARD_FILE)) fs.writeFileSync(PINBOARD_FILE, '[]');
}

function readUsers() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readReports() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
}

function writeReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2));
}

function readMatches() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf-8'));
}

function writeMatches(matches) {
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2));
}

function findUserByEmail(email) {
  return readUsers().find(u => u.email.toLowerCase() === String(email).toLowerCase());
}

function getPublicProfile(email) {
  const user = findUserByEmail(email);
  const rating = getUserRatingSummary(email);
  return {
    displayName: (user && user.displayName) || email.split('@')[0],
    avatarDataUrl: (user && user.avatarDataUrl) || null,
    rating
  };
}

function findMatchByPdfToken(token) {
  return readMatches().find(m => m.pdfToken === token);
}

/* ---------------- Persönliches Gedächtnis: Zusammenfassungen vergangener Calls ---------------- */

function readCallSummaries() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(CALL_SUMMARIES_FILE, 'utf-8'));
}

function writeCallSummaries(entries) {
  fs.writeFileSync(CALL_SUMMARIES_FILE, JSON.stringify(entries, null, 2));
}

// Speichert die strukturierte KI-Zusammenfassung eines beendeten Calls (nicht nur als PDF,
// sondern als wiederverwendbare Rohdaten), damit spätere Calls darauf zurückgreifen können.
function addCallSummary({ roomId, participantEmails, summary, ideas, actionItems, problemLoesungen }) {
  const entries = readCallSummaries();
  entries.push({
    roomId,
    participantEmails,
    summary: summary || '',
    ideas: Array.isArray(ideas) ? ideas : [],
    actionItems: Array.isArray(actionItems) ? actionItems : [],
    problemLoesungen: Array.isArray(problemLoesungen) ? problemLoesungen : [],
    createdAt: Date.now()
  });
  // Datei nicht unbegrenzt wachsen lassen — die letzten 500 Einträge reichen völlig
  writeCallSummaries(entries.slice(-500));
}

// Gibt die letzten Ideen zurück, die eine Person in FRÜHEREN Calls (nicht im aktuellen
// Raum) besprochen hat — Grundlage fürs "persönliche Gedächtnis" der Live-Impulse.
function getRecentIdeasForUser(email, excludeRoomId, limit = 2) {
  if (!email) return [];
  const entries = readCallSummaries()
    .filter(e => e.roomId !== excludeRoomId && e.participantEmails.includes(email))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3); // aus den letzten 3 Calls dieser Person schöpfen

  const ideas = [];
  for (const e of entries) {
    for (const idea of e.ideas) {
      ideas.push(idea);
      if (ideas.length >= limit) return ideas;
    }
  }
  return ideas;
}

/* ---------------- Globales Lernen: welche Impulse haben wirklich geholfen? ---------------- */

function readImpulseLog() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(IMPULSE_LOG_FILE, 'utf-8'));
}

function writeImpulseLog(entries) {
  fs.writeFileSync(IMPULSE_LOG_FILE, JSON.stringify(entries, null, 2));
}

// Protokolliert einen gesendeten Impuls. "effective" ist zunächst null (unbekannt) und
// wird später nachgetragen: true, wenn das Gespräch danach weiterging, false, wenn der
// Call endete, ohne dass nochmal was gesagt wurde.
function logImpulse({ roomId, text }) {
  const entries = readImpulseLog();
  entries.push({ roomId, text, createdAt: Date.now(), effective: null });
  writeImpulseLog(entries.slice(-1000)); // nicht unbegrenzt wachsen lassen
}

// Markiert den letzten noch offenen (effective === null) Impuls eines Raums als
// erfolgreich oder nicht. Wird aufgerufen, wenn wieder geredet wird (true) bzw. wenn
// der Call endet, ohne dass das passiert ist (false).
function resolveOpenImpulse(roomId, effective) {
  const entries = readImpulseLog();
  // von hinten suchen: der zuletzt gesendete, noch unbewertete Impuls dieses Raums
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].roomId === roomId && entries[i].effective === null) {
      entries[i].effective = effective;
      writeImpulseLog(entries);
      return;
    }
  }
}

// Markiert ALLE noch offenen Impulse eines Raums auf einmal (wird beim Call-Ende genutzt,
// falls aus irgendeinem Grund mehrere unbewertet geblieben sind).
function resolveAllOpenImpulsesForRoom(roomId, effective) {
  const entries = readImpulseLog();
  let changed = false;
  entries.forEach(e => {
    if (e.roomId === roomId && e.effective === null) { e.effective = effective; changed = true; }
  });
  if (changed) writeImpulseLog(entries);
}

// Liefert eine kleine, zufällige Auswahl nachweislich erfolgreicher Impulse als
// Beispiele/Inspiration für neue Impuls-Generierungen (das "globale Lernen").
function getEffectiveImpulseExamples(limit = 3) {
  const effective = readImpulseLog().filter(e => e.effective === true);
  // zufällig mischen, damit nicht immer dieselben Beispiele verwendet werden
  for (let i = effective.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [effective[i], effective[j]] = [effective[j], effective[i]];
  }
  return effective.slice(0, limit).map(e => e.text);
}

module.exports = {
  readUsers, writeUsers, readReports, writeReports,
  readMatches, writeMatches, findUserByEmail, getPublicProfile, findMatchByPdfToken,
  addCallSummary, getRecentIdeasForUser,
  logImpulse, resolveOpenImpulse, resolveAllOpenImpulsesForRoom, getEffectiveImpulseExamples,
  addRating, getUserRatingSummary, hasRated,
  trackCustomChipUsage, getPopularCustomChips, deleteCustomChip, getAllCustomChipsWithCounts,
  isEligibleForReels, getMentorStatus, getMentorTier, setMentorDebugTier,
  MENTOR_REEL_MIN_RATING, MENTOR_TIER1_MIN_MONTHLY_RATINGS, MENTOR_TIER1_UPLOAD_LIMIT,
  MENTOR_TIER2_MIN_MONTHLY_RATINGS, MENTOR_TIER2_UPLOAD_LIMIT,
  addReel, findReelByToken, getReelsFeed, getUserReels, deleteReel,
  addPinboardPost, getPinboardPosts, getPinboardPost, addPinboardReply,
  deletePinboardPost, setPinboardPostResolved
};

/* ---------------- Eigene Themen-Chips: Häufigkeit tracken + vorschlagen ---------------- */

// Die 5 festen Chips zählen nicht als "eigenes" Thema — die sind ja schon fest sichtbar.
const BUILTIN_CHIPS = new Set(['Text', 'Design', 'Business', 'Musik', 'Sonstiges']);

function readCustomChipCounts() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(CUSTOM_CHIPS_FILE, 'utf-8'));
}

function writeCustomChipCounts(counts) {
  fs.writeFileSync(CUSTOM_CHIPS_FILE, JSON.stringify(counts, null, 2));
}

// Zählt eine Themen-Auswahl mit. Wird bei JEDEM Beitritt zur Warteschlange mit Modus
// "Nach Thema" aufgerufen — feste Chips werden ignoriert, nur eigene Eingaben zählen.
function trackCustomChipUsage(topic) {
  if (!topic) return;
  const trimmed = String(topic).trim();
  if (!trimmed || trimmed.length > 40 || BUILTIN_CHIPS.has(trimmed)) return;

  const counts = readCustomChipCounts();
  counts[trimmed] = (counts[trimmed] || 0) + 1;
  writeCustomChipCounts(counts);
}

// Gibt die beliebtesten eigenen Themen zurück (für alle Nutzer als zusätzliche
// Vorschlags-Chips), absteigend nach Häufigkeit sortiert.
function getPopularCustomChips(limit = 6) {
  const counts = readCustomChipCounts();
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic]) => topic);
}

// Für den Admin-Bereich: ALLE getrackten Chips mit Häufigkeit, nicht nur die Top-N.
function getAllCustomChipsWithCounts() {
  const counts = readCustomChipCounts();
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => ({ topic, count }));
}

// Entfernt einen Chip komplett aus der geteilten Vorschlagsliste (z.B. bei
// unangemessenen/Spam-Themen) — nur für den Admin-Bereich gedacht.
function deleteCustomChip(topic) {
  const counts = readCustomChipCounts();
  if (!(topic in counts)) return false;
  delete counts[topic];
  writeCustomChipCounts(counts);
  return true;
}

/* ---------------- Punkte-System: gegenseitige Bewertung nach Calls ---------------- */

function readRatings() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8'));
}

function writeRatings(entries) {
  fs.writeFileSync(RATINGS_FILE, JSON.stringify(entries, null, 2));
}

// Prüft, ob diese Person für DIESEN Call schon bewertet hat (verhindert Mehrfach-Bewertung
// durch wiederholtes Absenden desselben Formulars).
function hasRated(roomId, raterEmail) {
  return readRatings().some(r => r.roomId === roomId && r.raterEmail === raterEmail);
}

// Speichert eine Bewertung. beliebtheit/kreativitaet jeweils 1-5 (ganzzahlig).
// Gibt false zurück (und speichert nichts), wenn schon für diesen Call bewertet wurde
// oder die Werte ungültig sind — Aufrufer prüft das Ergebnis.
function addRating({ roomId, raterEmail, ratedEmail, beliebtheit, kreativitaet }) {
  const b = Math.round(Number(beliebtheit));
  const k = Math.round(Number(kreativitaet));
  if (!roomId || !raterEmail || !ratedEmail || raterEmail === ratedEmail) return false;
  if (!(b >= 1 && b <= 5) || !(k >= 1 && k <= 5)) return false;
  if (hasRated(roomId, raterEmail)) return false;

  const entries = readRatings();
  entries.push({ roomId, raterEmail, ratedEmail, beliebtheit: b, kreativitaet: k, createdAt: Date.now() });
  writeRatings(entries);
  return true;
}

// Fasst alle Bewertungen zusammen, die eine Person erhalten HAT (nicht selbst vergeben).
// "punkte" = Summe aus Beliebtheit + Kreativität über alle Bewertungen — einfache,
// nachvollziehbare Punktzahl, die mit jeder positiven Bewertung wächst.
function getUserRatingSummary(email) {
  const received = readRatings().filter(r => r.ratedEmail === email);
  if (!received.length) {
    return { count: 0, avgBeliebtheit: null, avgKreativitaet: null, punkte: 0 };
  }
  const sumBeliebtheit = received.reduce((sum, r) => sum + r.beliebtheit, 0);
  const sumKreativitaet = received.reduce((sum, r) => sum + r.kreativitaet, 0);
  return {
    count: received.length,
    avgBeliebtheit: Math.round((sumBeliebtheit / received.length) * 10) / 10,
    avgKreativitaet: Math.round((sumKreativitaet / received.length) * 10) / 10,
    punkte: sumBeliebtheit + sumKreativitaet
  };
}

/* ---------------- Mentor-Modus: Stufen-System fürs Reels-Hochladen ---------------- */

// Millisekunden-Zeitpunkt, ab dem der aktuelle Kalendermonat begann — alles davor
// zählt nicht mehr mit. Das ist der ganze Trick fürs automatische "Zurücksetzen":
// wir speichern nichts, sondern filtern bei jedem Aufruf einfach nach diesem Datum.
function startOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

// Wie viele Bewertungen diese Person SEIT BEGINN DES AKTUELLEN MONATS bekommen hat.
function getMonthlyRatingCount(email) {
  const monthStart = startOfCurrentMonth();
  return readRatings().filter(r => r.ratedEmail === email && r.createdAt >= monthStart).length;
}

// Wie viele Reels diese Person SEIT BEGINN DES AKTUELLEN MONATS schon hochgeladen hat.
function getMonthlyUploadCount(email) {
  const monthStart = startOfCurrentMonth();
  return readReels().filter(r => r.uploaderEmail === email && r.createdAt >= monthStart).length;
}

// Ermittelt die aktuelle Mentor-Stufe inkl. monatlichem Upload-Kontingent.
// Wird bei JEDEM Aufruf frisch berechnet — sinkt die Monats-Bewertungszahl (z.B. weil
// ein neuer Monat begonnen hat), sinkt die Stufe automatisch mit.
function getMentorTier(email) {
  const rating = getUserRatingSummary(email);
  if (rating.count === 0) return { tier: 0, uploadLimit: 0 };

  const overallAvg = (rating.avgBeliebtheit + rating.avgKreativitaet) / 2;
  if (overallAvg < MENTOR_REEL_MIN_RATING) return { tier: 0, uploadLimit: 0 };

  const monthlyCount = getMonthlyRatingCount(email);
  if (monthlyCount >= MENTOR_TIER2_MIN_MONTHLY_RATINGS) return { tier: 2, uploadLimit: MENTOR_TIER2_UPLOAD_LIMIT };
  if (monthlyCount >= MENTOR_TIER1_MIN_MONTHLY_RATINGS) return { tier: 1, uploadLimit: MENTOR_TIER1_UPLOAD_LIMIT };
  return { tier: 0, uploadLimit: 0 };
}

// Vollständiger Status fürs Profil/UI: Stufe, Kontingent, schon genutzt, noch übrig.
function getMentorStatus(email) {
  const { tier, uploadLimit } = getMentorTier(email);
  const usedThisMonth = getMonthlyUploadCount(email);
  const remainingThisMonth = Math.max(0, uploadLimit - usedThisMonth);
  return {
    tier,
    uploadLimit,
    usedThisMonth,
    remainingThisMonth,
    monthlyRatingCount: getMonthlyRatingCount(email),
    canUploadNow: remainingThisMonth > 0
  };
}

// Einfache Ja/Nein-Prüfung: darf JETZT noch ein weiteres Reel hochgeladen werden?
// (Stufe erreicht UND monatliches Kontingent noch nicht aufgebraucht.)
function isEligibleForReels(email) {
  return getMentorStatus(email).canUploadNow;
}

/* ---------------- Mentor-Reels: Speicher für Video-Metadaten ---------------- */
// Die eigentliche Videodatei liegt separat auf der Festplatte (siehe server.js,
// gleiches Muster wie bei den Call-PDFs) — hier nur die Metadaten dazu.

function readReels() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(REELS_FILE, 'utf-8'));
}

function writeReels(reels) {
  fs.writeFileSync(REELS_FILE, JSON.stringify(reels, null, 2));
}

function addReel({ token, uploaderEmail, title, mimeType }) {
  const reels = readReels();
  reels.push({
    token, uploaderEmail, title: title || '', mimeType: mimeType || 'video/webm',
    createdAt: Date.now()
  });
  writeReels(reels);
}

function findReelByToken(token) {
  return readReels().find(r => r.token === token);
}

// Öffentlicher Feed: neueste zuerst, mit Anzeige-Infos der Uploader angereichert.
function getReelsFeed(limit = 50) {
  return readReels()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(r => ({ ...r, uploaderDisplay: getPublicProfile(r.uploaderEmail) }));
}

function getUserReels(email) {
  return readReels().filter(r => r.uploaderEmail === email).sort((a, b) => b.createdAt - a.createdAt);
}

// Nur der Uploader selbst darf sein eigenes Reel löschen.
function deleteReel(token, requesterEmail) {
  const reels = readReels();
  const reel = reels.find(r => r.token === token);
  if (!reel || reel.uploaderEmail !== requesterEmail) return false;
  writeReels(reels.filter(r => r.token !== token));
  return true;
}

/* ---------------- Async-Pinnwand: offene Fragen/Blockaden posten, andere antworten ---------------- */
// Macht die App auch dann nützlich, wenn gerade niemand zum Live-Matchen online ist —
// eine Frage/Idee hinterlassen, andere können später (auch offline) drauf antworten.

function readPinboardPosts() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(PINBOARD_FILE, 'utf-8'));
}

function writePinboardPosts(posts) {
  fs.writeFileSync(PINBOARD_FILE, JSON.stringify(posts, null, 2));
}

function addPinboardPost({ authorEmail, text, topic }) {
  const trimmed = String(text || '').trim();
  if (!authorEmail || !trimmed) return null;
  const posts = readPinboardPosts();
  const post = {
    id: require('crypto').randomUUID(),
    authorEmail,
    text: trimmed.slice(0, 500),
    topic: (topic || '').trim().slice(0, 40) || null,
    resolved: false,
    createdAt: Date.now(),
    replies: []
  };
  posts.push(post);
  writePinboardPosts(posts.slice(-1000)); // Deckel, damit die Datei nicht unbegrenzt wächst
  return post;
}

// Liste für die Übersicht: neueste zuerst, mit Anzeige-Infos des Autors und Antwort-Anzahl,
// aber OHNE die vollen Antworten selbst (die holt man erst beim Öffnen eines Beitrags).
function getPinboardPosts(limit = 100) {
  return readPinboardPosts()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(p => ({
      id: p.id,
      authorEmail: p.authorEmail,
      authorDisplay: getPublicProfile(p.authorEmail),
      text: p.text,
      topic: p.topic,
      resolved: p.resolved,
      createdAt: p.createdAt,
      replyCount: p.replies.length
    }));
}

// Einzelner Beitrag inkl. aller Antworten (Anzeige-Infos werden hier erst angereichert).
function getPinboardPost(id) {
  const post = readPinboardPosts().find(p => p.id === id);
  if (!post) return null;
  return {
    ...post,
    authorDisplay: getPublicProfile(post.authorEmail),
    replies: post.replies.map(r => ({ ...r, authorDisplay: getPublicProfile(r.authorEmail) }))
  };
}

function addPinboardReply(postId, { authorEmail, text }) {
  const trimmed = String(text || '').trim();
  if (!authorEmail || !trimmed) return false;
  const posts = readPinboardPosts();
  const post = posts.find(p => p.id === postId);
  if (!post) return false;
  post.replies.push({
    id: require('crypto').randomUUID(),
    authorEmail,
    text: trimmed.slice(0, 500),
    createdAt: Date.now()
  });
  writePinboardPosts(posts);
  return true;
}

// Nur der Autor (oder ein Admin, das prüft server.js) darf seinen Beitrag löschen.
function deletePinboardPost(id, requesterEmail) {
  const posts = readPinboardPosts();
  const post = posts.find(p => p.id === id);
  if (!post || post.authorEmail !== requesterEmail) return false;
  writePinboardPosts(posts.filter(p => p.id !== id));
  return true;
}

// Nur der Autor darf seinen eigenen Beitrag als "gelöst" markieren (oder wieder öffnen).
function setPinboardPostResolved(id, requesterEmail, resolved) {
  const posts = readPinboardPosts();
  const post = posts.find(p => p.id === id);
  if (!post || post.authorEmail !== requesterEmail) return false;
  post.resolved = !!resolved;
  writePinboardPosts(posts);
  return true;
}

/* ---------------- Mentor-Vorschau (nur fürs Testen/Debuggen) ---------------- */
// Setzt eine "so tun als ob"-Stufe auf dem eigenen Account, damit man die Mentor-UI
// ansehen kann, ohne wirklich 200 echte Bewertungen sammeln zu müssen. Wird in
// server.js streng auf Admin-Accounts beschränkt — betrifft NIE echte Nutzer-Daten,
// nur die Anzeige für den Account, der sie selbst gesetzt hat.
function setMentorDebugTier(email, tier) {
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) return false;
  if (tier === null || tier === undefined) {
    delete user.mentorDebugTier;
  } else {
    user.mentorDebugTier = tier;
  }
  writeUsers(users);
  return true;
}
