const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

// Fastify instance with logger disabled to keep output minimal.
const app = Fastify({ logger: false });

// Simple persistent logging to file for production diagnostics.
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 1024 * 1024);
const LOG_MAX_FILES = Number(process.env.LOG_MAX_FILES || 5);
fs.mkdirSync(LOG_DIR, { recursive: true });

function pruneRotatedLogs() {
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((name) => /^server-\d{8}-\d{6}\.log$/.test(name))
    .sort();

  while (files.length > LOG_MAX_FILES) {
    const oldest = files.shift();
    if (oldest) {
      fs.unlinkSync(path.join(LOG_DIR, oldest));
    }
  }
}

function rotateLogIfNeeded() {
  if (!fs.existsSync(LOG_FILE)) return;

  const size = fs.statSync(LOG_FILE).size;
  if (size < LOG_MAX_BYTES) return;

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rotated = path.join(LOG_DIR, `server-${stamp}.log`);
  fs.renameSync(LOG_FILE, rotated);
  pruneRotatedLogs();
}

function logEvent(event, details = {}) {
  rotateLogIfNeeded();
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details });
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

// Runtime tuning knobs (can be overridden by environment variables).
const PORT = Number(process.env.PORT || 3000);
const QUESTIONS_PER_MATCH = Number(process.env.QUESTIONS_PER_MATCH || 10);
const ROUND_MS = Number(process.env.ROUND_MS || 15000);

// Load the question bank once at startup for maximum runtime performance.
const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');
const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));

// In-memory room registry: roomCode -> roomState.
const rooms = new Map();

// Discover local IPv4 addresses to help users connect from other devices.
function getLocalNetworkAddresses() {
  const addresses = [];
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue;
    for (const detail of iface) {
      if (detail.family === 'IPv4' && !detail.internal) {
        addresses.push(detail.address);
      }
    }
  }
  return addresses;
}

// Generate a short human-friendly room code without ambiguous chars (0/O, 1/I).
function randomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Ensure room codes are unique in current process memory.
function createRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) {
    code = randomCode();
  }
  return code;
}

// Validate and normalize display names.
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Jugador';
  const clean = name.trim().slice(0, 22);
  return clean || 'Jugador';
}

