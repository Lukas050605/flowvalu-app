const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const store = require('./store');

const REPORT_BAN_THRESHOLD = 3; // ab so vielen Meldungen wird automatisch gesperrt

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
  const users = store.readUsers();
  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    banned: false,
    reportCount: 0,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  store.writeUsers(users);

  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true, email: user.email });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = store.findUserByEmail(email || '');
  if (!user) return res.status(400).json({ error: 'E-Mail oder Passwort falsch.' });
  if (user.banned) return res.status(403).json({ error: 'Dieses Konto wurde wegen mehrerer Meldungen gesperrt.' });

  const match = await bcrypt.compare(password || '', user.passwordHash);
  if (!match) return res.status(400).json({ error: 'E-Mail oder Passwort falsch.' });

  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true, email: user.email });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

/* ---------------- Profil-Routen ---------------- */

app.get('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const user = store.findUserByEmail(req.session.user.email);
  res.json({
    displayName: user.displayName || '',
    avatarDataUrl: user.avatarDataUrl || null
  });
});

app.post('/api/profile', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  const { displayName, avatarDataUrl } = req.body || {};

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

  store.writeUsers(users);
  res.json({ ok: true });
});

/* ---------------- Verlauf-Route ---------------- */

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
let roomToMatchId = {};     // roomId -> matches.json Eintrags-ID (um hadCall nachzutragen)

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

function findPartnerIndex(profile) {
  if (profile.mode === 'thema' && profile.topic) {
    const idx = waiting.findIndex(w => w.profile.topic === profile.topic);
    if (idx !== -1) return idx;
    return -1;
  }
  return waiting.length ? 0 : -1;
}

io.use((socket, next) => {
  const sessionUser = socket.request.session && socket.request.session.user;
  if (!sessionUser) {
    return next(new Error('not_authenticated'));
  }
  socket.data.email = sessionUser.email;
  next();
});

io.on('connection', (socket) => {
  userSockets[socket.data.email] = socket.id;

  socket.on('join_queue', (profile) => {
    profile = profile || {};
    socket.data.lastProfile = profile;
    const idx = findPartnerIndex(profile);

    if (idx !== -1) {
      const partner = waiting.splice(idx, 1)[0];
      const roomId = crypto.randomUUID();
      rooms[roomId] = [partner.socketId, socket.id];

      socket.join(roomId);
      const partnerSocket = io.sockets.sockets.get(partner.socketId);
      if (partnerSocket) partnerSocket.join(roomId);

      socket.data.roomId = roomId;
      if (partnerSocket) partnerSocket.data.roomId = roomId;

      logMatch(partner.email, socket.data.email, partner.profile, profile, roomId);

      socket.emit('matched', {
        roomId, partnerProfile: partner.profile, youAre: 'b',
        partnerDisplay: store.getPublicProfile(partner.email)
      });
      if (partnerSocket) {
        partnerSocket.emit('matched', {
          roomId, partnerProfile: profile, youAre: 'a',
          partnerDisplay: store.getPublicProfile(socket.data.email)
        });
      }
    } else {
      waiting.push({ socketId: socket.id, profile, email: socket.data.email });
      socket.emit('waiting', { position: waiting.length });
    }
  });

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
    sock.data.roomId = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('FlowValu läuft auf Port ' + PORT));
