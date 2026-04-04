// Small DOM helper by id.
const $ = (id) => document.getElementById(id);

// Client-side runtime state for one browser session.
const state = {
  ws: null,
  role: null,
  roomCode: null,
  playerId: null,
  currentQuestion: null,
  answered: false,
  timerInt: null,
  endsAt: 0,
  pendingMessages: [],
  reconnectTimer: null,
  reconnectAttempts: 0,
  shouldReconnect: false,
};

// Screen registry used by the simple view-switching system.
const screens = {
  home: $('screen-home'),
  lobby: $('screen-lobby'),
  question: $('screen-question'),
  results: $('screen-results'),
};

// Show one screen and hide the others.
function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle('hidden', key !== name);
  }
}

// Lightweight toast system for quick user feedback.
function toast(msg) {
  const node = $('toast');
  node.textContent = msg;
  node.classList.remove('hidden');
  setTimeout(() => node.classList.add('hidden'), 2200);
}

// Update visual connection indicator state.
function setConnectionStatus(kind, text) {
  const node = $('ws-status');
  if (!node) return;

  node.classList.remove('ws-connected', 'ws-connecting', 'ws-retrying', 'ws-disconnected');
  node.classList.add(`ws-${kind}`);
  node.textContent = text;
}

// Schedule a single reconnect attempt (guarded to avoid parallel loops).
function scheduleReconnect() {
  if (!state.shouldReconnect || state.reconnectTimer) return;

  state.reconnectAttempts += 1;
  const delay = Math.min(4000, 700 + state.reconnectAttempts * 300);
  setConnectionStatus('retrying', `Reintentando en ${(delay / 1000).toFixed(1)}s...`);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

// Open websocket once and set listeners for protocol messages.
function connect() {
  state.shouldReconnect = true;

  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setConnectionStatus('connecting', 'Conectando...');

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${location.host}/ws`);

  // Auto-fill room code from URL query if available.
  state.ws.onopen = () => {
    state.reconnectAttempts = 0;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    setConnectionStatus('connected', 'Conectado');

    // Flush queued messages created while the socket was connecting.
    if (state.pendingMessages.length > 0) {
      for (const payload of state.pendingMessages) {
        state.ws.send(JSON.stringify(payload));
      }
      state.pendingMessages = [];
    }

    const roomFromUrl = new URLSearchParams(location.search).get('room');
    if (roomFromUrl) {
      $('join-room').value = roomFromUrl.toUpperCase();
    }
  };

  // Main protocol dispatcher.
  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Fatal/game-level errors emitted by backend.
    if (msg.type === 'error') {
      toast(msg.message);
      return;
    }

    // Host receives room metadata including join URL.
    if (msg.type === 'room:created') {
      state.role = 'host';
      state.roomCode = msg.roomCode;
      renderLobby(msg.room, msg.joinUrl);
      showScreen('lobby');
      return;
    }

    // Player join confirmation.
    if (msg.type === 'joined') {
      state.role = msg.role || 'player';
      state.playerId = msg.playerId;
      state.roomCode = msg.room.room;
      renderLobby(msg.room);
      showScreen('lobby');
      return;
    }

    // Lobby/room state refresh.
    if (msg.type === 'room:update') {
      renderLobby(msg.room);
      return;
    }

    // New question event.
    if (msg.type === 'question') {
      renderQuestion(msg);
      return;
    }

    // Backend confirms answer was accepted.
    if (msg.type === 'answer:ack') {
      $('answer-status').textContent = 'Respuesta enviada.';
      return;
    }

    // End-of-round scoreboard.
    if (msg.type === 'round:result') {
      renderRoundResult(msg);
      return;
    }

    // Final game scoreboard.
    if (msg.type === 'game:over') {
      renderGameOver(msg);
    }
  };

  // Clear timers if connection drops.
  state.ws.onclose = () => {
    setConnectionStatus('disconnected', 'Desconectado');
    clearInterval(state.timerInt);
    state.timerInt = null;
    scheduleReconnect();
  };

  // Mark explicit socket-level errors in the badge.
  state.ws.onerror = () => {
    setConnectionStatus('disconnected', 'Error de conexion');
    scheduleReconnect();
  };
}

// Send one JSON message through the protocol.
function send(payload) {
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
    state.pendingMessages.push(payload);
    setConnectionStatus('retrying', 'Reintentando...');
    toast('Conexion no disponible, reintentando...');
    connect();
    return;
  }

  if (state.ws.readyState === WebSocket.CONNECTING) {
    state.pendingMessages.push(payload);
    setConnectionStatus('connecting', 'Conectando...');
    return;
  }

  state.ws.send(JSON.stringify(payload));
}

// Render room state and player list.
function renderLobby(room, joinUrl) {
  $('room-code-label').textContent = room.room;

  if (joinUrl) {
    $('join-url').textContent = joinUrl;
    $('qr').src = `/api/qr?text=${encodeURIComponent(joinUrl)}`;
  }

  const list = $('players');
  list.innerHTML = '';

  // Build dynamic player rows.
  for (const player of room.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${player.name}${player.connected ? '' : ' (offline)'}</span><strong>${player.score}</strong>`;
    list.appendChild(li);
  }

  const spectators = $('spectators');
  spectators.innerHTML = '';
  for (const viewer of room.spectators || []) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${viewer.name}${viewer.connected ? '' : ' (offline)'}</span><strong>Ver</strong>`;
    spectators.appendChild(li);
  }

  if ((room.spectators || []).length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<span>Sin espectadores</span><strong>-</strong>';
    spectators.appendChild(li);
  }

  // Host controls only visible for host in lobby state.
  const hostControls = $('host-controls');
  hostControls.classList.toggle('hidden', state.role !== 'host' || room.state !== 'lobby');
}

// Render active question with selectable answer options.
function renderQuestion(msg) {
  state.currentQuestion = msg.question;
  state.answered = false;
  state.endsAt = msg.endsAt;

  $('meta').textContent = `Ronda ${msg.round}/${msg.totalRounds} • ${msg.question.category}`;
  $('question-text').textContent = msg.question.text;
  $('answer-status').textContent = state.role === 'spectator' ? 'Modo espectador: solo lectura.' : '';

  const options = $('options');
  options.innerHTML = '';

  // One button per answer option.
  msg.question.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.textContent = opt;
    btn.disabled = state.role === 'host' || state.role === 'spectator';

    btn.onclick = () => {
      // Prevent double answers and host answering.
      if (state.answered || state.role === 'host' || state.role === 'spectator') {
        return;
      }

      state.answered = true;
      send({ type: 'answer', optionIndex: idx });

      options.querySelectorAll('.option').forEach((button) => {
        button.disabled = true;
      });
    };

    options.appendChild(btn);
  });

  // High-frequency countdown for smooth UX.
  clearInterval(state.timerInt);
  state.timerInt = setInterval(() => {
    const ms = Math.max(0, state.endsAt - Date.now());
    $('timer').textContent = `${(ms / 1000).toFixed(1)}s`;

    if (ms <= 0) {
      clearInterval(state.timerInt);
      state.timerInt = null;
    }
  }, 100);

  showScreen('question');
}

// Render intermediate round result + current ranking.
function renderRoundResult(msg) {
  clearInterval(state.timerInt);
  state.timerInt = null;

  $('results-title').textContent = 'Fin de ronda';
  $('round-explanation').textContent = msg.explanation || 'Revisa el ranking provisional.';

  const scores = $('scores');
  scores.innerHTML = '';

  // Render ranking list items.
  msg.scores.forEach((row, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${index + 1}. ${row.name}</span><strong>${row.score}</strong>`;
    scores.appendChild(li);
  });

  $('btn-back-home').classList.add('hidden');
  showScreen('results');
}

