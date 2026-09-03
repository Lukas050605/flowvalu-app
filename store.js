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
const KNOWLEDGE_FILE = path.join(__dirname, 'data', 'valu-knowledge.json');
const REEL_LIKES_FILE = path.join(__dirname, 'data', 'reel-likes.json');
const REEL_COMMENTS_FILE = path.join(__dirname, 'data', 'reel-comments.json');
const WAIT_TIMES_FILE = path.join(__dirname, 'data', 'wait-times.json');
const FOLLOWS_FILE = path.join(__dirname, 'data', 'follows.json');

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

/* ---------------- Flow-System (ersetzt "XP" für normale Nutzer) ---------------- */
// Verbindliche Regel aus der Produkt-Spec: KEINE erfundenen Zahlen. Flow wird
// ausschließlich aus echten, bereits vorhandenen Aktivitäten berechnet:
// abgeschlossene Calls, abgegebene Bewertungen, Pinnwand-Beteiligung.
// Die genauen Werte sind bewusst als Konstanten ausgelagert — laut Spec ist die
// exakte Formel eine offene Produktentscheidung, die sich später leicht anpassen lässt.
const FLOW_PER_COMPLETED_CALL = 5;
const FLOW_PER_RATING_GIVEN = 2;
const FLOW_PER_PINBOARD_ACTIVITY = 1;
const FLOW_BONUS_EVERY_N_CALLS = 10; // "seltener Aktivitäts-Impuls" alle 10 Calls
const FLOW_BONUS_AMOUNT = 20;

/* ---------------- Mentor-Level-System (5 Stufen) ---------------- */
// Basiert auf ECHTEN, bereits getrackten Signalen: Gesamt-Bewertungen (alle Zeit),
// Bewertungsschnitt und Reel-Likes. Follower und Kursabschlüsse aus der Spec sind
// als Signale vorgesehen, aber technisch noch nicht gebaut (keine Follow-Funktion,
// keine Kurse) — sie fließen bewusst NICHT ein, bis es diese Features wirklich gibt,
// statt mit erfundenen Platzhalter-Werten zu rechnen.
const MENTOR_LEVELS = [
  { level: 1, key: 'newcomer', label: 'Newcomer', emoji: '🥉', minRatings: 0, minAvg: 0, minLikes: 0 },
  { level: 2, key: 'rising', label: 'Rising Mentor', emoji: '🥈', minRatings: 10, minAvg: 4.0, minLikes: 0 },
  { level: 3, key: 'top', label: 'Top Mentor', emoji: '🥇', minRatings: 50, minAvg: 4.2, minLikes: 20 },
  { level: 4, key: 'elite', label: 'Elite Mentor', emoji: '💎', minRatings: 150, minAvg: 4.5, minLikes: 100 },
  { level: 5, key: 'master', label: 'Flowvalu Master', emoji: '👑', minRatings: 400, minAvg: 4.7, minLikes: 300 }
];

