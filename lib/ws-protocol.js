const { logEvent } = require('./logger');
const { send, broadcast, roomPublicState } = require('./message');
const { rooms, createRoom, joinRoom, joinAsSpectator, leaveRoom } = require('./room-manager');
const { scoreAnswer, startNextQuestion, buildRanking } = require('./game-logic');
const { formatQuestion } = require('./questions');
const { GAME_START_DELAY_MS } = require('./config');

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
    createRoom(ws, msg.name, req, msg.totalRounds);
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

  // Participant leaves the room intentionally.
  if (msg.type === 'player:leave') {
    leaveRoom(ws);
    send(ws, { type: 'left' });
    return;
  }

  // Reconnected client restores their session (player or spectator).
  if (msg.type === 'player:rejoin') {
    const room = rooms.get((msg.roomCode || '').toUpperCase());
    if (!room) {
      send(ws, { type: 'error', message: 'Sala no encontrada o expirada.' });
      return;
    }

    const rejoinPlayer = room.players.get(msg.playerId);
    if (rejoinPlayer) {
      rejoinPlayer.ws = ws;
      rejoinPlayer.connected = true;
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
      ws.playerId = rejoinPlayer.id;
      ws.roomCode = room.code;

      send(ws, {
        type: 'joined',
        playerId: rejoinPlayer.id,
        role: rejoinPlayer.isHost ? 'host' : 'player',
        room: roomPublicState(room),
      });

      if (room.state === 'question' && room.currentQuestion) {
        send(ws, {
          type: 'question',
          question: formatQuestion(room.currentQuestion),
          round: room.round,
          totalRounds: room.totalRounds,
          endsAt: room.questionStartedAt + (require('./config')).ROUND_MS,
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
      logEvent('player_rejoined', { roomCode: room.code, playerId: rejoinPlayer.id, name: rejoinPlayer.name });
      return;
    }

    const rejoinSpectator = room.spectators.get(msg.playerId);
    if (rejoinSpectator) {
      rejoinSpectator.ws = ws;
      rejoinSpectator.connected = true;
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
      ws.playerId = rejoinSpectator.id;
      ws.roomCode = room.code;

      send(ws, {
        type: 'joined',
        playerId: rejoinSpectator.id,
        role: 'spectator',
        room: roomPublicState(room),
      });

      if (room.state === 'question' && room.currentQuestion) {
        send(ws, {
          type: 'question',
          question: formatQuestion(room.currentQuestion),
          round: room.round,
          totalRounds: room.totalRounds,
          endsAt: room.questionStartedAt + (require('./config')).ROUND_MS,
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
      logEvent('spectator_rejoined', { roomCode: room.code, spectatorId: rejoinSpectator.id, name: rejoinSpectator.name });
      return;
    }

    send(ws, { type: 'error', message: 'No se pudo reconectar a la sala.' });
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
    setTimeout(() => startNextQuestion(room), GAME_START_DELAY_MS);
    return;
  }

  // Player submits answer for current question.
  if (msg.type === 'answer') {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    // Pass entire answer object to support multiple modes
    const answerData = {
      optionIndex: msg.optionIndex !== undefined ? Number(msg.optionIndex) : undefined,
      chainCorrect: msg.chainCorrect,
      order: msg.order,
    };
    scoreAnswer(room, ws.playerId, answerData);
    return;
  }

  // Basic keepalive/latency ping.
  if (msg.type === 'ping') {
    send(ws, { type: 'pong', now: Date.now() });
  }
}

module.exports = { handleRealtimeMessage };
