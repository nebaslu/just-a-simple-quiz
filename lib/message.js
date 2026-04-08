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

module.exports = {
  send,
  broadcast,
  roomPublicState,
};