// 5-Stufen-Level für NORMALE Nutzer (Spec-Vorgabe: heißt FLOW, nicht XP!).
// Basiert ausschließlich auf dem echten Flow-Gesamtwert (siehe getFlowBreakdown) —
// keine erfundenen Zahlen, Schwellen vorläufig/anpassbar wie in der Spec vorgesehen.
const USER_LEVELS = [
  { level: 1, key: 'explorer', label: 'Explorer', emoji: '🧭', minFlow: 0 },
  { level: 2, key: 'learner', label: 'Learner', emoji: '📚', minFlow: 50 },
  { level: 3, key: 'doer', label: 'Doer', emoji: '⚡', minFlow: 200 },
  { level: 4, key: 'builder', label: 'Builder', emoji: '🛠️', minFlow: 500 },
  { level: 5, key: 'pro', label: 'Flowvalu Pro', emoji: '🌊', minFlow: 1200 }
];


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
  if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, '[]');
  if (!fs.existsSync(REEL_LIKES_FILE)) fs.writeFileSync(REEL_LIKES_FILE, '[]');
  if (!fs.existsSync(REEL_COMMENTS_FILE)) fs.writeFileSync(REEL_COMMENTS_FILE, '[]');
  if (!fs.existsSync(WAIT_TIMES_FILE)) fs.writeFileSync(WAIT_TIMES_FILE, '[]');
  if (!fs.existsSync(FOLLOWS_FILE)) fs.writeFileSync(FOLLOWS_FILE, '[]');
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
    bio: (user && user.bio) || '',
    workingOnChips: (user && user.workingOnChips) || [],
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
  addReel, findReelByToken, getReelsFeed, getUserReels, deleteReel, getMentorProfiles,
  toggleReelLike, getReelLikeCount, isReelLikedBy,
  addReelComment, getReelComments, deleteReelComment,
  addPinboardPost, getPinboardPosts, getPinboardPost, addPinboardReply,
  deletePinboardPost, setPinboardPostResolved,
  addKnowledgeEntry, getKnowledgeSnippets, getKnowledgeStats,
  getFlowBreakdown, getMentorLevel, MENTOR_LEVELS, setMentorDebugLevel,
  getStreakDays, getTodayCompletedCallStats, getNextStepRecommendation,
  getUserLevel, USER_LEVELS, getMentorDashboardStats,
  logWaitTime, getEstimatedWaitSeconds,
  isFollowing, getFollowerCount, toggleFollow, getFollowedMentors
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

// Öffentlicher Feed: neueste zuerst, mit Anzeige-Infos der Uploader UND Likes/Kommentare angereichert.
function getReelsFeed(limit = 50, viewerEmail = null) {
  return readReels()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(r => ({
      ...r,
      uploaderDisplay: getPublicProfile(r.uploaderEmail),
      likeCount: getReelLikeCount(r.token),
      likedByMe: viewerEmail ? isReelLikedBy(r.token, viewerEmail) : false,
      commentCount: getReelComments(r.token).length
    }));
}

/* ---------------- Reel-Kommentare ---------------- */

function readReelComments() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(REEL_COMMENTS_FILE, 'utf-8'));
}

function writeReelComments(comments) {
  fs.writeFileSync(REEL_COMMENTS_FILE, JSON.stringify(comments, null, 2));
}

function getReelComments(reelToken) {
  return readReelComments()
    .filter(c => c.reelToken === reelToken)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(c => ({ ...c, authorDisplay: getPublicProfile(c.authorEmail) }));
}

function addReelComment(reelToken, authorEmail, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const comments = readReelComments();
  const comment = {
    id: require('crypto').randomUUID(),
    reelToken, authorEmail,
    text: trimmed.slice(0, 300),
    createdAt: Date.now()
  };
  comments.push(comment);
  writeReelComments(comments.slice(-5000));
  return comment;
}

function deleteReelComment(commentId, requesterEmail, isAdmin = false) {
  const comments = readReelComments();
  const comment = comments.find(c => c.id === commentId);
  if (!comment) return false;
  if (comment.authorEmail !== requesterEmail && !isAdmin) return false;
  writeReelComments(comments.filter(c => c.id !== commentId));
  return true;
}

function getUserReels(email) {
  return readReels().filter(r => r.uploaderEmail === email).sort((a, b) => b.createdAt - a.createdAt);
}

// Liste aller Mentoren, die mindestens ein Reel hochgeladen haben — für die
// Mentoren-Übersicht (Profil, Bio, Bewertung, Anzahl Videos), statt nur den
// anonymen Video-Feed zu zeigen.
function getMentorProfiles() {
  const reels = readReels();
  const emails = [...new Set(reels.map(r => r.uploaderEmail))];
  return emails.map(email => {
    const display = getPublicProfile(email);
    const ownReels = reels.filter(r => r.uploaderEmail === email);
    return {
      email,
      displayName: display.displayName,
      avatarDataUrl: display.avatarDataUrl,
      bio: display.bio,
      rating: display.rating,
      reelCount: ownReels.length,
      latestReelAt: Math.max(...ownReels.map(r => r.createdAt))
    };
  }).sort((a, b) => b.latestReelAt - a.latestReelAt);
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

// Analoge Vorschau-Funktion fürs 5-Stufen-Level-System (Newcomer bis Flowvalu Master).
// Gleiche Sicherheitsregel: NUR der eigene Account, wird in server.js auf Admins beschränkt.
function setMentorDebugLevel(email, level) {
  const users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) return false;
  if (level === null || level === undefined) {
    delete user.mentorDebugLevel;
  } else {
    user.mentorDebugLevel = level;
  }
  writeUsers(users);
  return true;
}

