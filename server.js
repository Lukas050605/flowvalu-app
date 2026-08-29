const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Warteschlange: Array von { socketId, profile }
let waiting = [];
// Aktive Räume: roomId -> [socketIdA, socketIdB]
let rooms = {};
// Wer wartet auf ein Call-Ja vom Partner: roomId -> Set(socketId)
let callRequests = {};

function findPartnerIndex(profile) {
  if (profile.mode === 'thema' && profile.topic) {
    const idx = waiting.findIndex(w => w.profile.topic === profile.topic);
    if (idx !== -1) return idx;
    return -1; // kein Partner zum Thema, nicht auf random ausweichen
  }
  // zufällig: irgendwen nehmen
  return waiting.length ? 0 : -1;
}

io.on('connection', (socket) => {
  socket.on('join_queue', (profile) => {
    profile = profile || {};
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

      socket.emit('matched', { roomId, partnerProfile: partner.profile, youAre: 'b' });
      if (partnerSocket) {
        partnerSocket.emit('matched', { roomId, partnerProfile: profile, youAre: 'a' });
      }
    } else {
      waiting.push({ socketId: socket.id, profile });
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
      // 'a' macht das Angebot (Offer), 'b' antwortet - Rollen fest zugeteilt
      members.forEach((id) => {
        const isOfferer = id === members[0];
        io.to(id).emit('start_call', { isOfferer });
      });
    } else {
      socket.to(roomId).emit('call_requested_by_partner');
    }
  });

  // WebRTC-Signalisierung: Angebot, Antwort und ICE-Kandidaten einfach zwischen
  // den beiden Partnern im Raum weiterreichen - der Server selbst sieht nie
  // Video- oder Audiodaten, nur diese kurzen Verbindungsinfos.
  socket.on('webrtc_signal', ({ roomId, data }) => {
    if (!roomId) return;
    socket.to(roomId).emit('webrtc_signal', data);
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
