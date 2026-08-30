const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.json');
const CALL_SUMMARIES_FILE = path.join(__dirname, 'data', 'call-summaries.json');
const IMPULSE_LOG_FILE = path.join(__dirname, 'data', 'impulse-log.json');

function ensureDataFiles() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');
  if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');
  if (!fs.existsSync(CALL_SUMMARIES_FILE)) fs.writeFileSync(CALL_SUMMARIES_FILE, '[]');
  if (!fs.existsSync(IMPULSE_LOG_FILE)) fs.writeFileSync(IMPULSE_LOG_FILE, '[]');
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
  if (!user) return { displayName: email.split('@')[0], avatarDataUrl: null };
  return {
    displayName: user.displayName || email.split('@')[0],
    avatarDataUrl: user.avatarDataUrl || null
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
function addCallSummary({ roomId, participantEmails, summary, ideas, actionItems }) {
  const entries = readCallSummaries();
  entries.push({
    roomId,
    participantEmails,
    summary: summary || '',
    ideas: Array.isArray(ideas) ? ideas : [],
    actionItems: Array.isArray(actionItems) ? actionItems : [],
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
  logImpulse, resolveOpenImpulse, resolveAllOpenImpulsesForRoom, getEffectiveImpulseExamples
};