/* ---------------- Valu-Wissensbasis: gesammelte Erkenntnisse aus Mentor-Reels ---------------- */
// Das ist die Grundlage fürs "automatische Lernen aus Mentor-Videos" — kein Modell-
// Training, sondern eine wachsende, durchsuchbare Sammlung echter Inhalte, die in
// künftige Impulse/Antworten einfließen kann (siehe valu-ai.js, live-impulse.js).

function readKnowledge() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf-8'));
}

function writeKnowledge(entries) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(entries, null, 2));
}

// Speichert die aus einem Mentor-Reel extrahierten Kernaussagen, verknüpft mit den
// Themen-Kategorien des Reels (für spätere themenbezogene Suche).
function addKnowledgeEntry({ reelToken, uploaderEmail, tags, snippets }) {
  if (!snippets || !snippets.length) return; // nichts Verwertbares -> nichts speichern
  const entries = readKnowledge();
  entries.push({
    reelToken, uploaderEmail,
    tags: Array.isArray(tags) ? tags : [],
    snippets,
    createdAt: Date.now()
  });
  writeKnowledge(entries.slice(-2000)); // Deckel, damit die Datei nicht unbegrenzt wächst
}

// Sucht passende Wissens-Schnipsel zu gegebenen Themen-Tags. Ohne Tags (oder ohne
// Treffer) werden stattdessen ein paar der neuesten Einträge zurückgegeben — besser
// eine unpassende Inspiration als gar keine.
function getKnowledgeSnippets(tags, limit = 3) {
  const entries = readKnowledge();
  if (!entries.length) return [];

  let relevant = entries;
  if (Array.isArray(tags) && tags.length) {
    const filtered = entries.filter(e => e.tags.some(t => tags.includes(t)));
    if (filtered.length) relevant = filtered;
  }

  const allSnippets = relevant.flatMap(e => e.snippets);
  // zufällig mischen, damit nicht immer dieselben Schnipsel auftauchen
  for (let i = allSnippets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSnippets[i], allSnippets[j]] = [allSnippets[j], allSnippets[i]];
  }
  return allSnippets.slice(0, limit);
}

// Für den Admin-Bereich: grober Überblick, wie viel Wissen schon gesammelt wurde.
function getKnowledgeStats() {
  const entries = readKnowledge();
  return {
    totalEntries: entries.length,
    totalSnippets: entries.reduce((sum, e) => sum + e.snippets.length, 0)
  };
}

/* ---------------- Flow-Punkte berechnen ---------------- */

function getCompletedCallCount(email) {
  return readMatches().filter(m => m.hadCall && (m.userAEmail === email || m.userBEmail === email)).length;
}

function getRatingsGivenCount(email) {
  return readRatings().filter(r => r.raterEmail === email).length;
}

function getPinboardActivityCount(email) {
  const posts = readPinboardPosts();
  const ownPosts = posts.filter(p => p.authorEmail === email).length;
  const ownReplies = posts.reduce((sum, p) => sum + p.replies.filter(r => r.authorEmail === email).length, 0);
  return ownPosts + ownReplies;
}

// Vollständige, nachvollziehbare Aufschlüsselung — keine einzelne "Magie-Zahl".
// So kann man im Profil auch anzeigen, WOFÜR man wie viel Flow bekommen hat.
function getFlowBreakdown(email) {
  const completedCalls = getCompletedCallCount(email);
  const ratingsGiven = getRatingsGivenCount(email);
  const pinboardActivity = getPinboardActivityCount(email);

  const fromCalls = completedCalls * FLOW_PER_COMPLETED_CALL;
  const fromRatingsGiven = ratingsGiven * FLOW_PER_RATING_GIVEN;
  const fromPinboard = pinboardActivity * FLOW_PER_PINBOARD_ACTIVITY;
  const bonusCount = Math.floor(completedCalls / FLOW_BONUS_EVERY_N_CALLS);
  const fromBonuses = bonusCount * FLOW_BONUS_AMOUNT;

  return {
    total: fromCalls + fromRatingsGiven + fromPinboard + fromBonuses,
    completedCalls, ratingsGiven, pinboardActivity, bonusCount,
    breakdown: { fromCalls, fromRatingsGiven, fromPinboard, fromBonuses }
  };
}