// Build a client-safe room snapshot.
function roomPublicState(room) {
  return {
    room: room.code,
    state: room.state,
    round: room.round,
    totalRounds: room.totalRounds,
    players: Array.from(room.players.values())
      .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score),
    spectators: Array.from(room.spectators.values())
      .map((s) => ({ id: s.id, name: s.name, connected: s.connected }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Send one WS message if the socket is still open.
function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

// Broadcast one WS message to all connected players in a room.
function broadcast(room, payload) {
  for (const p of room.players.values()) {
    if (p.connected) {
      send(p.ws, payload);
    }
  }
  for (const s of room.spectators.values()) {
    if (s.connected) {
      send(s.ws, payload);
    }
  }
}

// Infer public protocol for join URLs behind reverse proxies or local HTTP.
function inferProtocol(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.encrypted ? 'https' : 'http';
}

// Shared ranking builder reused in round and game summaries.
function buildRanking(room) {
  return Array.from(room.players.values())
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// Pick a randomized subset of questions for a match.
function pickQuestions(total) {
  const pool = [...QUESTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, total);
}

// Close current round, reveal answer and transient ranking.
function finishRound(room) {
  if (room.state !== 'question' || !room.currentQuestion) return;
  clearTimeout(room.roundTimer);

  const q = room.currentQuestion;
  room.state = 'round_result';

  const ranking = buildRanking(room);

  room.lastRoundResult = {
    correctIndex: q.answerIndex,
    explanation: q.explanation,
    scores: ranking,
  };
  logEvent('round_finished', { roomCode: room.code, round: room.round, correctIndex: q.answerIndex });

  broadcast(room, {
    type: 'round:result',
    correctIndex: q.answerIndex,
    explanation: q.explanation,
    scores: ranking,
    room: roomPublicState(room),
  });

  room.currentQuestion = null;

  setTimeout(() => {
    startNextQuestion(room);
  }, 3500);
}

// Evaluate one player answer, apply score and auto-close when all have answered.
function scoreAnswer(room, playerId, optionIndex) {
  if (room.state !== 'question' || !room.currentQuestion) return;
  if (room.answeredPlayers.has(playerId)) return;

  const player = room.players.get(playerId);
  if (!player || !player.connected) return;

  room.answeredPlayers.add(playerId);

  const elapsed = Date.now() - room.questionStartedAt;
  const clampedElapsed = Math.max(0, Math.min(ROUND_MS, elapsed));
  const speedFactor = 1 - clampedElapsed / ROUND_MS;

  if (optionIndex === room.currentQuestion.answerIndex) {
    const points = 600 + Math.round(400 * speedFactor);
    player.score += points;
  }

  send(player.ws, { type: 'answer:ack', accepted: true });

  const activePlayers = Array.from(room.players.values()).filter((p) => p.connected).length;
  if (room.answeredPlayers.size >= activePlayers) {
    finishRound(room);
  }
}

// Finalize game and publish final ranking.
function endGame(room) {
  room.state = 'ended';
  clearTimeout(room.roundTimer);
  room.currentQuestion = null;

  const ranking = buildRanking(room);
  room.finalRanking = ranking;
  logEvent('game_ended', { roomCode: room.code, totalRounds: room.totalRounds, players: room.players.size });

  broadcast(room, {
    type: 'game:over',
    scores: ranking,
    room: roomPublicState(room),
  });
}

// Advance game flow to next question or finish match if no rounds remain.
function startNextQuestion(room) {
  if (room.state === 'ended') return;

  if (room.round >= room.totalRounds) {
    endGame(room);
    return;
  }

  const q = room.questions[room.round];
  if (!q) {
    endGame(room);
    return;
  }

  room.round += 1;
  room.state = 'question';
  room.currentQuestion = q;
  room.answeredPlayers = new Set();
  room.questionStartedAt = Date.now();
  logEvent('question_started', { roomCode: room.code, round: room.round, questionId: q.id });

  const endsAt = room.questionStartedAt + ROUND_MS;

  broadcast(room, {
    type: 'question',
    question: {
      id: q.id,
      category: q.category,
      difficulty: q.difficulty,
      text: q.question,
      options: q.options,
    },
    round: room.round,
    totalRounds: room.totalRounds,
    endsAt,
    room: roomPublicState(room),
  });

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => finishRound(room), ROUND_MS + 25);
}

// Create a lobby and register host player.
function createRoom(hostWs, hostName, req) {
  const code = createRoomCode();
  const id = `host_${Math.random().toString(36).slice(2, 8)}`;
  const protocol = inferProtocol(req);
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const joinUrl = `${protocol}://${hostHeader}/?room=${code}`;

  const room = {
    code,
    hostId: id,
    players: new Map(),
    spectators: new Map(),
    createdAt: Date.now(),
    state: 'lobby',
    round: 0,
    totalRounds: QUESTIONS_PER_MATCH,
    questions: pickQuestions(QUESTIONS_PER_MATCH),
    currentQuestion: null,
    answeredPlayers: new Set(),
    questionStartedAt: 0,
    roundTimer: null,
    cleanupTimer: null,
    lastRoundResult: null,
    finalRanking: null,
  };

  room.players.set(id, {
    id,
    name: sanitizeName(hostName),
    score: 0,
    ws: hostWs,
    connected: true,
    isHost: true,
  });

  rooms.set(code, room);
  logEvent('room_created', { roomCode: code, hostName: sanitizeName(hostName) });

  send(hostWs, {
    type: 'room:created',
    room: roomPublicState(room),
    roomCode: code,
    joinUrl,
  });
}

// Join as active player (only during lobby).
function joinRoom(playerWs, roomCode, playerName) {
  const room = rooms.get((roomCode || '').toUpperCase());
  if (!room) {
    send(playerWs, { type: 'error', message: 'Sala no encontrada.' });
    return;
  }

  if (room.state !== 'lobby') {
    send(playerWs, { type: 'error', message: 'La partida ya ha comenzado.' });
    return;
  }

  const id = `p_${Math.random().toString(36).slice(2, 10)}`;
  room.players.set(id, {
    id,
    name: sanitizeName(playerName),
    score: 0,
    ws: playerWs,
    connected: true,
    isHost: false,
  });
  logEvent('player_joined', { roomCode: room.code, playerName: sanitizeName(playerName), playerId: id });

  playerWs.playerId = id;
  playerWs.roomCode = room.code;

  send(playerWs, {
    type: 'joined',
    playerId: id,
    room: roomPublicState(room),
  });

  broadcast(room, { type: 'room:update', room: roomPublicState(room) });
}

// Join as spectator (allowed at any room state).
function joinAsSpectator(ws, roomCode, spectatorName) {
  const room = rooms.get((roomCode || '').toUpperCase());
  if (!room) {
    send(ws, { type: 'error', message: 'Sala no encontrada.' });
    return;
  }

  const id = `s_${Math.random().toString(36).slice(2, 10)}`;
  room.spectators.set(id, {
    id,
    name: sanitizeName(spectatorName || 'Espectador'),
    ws,
    connected: true,
  });
  logEvent('spectator_joined', {
    roomCode: room.code,
    spectatorName: sanitizeName(spectatorName || 'Espectador'),
    spectatorId: id,
  });

  ws.playerId = id;
  ws.roomCode = room.code;

  send(ws, {
    type: 'joined',
    role: 'spectator',
    playerId: id,
    room: roomPublicState(room),
  });

  // Sync new spectator with current room phase.
  if (room.state === 'question' && room.currentQuestion) {
    send(ws, {
      type: 'question',
      question: {
        id: room.currentQuestion.id,
        category: room.currentQuestion.category,
        difficulty: room.currentQuestion.difficulty,
        text: room.currentQuestion.question,
        options: room.currentQuestion.options,
      },
      round: room.round,
      totalRounds: room.totalRounds,
      endsAt: room.questionStartedAt + ROUND_MS,
      room: roomPublicState(room),
    });
  } else if (room.state === 'round_result' && room.lastRoundResult) {
    send(ws, {
      type: 'round:result',
      correctIndex: room.lastRoundResult.correctIndex,
      explanation: room.lastRoundResult.explanation,
      scores: room.lastRoundResult.scores,
      room: roomPublicState(room),
    });
  } else if (room.state === 'ended') {
    send(ws, {
      type: 'game:over',
      scores: room.finalRanking || buildRanking(room),
      room: roomPublicState(room),
    });
  }

  broadcast(room, { type: 'room:update', room: roomPublicState(room) });
}

// Handle socket disconnect cleanup and host room shutdown behavior.
function disconnectPlayer(ws) {
  const { roomCode, playerId } = ws;
  if (!roomCode || !playerId) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players.get(playerId);
  const spectator = room.spectators.get(playerId);
  if (!player && !spectator) return;

  if (spectator) {
    spectator.connected = false;
    logEvent('spectator_disconnected', { roomCode: room.code, spectatorId: playerId, name: spectator.name });
    broadcast(room, { type: 'room:update', room: roomPublicState(room) });

    const activeAfterSpectator = Array.from(room.players.values()).some((p) => p.connected)
      || Array.from(room.spectators.values()).some((s) => s.connected);
    if (!activeAfterSpectator) {
      room.cleanupTimer = setTimeout(() => {
        rooms.delete(room.code);
      }, 30000);
    }
    return;
  }

  player.connected = false;
  logEvent('player_disconnected', { roomCode: room.code, playerId, name: player.name, isHost: !!player.isHost });

  if (player.isHost) {
    // If host leaves, close room to avoid orphan game state.
    broadcast(room, {
      type: 'error',
      message: 'El anfitrion se ha desconectado. Sala cerrada.',
    });
    clearTimeout(room.roundTimer);
    rooms.delete(room.code);
    logEvent('room_closed_host_disconnected', { roomCode: room.code });
    return;
  }

  broadcast(room, { type: 'room:update', room: roomPublicState(room) });

  const active = Array.from(room.players.values()).some((p) => p.connected)
    || Array.from(room.spectators.values()).some((s) => s.connected);
  if (!active) {
    room.cleanupTimer = setTimeout(() => {
      rooms.delete(room.code);
    }, 30000);
  }
}

// Enable websocket support and static file serving.
app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
});

// Health endpoint for quick diagnostics.
app.get('/api/health', async () => ({ ok: true, rooms: rooms.size }));

// Expose loaded question count.
app.get('/api/questions/count', async () => ({ total: QUESTIONS.length }));

// Expose discovered local network interfaces.
app.get('/api/network', async () => ({
  addresses: getLocalNetworkAddresses(),
  port: PORT,
}));

// Return SVG QR for arbitrary text (used to join room by URL).
app.get('/api/qr', async (req, reply) => {
  const text = typeof req.query.text === 'string' ? req.query.text : '';
  if (!text) {
    return reply.code(400).send({ error: 'Falta query param text' });
  }

  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 280 });
  reply.header('Content-Type', 'image/svg+xml');
  return reply.send(svg);
});

