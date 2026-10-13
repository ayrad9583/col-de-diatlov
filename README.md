const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'DIA';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: new Map(),
      pages: Array.from({ length: 5 }, (_, i) => ({ id: i, taken: false })),
      started: false,
      ended: false,
      winnerId: null
    });
  }
  return rooms.get(code);
}

function serializeRoom(room) {
  return {
    code: room.code,
    started: room.started,
    ended: room.ended,
    winnerId: room.winnerId,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      san: player.san,
      bat: player.bat,
      sta: player.sta,
      pages: player.pages,
      state: player.state
    })),
    pages: room.pages.map((page) => ({ ...page }))
  };
}

function emitRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('room:update', serializeRoom(room));
}

function allPagesTaken(room) {
  return room.pages.every((page) => page.taken);
}

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'col-de-diatlov-hors-ligne-multijoueur.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, name } = {}) => {
    const code = (roomCode || makeRoomCode()).toUpperCase();
    const room = createRoom(code);
    const safeName = (name || 'Joueur').trim().slice(0, 18) || 'Joueur';

    if (room.players.size >= 2 && !room.players.has(socket.id)) {
      socket.emit('room:error', 'La salle est pleine.');
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = safeName;

    const existing = room.players.get(socket.id);
    if (!existing) {
      room.players.set(socket.id, {
        id: socket.id,
        name: safeName,
        x: 6,
        y: 1.7,
        z: 152,
        yaw: 0,
        pitch: 0,
        san: 100,
        bat: 100,
        sta: 100,
        pages: 0,
        state: 'lobby'
      });
    } else {
      existing.name = safeName;
    }

    socket.emit('room:joined', { code, name: safeName });
    emitRoom(code);

    if (room.players.size >= 2 && !room.started) {
      room.started = true;
      room.ended = false;
      room.winnerId = null;
      io.to(code).emit('game:start', { code });
      emitRoom(code);
    }
  });

  socket.on('player:update', (payload = {}) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    Object.assign(player, {
      x: Number(payload.x ?? player.x),
      y: Number(payload.y ?? player.y),
      z: Number(payload.z ?? player.z),
      yaw: Number(payload.yaw ?? player.yaw),
      pitch: Number(payload.pitch ?? player.pitch),
      san: Number(payload.san ?? player.san),
      bat: Number(payload.bat ?? player.bat),
      sta: Number(payload.sta ?? player.sta),
      pages: Number(payload.pages ?? player.pages),
      state: payload.state || player.state
    });

    emitRoom(roomCode);
  });

  socket.on('page:take', ({ idx } = {}) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room || room.ended) return;

    const pageIndex = Number(idx);
    if (!Number.isInteger(pageIndex)) return;
    if (pageIndex < 0 || pageIndex >= room.pages.length) return;
    if (room.pages[pageIndex].taken) return;

    room.pages[pageIndex].taken = true;

    const player = room.players.get(socket.id);
    if (player) {
      player.pages = (player.pages || 0) + 1;
    }

    if (allPagesTaken(room)) {
      room.ended = true;
      room.winnerId = socket.id;
      io.to(roomCode).emit('game:end', { winnerId: socket.id, reason: 'pages' });
    }

    emitRoom(roomCode);
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(roomCode);
      return;
    }

    emitRoom(roomCode);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Diatlov lancé sur http://localhost:${PORT}`);
});