/* ---------------- Reel-Likes (Basis fürs Mentor-Level-System) ---------------- */

function readReelLikes() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(REEL_LIKES_FILE, 'utf-8'));
}

function writeReelLikes(likes) {
  fs.writeFileSync(REEL_LIKES_FILE, JSON.stringify(likes, null, 2));
}

function getReelLikeCount(reelToken) {
  return readReelLikes().filter(l => l.reelToken === reelToken).length;
}

function isReelLikedBy(reelToken, email) {
  return readReelLikes().some(l => l.reelToken === reelToken && l.email === email);
}

// Schaltet den Like-Status um (liken/entliken) und gibt den neuen Stand zurück.
function toggleReelLike(reelToken, email) {
  const likes = readReelLikes();
  const existingIndex = likes.findIndex(l => l.reelToken === reelToken && l.email === email);
  if (existingIndex >= 0) {
    likes.splice(existingIndex, 1);
    writeReelLikes(likes);
    return { liked: false, count: likes.filter(l => l.reelToken === reelToken).length };
  }
  likes.push({ reelToken, email, createdAt: Date.now() });
  writeReelLikes(likes);
  return { liked: true, count: likes.filter(l => l.reelToken === reelToken).length };
}

/* ---------------- Mentor-Level (5 Stufen) berechnen ---------------- */

// Gesamt-Bewertungen ÜBER DIE GESAMTE ZEIT (nicht nur diesen Monat — die Level sind
// eine langfristige Qualifikation, im Gegensatz zum monatlichen Reels-Kontingent).
function getAllTimeRatingStats(email) {
  const received = readRatings().filter(r => r.ratedEmail === email);
  if (!received.length) return { count: 0, avg: 0 };
  const sum = received.reduce((s, r) => s + r.beliebtheit + r.kreativitaet, 0);
  return { count: received.length, avg: Math.round((sum / (received.length * 2)) * 10) / 10 };
}

function getMentorLevel(email) {
  const { count, avg } = getAllTimeRatingStats(email);
  const likeCount = readReels()
    .filter(r => r.uploaderEmail === email)
    .reduce((sum, r) => sum + getReelLikeCount(r.token), 0);

  // Von der höchsten Stufe abwärts prüfen, die erste erfüllte gewinnt.
  let current = MENTOR_LEVELS[0];
  for (let i = MENTOR_LEVELS.length - 1; i >= 0; i--) {
    const lvl = MENTOR_LEVELS[i];
    if (count >= lvl.minRatings && avg >= lvl.minAvg && likeCount >= lvl.minLikes) {
      current = lvl;
      break;
    }
  }
  const next = MENTOR_LEVELS.find(l => l.level === current.level + 1) || null;

  return {
    ...current,
    stats: { ratingsCount: count, avgRating: avg, likeCount },
    nextLevel: next ? {
      ...next,
      missing: {
        ratings: Math.max(0, next.minRatings - count),
        avgNeeded: next.minAvg,
        likes: Math.max(0, next.minLikes - likeCount)
      }
    } : null // bereits auf höchster Stufe
  };
}

/* ---------------- Neue dynamische Startseite: nur echte Daten, keine erfundenen Zahlen ---------------- */