// Raw ws server mounted over the same HTTP server used by Fastify.
const wss = new WebSocketServer({ noServer: true });

function handleRealtimeMessage(ws, req, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    logEvent('ws_invalid_json');
    send(ws, { type: 'error', message: 'JSON invalido.' });
    return;
  }

  logEvent('ws_message', {
    type: msg.type || null,
    roomCode: ws.roomCode || null,
    playerId: ws.playerId || null,
  });

  // Host requests room creation.
  if (msg.type === 'host:create') {
    createRoom(ws, msg.name, req);
    const created = Array.from(rooms.values()).find((room) => room.players.get(room.hostId)?.ws === ws);
    if (created) {
      ws.playerId = created.hostId;
      ws.roomCode = created.code;
    }
    return;
  }

  // Player requests join existing room.
  if (msg.type === 'player:join') {
    joinRoom(ws, msg.room, msg.name);
    return;
  }

  // Spectator requests join existing room in any state.
  if (msg.type === 'spectator:join') {
    joinAsSpectator(ws, msg.room, msg.name);
    return;
  }

  // Host starts match from lobby state.
  if (msg.type === 'host:start') {
    const room = rooms.get(ws.roomCode);
    if (!room || ws.playerId !== room.hostId) {
      send(ws, { type: 'error', message: 'No autorizado para iniciar la partida.' });
      return;
    }
    if (room.players.size < 1) {
      send(ws, { type: 'error', message: 'No hay jugadores en la sala.' });
      return;
    }
    room.state = 'starting';
    logEvent('game_start_requested', { roomCode: room.code, by: ws.playerId });
    broadcast(room, { type: 'room:update', room: roomPublicState(room) });
    setTimeout(() => startNextQuestion(room), 900);
    return;
  }

  // Player submits answer for current question.
  if (msg.type === 'answer') {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    scoreAnswer(room, ws.playerId, Number(msg.optionIndex));
    return;
  }

  // Basic keepalive/latency ping.
  if (msg.type === 'ping') {
    send(ws, { type: 'pong', now: Date.now() });
  }
}

wss.on('connection', (ws, req) => {
  logEvent('ws_connected', { remoteAddress: req.socket?.remoteAddress || null });

  ws.on('message', (raw) => {
    handleRealtimeMessage(ws, req, raw);
  });

  ws.on('close', () => {
    logEvent('ws_closed', { roomCode: ws.roomCode || null, playerId: ws.playerId || null });
    disconnectPlayer(ws);
  });
});

app.server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url || '/', 'http://localhost');

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// Serve single-page client.
app.get('/', async (req, reply) => reply.sendFile('index.html'));

process.on('uncaughtException', (error) => {
  logEvent('uncaught_exception', { message: error.message, stack: error.stack || null });
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack || null : null;
  logEvent('unhandled_rejection', { message, stack });
  console.error('Unhandled rejection:', reason);
});

// Start HTTP server on all interfaces to allow LAN devices to connect.
app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    logEvent('server_started', { port: PORT, pid: process.pid, questionsLoaded: QUESTIONS.length });
    console.log(`Quiz server listening on http://localhost:${PORT}`);
  })
  .catch((error) => {
    logEvent('server_start_error', { message: error.message, stack: error.stack || null });
    console.error('Server start error:', error);
    process.exit(1);
  });