// Render final game result.
function renderGameOver(msg) {
  $('results-title').textContent = 'Partida terminada';
  $('round-explanation').textContent = 'Clasificacion final.';

  const scores = $('scores');
  scores.innerHTML = '';

  // Render final ranking list items.
  msg.scores.forEach((row, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${index + 1}. ${row.name}</span><strong>${row.score}</strong>`;
    scores.appendChild(li);
  });

  $('btn-back-home').classList.remove('hidden');
  showScreen('results');
}

// Host action: create new room.
$('btn-create').onclick = () => {
  connect();
  const name = $('host-name').value.trim() || 'Anfitrion';
  send({ type: 'host:create', name });
};

// Player action: join existing room.
$('btn-join').onclick = () => {
  connect();
  const room = $('join-room').value.trim().toUpperCase();
  const name = $('join-name').value.trim() || 'Jugador';

  if (!room) {
    toast('Escribe un codigo de sala.');
    return;
  }

  send({ type: 'player:join', room, name });
};

// Spectator action: join room without participating.
$('btn-spectate').onclick = () => {
  connect();
  const room = $('join-room').value.trim().toUpperCase();
  const name = $('join-name').value.trim() || 'Espectador';

  if (!room) {
    toast('Escribe un codigo de sala.');
    return;
  }

  send({ type: 'spectator:join', room, name });
};

// Host action: start game.
$('btn-start').onclick = () => {
  send({ type: 'host:start' });
};

// Reset app by navigating to root.
$('btn-back-home').onclick = () => {
  location.href = '/';
};

// Pre-fill room code from query string for URL invites.
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  $('join-room').value = roomFromUrl.toUpperCase();
}

// Connect immediately on page load and keep the badge in sync.
setConnectionStatus('connecting', 'Conectando...');
connect();