// Anzahl aufeinanderfolgender Tage (bis heute oder gestern zurückgerechnet), an denen
// diese Person mindestens einen abgeschlossenen Call hatte. Rein aus echten Match-
// Zeitstempeln berechnet.
function getStreakDays(email) {
  const dates = readMatches()
    .filter(m => m.hadCall && (m.userAEmail === email || m.userBEmail === email) && m.startedAt)
    .map(m => m.startedAt.slice(0, 10)); // "YYYY-MM-DD"
  const uniqueDates = [...new Set(dates)].sort().reverse(); // neueste zuerst
  if (!uniqueDates.length) return 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) return 0; // Streak schon gerissen

  let streak = 1;
  let cursor = new Date(uniqueDates[0]);
  for (let i = 1; i < uniqueDates.length; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const expected = cursor.toISOString().slice(0, 10);
    if (uniqueDates[i] === expected) { streak++; } else { break; }
  }
  return streak;
}

// Plattformweit: wie viele abgeschlossene Calls gab es HEUTE (echter Kalendertag)?
// Für den "Community & Trending"-Bereich — reale Zahl, kein Fake.
function getTodayCompletedCallStats() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysMatches = readMatches().filter(m => m.hadCall && m.startedAt && m.startedAt.slice(0, 10) === todayStr);
  const uniquePeople = new Set();
  todaysMatches.forEach(m => { uniquePeople.add(m.userAEmail); uniquePeople.add(m.userBEmail); });
  return { completedCallsToday: todaysMatches.length, peopleToday: uniquePeople.size };
}

// Einfache, ehrliche "Dein nächster Schritt"-Empfehlung — basiert auf echtem Status,
// keine KI-Fantasie. Reihenfolge = Priorität, erste zutreffende Regel gewinnt.
function getNextStepRecommendation(email) {
  const completedCalls = getCompletedCallCount(email);
  const level = getMentorLevel(email);

  if (completedCalls === 0) {
    return { text: 'Starte deinen ersten Call — wähle oben ein Thema, das dich gerade beschäftigt.', action: 'match' };
  }
  if (level.nextLevel && level.nextLevel.missing.ratings > 0 && level.nextLevel.missing.ratings <= 5) {
    return { text: `Nur noch ${level.nextLevel.missing.ratings} Bewertungen bis ${level.nextLevel.emoji} ${level.nextLevel.label}!`, action: 'profile' };
  }
  if (getReelsFeed(1).length > 0) {
    return { text: 'Schau dir an, was Mentoren gerade in ihren Reels teilen.', action: 'reels' };
  }
  return { text: 'Bereit für den nächsten Call? Wähle ein Thema und leg los.', action: 'match' };
}

/* ---------------- Nutzer-Level (5 Stufen, für normale Nutzer) ---------------- */

function getUserLevel(email) {
  const flow = getFlowBreakdown(email).total;

  let current = USER_LEVELS[0];
  for (let i = USER_LEVELS.length - 1; i >= 0; i--) {
    if (flow >= USER_LEVELS[i].minFlow) { current = USER_LEVELS[i]; break; }
  }
  const next = USER_LEVELS.find(l => l.level === current.level + 1) || null;

  return {
    ...current,
    flow,
    nextLevel: next ? { ...next, missingFlow: Math.max(0, next.minFlow - flow) } : null
  };
}

/* ---------------- "Dein Flowvalu" Mentor-Dashboard (Thema 16) ---------------- */
// Bündelt alle bereits vorhandenen, ECHTEN Kennzahlen an einer Stelle. Bewusst OHNE
// Einnahmen/Umsatz — das Monetarisierungs-System existiert noch nicht, da werden
// keine erfundenen Euro-Beträge angezeigt.
function getMentorDashboardStats(email) {
  const rating = getUserRatingSummary(email);
  const level = getMentorLevel(email);
  const flow = getFlowBreakdown(email);
  const streak = getStreakDays(email);

  const ownReels = readReels().filter(r => r.uploaderEmail === email);
  const totalReelLikes = ownReels.reduce((sum, r) => sum + getReelLikeCount(r.token), 0);
  const totalReelComments = ownReels.reduce((sum, r) => sum + getReelComments(r.token).length, 0);

  // Stammkunden: wie viele UNTERSCHIEDLICHE Personen haben schon MEHR ALS EINMAL
  // mit dieser Person telefoniert? (Thema 18 als kleiner Baustein mit eingebaut,
  // weil die Dashboard-Statistik dafür eh schon die Match-Historie durchgeht.)
  const myMatches = readMatches().filter(m => m.hadCall && (m.userAEmail === email || m.userBEmail === email));
  const partnerCounts = {};
  myMatches.forEach(m => {
    const partner = m.userAEmail === email ? m.userBEmail : m.userAEmail;
    partnerCounts[partner] = (partnerCounts[partner] || 0) + 1;
  });
  const returningPartners = Object.values(partnerCounts).filter(c => c > 1).length;

  return {
    rating,
    level,
    flow: flow.total,
    streakDays: streak,
    completedCalls: flow.completedCalls,
    reelCount: ownReels.length,
    totalReelLikes,
    totalReelComments,
    returningPartners
  };
}

