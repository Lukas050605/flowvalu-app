const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.json');

function ensureDataFiles() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(REPORTS_FILE)) fs.writeFileSync(REPORTS_FILE, '[]');
  if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');
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

module.exports = {
  readUsers, writeUsers, readReports, writeReports,
  readMatches, writeMatches, findUserByEmail, getPublicProfile
};
