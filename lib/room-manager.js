const { logEvent } = require('./logger');
const { send, broadcast, roomPublicState } = require('./message');
const { sanitizeName, normalizeTotalRounds, randomCode } = require('./utils');
const { inferProtocol, resolveJoinHost } = require('./network');
const { pickQuestionsWithThemes, formatQuestion } = require('./questions');
const { startNextQuestion } = require('./game-logic');
const { ROUND_MS } = require('./config');

// In-memory room registry: roomCode -> roomState.
const rooms = new Map();

// Ensure room codes are unique in current process memory.
function createRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) {
    code = randomCode();
  }
  return code;
}

// Create a lobby and register host player.
function createRoom(hostWs, hostName, req, requestedTotalRounds) {
  const code = createRoomCode();
  const id = `host_${Math.random().toString(36).slice(2, 8)}`;
  const protocol = inferProtocol(req);
  const hostHeader = resolveJoinHost(req);
  const joinUrl = `${protocol}://${hostHeader}/?room=${code}`;
  const totalRounds = normalizeTotalRounds(requestedTotalRounds);

  const room = {
    code,
    hostId: id,
    joinUrl,
    players: new Map(),
    spectators: new Map(),
    createdAt: Date.now(),
    state: 'lobby',
    round: 0,
    totalRounds: totalRounds,
    questions: pickQuestionsWithThemes(totalRounds),
    currentQuestion: null,
    answeredPlayers: new Set(),
    questionStartedAt: 0,
    roundTimer: null,
    roundEndScheduled: null,
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
    joinUrl: room.joinUrl,
    room: roomPublicState(room),
  });

  broadcast(room, { type: 'room:update', room: roomPublicState(room) });
}

// Join as spectator (only allowed while room is in lobby state).
function joinAsSpectator(ws, roomCode, spectatorName) {
  const room = rooms.get((roomCode || '').toUpperCase());
  if (!room) {
    send(ws, { type: 'error', message: 'Sala no encontrada.' });
    return;
  }

  if (room.state !== 'lobby') {
    send(ws, { type: 'error', message: 'La partida ya ha comenzado.' });
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
    joinUrl: room.joinUrl,
    room: roomPublicState(room),
  });

  // Sync new spectator with current room phase.
  if (room.state === 'question' && room.currentQuestion) {
    send(ws, {
      type: 'question',
      question: formatQuestion(room.currentQuestion),
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
      scores: room.finalRanking,
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
    // Ignore stale close events if the spectator already reconnected with a newer ws.
    if (spectator.ws !== ws) return;

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

  // Ignore stale close events if the player already reconnected with a newer ws.
  if (player.ws !== ws) return;

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

// Explicit leave action requested by client to exit room immediately.
function leaveRoom(ws) {
  const { roomCode, playerId } = ws;
  if (!roomCode || !playerId) return;

  const room = rooms.get(roomCode);
  if (!room) {
    ws.roomCode = null;
    ws.playerId = null;
    return;
  }

  const player = room.players.get(playerId);
  const spectator = room.spectators.get(playerId);
  if (!player && !spectator) {
    ws.roomCode = null;
    ws.playerId = null;
    return;
  }

  if (spectator) {
    room.spectators.delete(playerId);
    logEvent('spectator_left', { roomCode: room.code, spectatorId: playerId, name: spectator.name });
    broadcast(room, { type: 'room:update', room: roomPublicState(room) });

    if (room.players.size === 0 && room.spectators.size === 0) {
      clearTimeout(room.roundTimer);
      clearTimeout(room.cleanupTimer);
      rooms.delete(room.code);
    }

    ws.roomCode = null;
    ws.playerId = null;
    return;
  }

  if (player.isHost) {
    broadcast(room, {
      type: 'error',
      message: 'El anfitrion abandono la partida. Sala cerrada.',
    });
    clearTimeout(room.roundTimer);
    clearTimeout(room.cleanupTimer);
    rooms.delete(room.code);
    logEvent('room_closed_host_left', { roomCode: room.code });
    ws.roomCode = null;
    ws.playerId = null;
    return;
  }

  room.players.delete(playerId);
  room.answeredPlayers.delete(playerId);
  logEvent('player_left', { roomCode: room.code, playerId, name: player.name });

  if (room.state === 'question') {
    const activePlayers = Array.from(room.players.values()).filter((p) => p.connected).length;
    if (room.answeredPlayers.size >= activePlayers) {
      const { finishRound } = require('./game-logic');
      finishRound(room);
      ws.roomCode = null;
      ws.playerId = null;
      return;
    }
  }

  broadcast(room, { type: 'room:update', room: roomPublicState(room) });

  if (room.players.size === 0 && room.spectators.size === 0) {
    clearTimeout(room.roundTimer);
    clearTimeout(room.cleanupTimer);
    rooms.delete(room.code);
  }

  ws.roomCode = null;
  ws.playerId = null;
}

module.exports = {
  rooms,
  createRoomCode,
  createRoom,
  joinRoom,
  joinAsSpectator,
  disconnectPlayer,
  leaveRoom,
};