/* ---------------- Durchschnittliche Wartezeit (Thema 7) ---------------- */
// Echte, historisch gemessene Wartezeiten — NIE eine Garantie, immer nur eine
// Schätzung basierend auf den letzten tatsächlichen Matches.

function readWaitTimes() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(WAIT_TIMES_FILE, 'utf-8'));
}

function logWaitTime(waitedMs) {
  if (typeof waitedMs !== 'number' || waitedMs < 0) return;
  const entries = readWaitTimes();
  entries.push({ waitedMs, loggedAt: Date.now() });
  // Nur die letzten 500 Einträge behalten — alte Werte sollen die aktuelle
  // Schätzung nicht verfälschen, wenn sich die Nutzerzahl mal stark ändert.
  fs.writeFileSync(WAIT_TIMES_FILE, JSON.stringify(entries.slice(-500), null, 2));
}

// Gibt eine Schätzung in Sekunden zurück, basierend auf den letzten (max. 50)
// echten Wartezeiten der letzten 24 Stunden. Liefert null, wenn noch zu wenige
// Daten vorliegen — dann lieber ehrlich nichts anzeigen als eine erfundene Zahl.
function getEstimatedWaitSeconds() {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = readWaitTimes().filter(e => e.loggedAt >= oneDayAgo).slice(-50);
  if (recent.length < 3) return null; // zu wenig Datenbasis für eine seriöse Schätzung
  const avgMs = recent.reduce((sum, e) => sum + e.waitedMs, 0) / recent.length;
  return Math.round(avgMs / 1000);
}

/* ---------------- Mentoren folgen (Thema 33) ---------------- */

function readFollows() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(FOLLOWS_FILE, 'utf-8'));
}

function writeFollows(follows) {
  fs.writeFileSync(FOLLOWS_FILE, JSON.stringify(follows, null, 2));
}

function isFollowing(followerEmail, mentorEmail) {
  return readFollows().some(f => f.followerEmail === followerEmail && f.mentorEmail === mentorEmail);
}

function getFollowerCount(mentorEmail) {
  return readFollows().filter(f => f.mentorEmail === mentorEmail).length;
}

// Schaltet Folgen/Entfolgen um, gibt den neuen Stand zurück. Man kann sich nicht
// selbst folgen — ergibt inhaltlich keinen Sinn.
function toggleFollow(followerEmail, mentorEmail) {
  if (followerEmail === mentorEmail) return { followed: false, count: getFollowerCount(mentorEmail) };
  const follows = readFollows();
  const idx = follows.findIndex(f => f.followerEmail === followerEmail && f.mentorEmail === mentorEmail);
  if (idx >= 0) {
    follows.splice(idx, 1);
    writeFollows(follows);
    return { followed: false, count: follows.filter(f => f.mentorEmail === mentorEmail).length };
  }
  follows.push({ followerEmail, mentorEmail, createdAt: Date.now() });
  writeFollows(follows);
  return { followed: true, count: follows.filter(f => f.mentorEmail === mentorEmail).length };
}

// Alle Mentoren, denen diese Person folgt, mit Anzeige-Infos angereichert —
// für den "Deine Mentoren"-Bereich (Thema 43) auf der Startseite.
function getFollowedMentors(followerEmail) {
  return readFollows()
    .filter(f => f.followerEmail === followerEmail)
    .map(f => ({ email: f.mentorEmail, display: getPublicProfile(f.mentorEmail) }));
}





