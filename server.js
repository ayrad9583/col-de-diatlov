const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
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
      pages: Array.from({ length: 5 }, (_, i) => ({ id: i, taken: false }))
    });
  }
  return rooms.get(code);
}

function serializeRoom(room) {
  return {
    code: room.code,
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

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, name } = {}) => {
    const code = (roomCode || makeRoomCode()).toUpperCase();
    const room = createRoom(code);
    const safeName = (name || 'Joueur').trim().slice(0, 18) || 'Joueur';

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = safeName;

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
      state: 'menu'
    });

    socket.emit('room:joined', { code, name: safeName });
    io.to(code).emit('room:update', serializeRoom(room));
  });

  socket.on('player:update', (payload = {}) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || !room.players.has(socket.id)) return;

    const player = room.players.get(socket.id);
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

    io.to(roomCode).emit('room:update', serializeRoom(room));
  });

  socket.on('page:take', ({ idx } = {}) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    const pageIndex = Number(idx);
    if (!Number.isInteger(pageIndex)) return;
    if (pageIndex < 0 || pageIndex >= room.pages.length) return;
    if (room.pages[pageIndex].taken) return;

    room.pages[pageIndex].taken = true;
    io.to(roomCode).emit('room:update', serializeRoom(room));
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

    io.to(roomCode).emit('room:update', serializeRoom(room));
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Diatlov lancé sur http://localhost:${PORT}`);
});
