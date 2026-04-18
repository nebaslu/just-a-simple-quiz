// Small DOM helper by id.
const $ = (id) => document.getElementById(id);

// Helper to capitalize the first letter of a string.
const capitalizeFirst = (str) => str.charAt(0).toUpperCase() + str.slice(1);

// Small delay so selected option feedback is visible before switching screen.
const ROUND_RESULT_DELAY_MS = 250;
const FALLBACK_NEXT_QUESTION_MS = 1000;

// Client-side runtime state for one browser session.
const state = {
  ws: null,
  role: null,
  roomCode: null,
  playerId: null,
  currentQuestion: null,
  answered: false,
  playerAnswers: {},
  timerInt: null,
  endsAt: 0,
  pendingMessages: [],
  reconnectTimer: null,
  reconnectAttempts: 0,
  shouldReconnect: false,
  connectWatchdog: null,
  soundEnabled: localStorage.getItem("soundEnabled") !== "false",
  roundResolved: false,
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

// Modal helpers for leave confirmation flow.
function openLeaveModal() {
  $('leave-modal').classList.remove('hidden');
}

function closeLeaveModal() {
  $('leave-modal').classList.add('hidden');
}

// Lightweight toast system for quick user feedback.
function toast(msg) {
  const node = $('toast');
  node.textContent = msg;
  node.classList.remove('hidden');
  setTimeout(() => node.classList.add('hidden'), 2200);
}

// Generate consistent color for a player based on their ID.
function getPlayerColor(playerId) {
  // Accessible color palette: soft, high contrast, colorblind-friendly
  // Avoids pure red-green combinations that affect deuteranopia/protanopia
  const colors = [
    { bg: '#E8D5F2', text: '#4A2E5C', pattern: 'solid' },        // Lavender
    { bg: '#D4E8F7', text: '#1B4965', pattern: 'dots' },          // Soft blue
    { bg: '#D5EFE1', text: '#1E5139', pattern: 'solid' },         // Mint green
    { bg: '#FFF5E1', text: '#6B4423', pattern: 'lines' },         // Warm cream
    { bg: '#F0D9E8', text: '#5C3366', pattern: 'solid' },         // Rose
    { bg: '#E0F2FE', text: '#0F3A5F', pattern: 'dots' },          // Sky blue
    { bg: '#E7F6E3', text: '#2D5016', pattern: 'solid' },         // Pale green
    { bg: '#FCE8D6', text: '#6B3E1B', pattern: 'lines' },         // Peach
    { bg: '#E8D9F5', text: '#45245A', pattern: 'solid' },         // Periwinkle
    { bg: '#E0F7E9', text: '#1B4D3C', pattern: 'dots' },          // Seafoam
  ];

  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length];
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

  // If the handshake stalls, force-close and trigger reconnection.
  if (state.connectWatchdog) {
    clearTimeout(state.connectWatchdog);
    state.connectWatchdog = null;
  }
  state.connectWatchdog = setTimeout(() => {
    if (!state.ws || state.ws.readyState !== WebSocket.CONNECTING) return;
    setConnectionStatus('retrying', 'Conexion lenta, reintentando...');
    try {
      state.ws.close();
    } catch {
      // Ignore close errors and continue with reconnect flow.
    }
    scheduleReconnect();
  }, 4000);

  // Auto-fill room code from URL query if available.
  state.ws.onopen = () => {
    if (state.connectWatchdog) {
      clearTimeout(state.connectWatchdog);
      state.connectWatchdog = null;
    }
    state.reconnectAttempts = 0;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    setConnectionStatus('connected', 'Conectado');

    audio.init();
    updateSoundButton();

    // If reconnecting mid-session, restore room state first so the server
    // knows who this socket is before flushing any queued messages.
    if (state.roomCode && state.playerId) {
      state.ws.send(JSON.stringify({ type: 'player:rejoin', roomCode: state.roomCode, playerId: state.playerId }));
    }

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
      if (msg.role === 'spectator') {
        state.spectatorShowSelections = msg.showSelections;
      }
      state.roomCode = msg.room.room;
      renderLobby(msg.room, msg.joinUrl);
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
      audio.playCorrect();
      return;
    }

    // End-of-round scoreboard.
    if (msg.type === 'round:result') {
      state.roundResolved = true;
      updateAnswerDisplay();
      // Delay showing results to let player see their selected answer colored.
      setTimeout(() => {
        renderRoundResult(msg);
      }, ROUND_RESULT_DELAY_MS);
      return;
    }

    // Final game scoreboard.
    if (msg.type === 'game:over') {
      renderGameOver(msg);
      return;
    }

    // Server confirms explicit leave action.
    if (msg.type === 'left') {
      return;
    }

    // Live answer update from other players.
    if (msg.type === 'answers:update') {
      state.playerAnswers = msg.playerAnswers;
      updateAnswerDisplay();
      return;
    }

    // Handle keepalive ping from server (iOS Safari workaround).
    if (msg.type === 'ping') {
      send({ type: 'pong' });
      return;
    }

    // Handle keepalive pong from server.
    if (msg.type === 'pong') {
      return;
    }
  };

  // Clear timers if connection drops.
  state.ws.onclose = () => {
    if (state.connectWatchdog) {
      clearTimeout(state.connectWatchdog);
      state.connectWatchdog = null;
    }
    setConnectionStatus('disconnected', 'Desconectado');
    clearInterval(state.timerInt);
    state.timerInt = null;
    scheduleReconnect();
  };

  // Mark explicit socket-level errors in the badge.
  state.ws.onerror = () => {
    if (state.connectWatchdog) {
      clearTimeout(state.connectWatchdog);
      state.connectWatchdog = null;
    }
    setConnectionStatus('disconnected', 'Error de conexion');
    scheduleReconnect();
  };
}

// Send one JSON message through the protocol.
function send(payload) {
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
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

// Leave current room and reset local session state.
function leaveMatch() {
  state.shouldReconnect = false;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.connectWatchdog) {
    clearTimeout(state.connectWatchdog);
    state.connectWatchdog = null;
  }

  clearInterval(state.timerInt);
  state.timerInt = null;

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'player:leave' }));
    setTimeout(() => {
      try {
        state.ws.close();
      } catch {
        // Ignore close errors after explicit leave.
      }
    }, 40);
  } else if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
    try {
      state.ws.close();
    } catch {
      // Ignore close errors after explicit leave.
    }
  }

  state.pendingMessages = [];
  state.role = null;
  state.roomCode = null;
  state.playerId = null;
  state.currentQuestion = null;
  state.answered = false;
  state.endsAt = 0;

  history.replaceState({}, '', '/');
  showScreen('home');
  setConnectionStatus('disconnected', 'Desconectado');
  toast('Has abandonado la partida.');
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

// Update visual display of answers with player colors.
function updateAnswerDisplay() {
  const options = $('options');
  if (!options) return;

  const buttons = options.querySelectorAll('.option');
  buttons.forEach((btn, idx) => {
    let playerLabels = [];

    // Find all players who selected this option.
    for (const [playerId, answer] of Object.entries(state.playerAnswers)) {
      const selectedOptionIndex = Number.isInteger(answer.optionIndex)
        ? answer.optionIndex
        : answer.answerData?.optionIndex;

      if (selectedOptionIndex === idx) {
        const isCurrentPlayer = playerId === state.playerId;
        const canShow = isCurrentPlayer || state.roundResolved || (state.role === 'spectator' && state.spectatorShowSelections);
        if (canShow) {
          const colorObj = getPlayerColor(playerId);
          playerLabels.push({ ...colorObj, name: answer.playerName || 'Jugador' });
        }
      }
    }

    if (playerLabels.length > 0) {
      // Use first player's color and pattern for button.
      const primaryColor = playerLabels[0];
      btn.style.backgroundColor = primaryColor.bg;
      btn.style.color = primaryColor.text;
      btn.style.fontWeight = '600';
      btn.style.position = 'relative';
      btn.className = `option pattern-${primaryColor.pattern}`;

      // Show player names who selected this option only when resolved.
      if (state.roundResolved) {
        let labelText = playerLabels.map((p) => p.name).join(', ');
        if (labelText.length > 30) labelText = labelText.substring(0, 27) + '...';
        btn.setAttribute('data-answerers', labelText);
      } else {
        btn.removeAttribute('data-answerers');
      }
    } else {
      btn.style.backgroundColor = '';
      btn.style.color = '';
      btn.style.fontWeight = '';
      btn.className = 'option';
      btn.removeAttribute('data-answerers');
    }
  });

  // Show list of players who have answered.
  const answeredPlayers = new Set();
  for (const answer of Object.values(state.playerAnswers)) {
    answeredPlayers.add(answer.playerName || 'Jugador');
  }
  const showAnswered = state.role !== 'spectator' || state.spectatorShowSelections;
  $('answered-players').textContent = showAnswered && answeredPlayers.size > 0 ? `Jugadores que han respondido: ${Array.from(answeredPlayers).join(', ')}` : '';
}

// Render active question with selectable answer options.
function renderQuestion(msg) {
  state.currentQuestion = msg.question;
  state.answered = false;
  state.playerAnswers = {};
  state.roundResolved = false;
  state.endsAt = msg.endsAt;

  const mode = msg.question.mode || 'classic';

  $('meta').textContent = `Ronda ${msg.round}/${msg.totalRounds} • ${msg.question.category}`;
  $('question-text').textContent = capitalizeFirst(msg.question.text);
  $('answer-status').textContent = state.role === 'spectator' ? 'Modo espectador: solo lectura.' : '';

  if (msg.round === 1) {
    audio.playGameStart();
    audio.startBackground();
  }

  const options = $('options');
  options.innerHTML = '';

  if (mode === 'classic') {
    // Classic 4-option multiple choice
    msg.question.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.textContent = capitalizeFirst(opt);
      btn.disabled = state.role === 'spectator';

      btn.onclick = () => {
        if (state.answered || state.role === 'spectator') return;
        state.answered = true;
        
        // Add to local player answers for immediate visual feedback
        state.playerAnswers[state.playerId] = {
          optionIndex: idx,
          playerName: localStorage.getItem('playerName') || 'Yo'
        };
        updateAnswerDisplay();
        
        send({ type: 'answer', optionIndex: idx });
        options.querySelectorAll('.option').forEach((button) => {
          button.disabled = true;
        }); 
      };

      options.appendChild(btn);
    });
  } else if (mode === 'true_false_chain') {
    // True/false statements (adapted to one statement when sourced from classic data).
    const chain = Array.isArray(msg.question.chain) && msg.question.chain.length > 0
      ? msg.question.chain
      : [];
    const chainLength = chain.length;
    state.chainAnswers = new Array(chainLength).fill(null);

    if (chainLength === 0) {
      toast('Esta pregunta no tiene contenido para V/F.');
      return;
    }

    chain.forEach((stmt, idx) => {
      const container = document.createElement('div');
      container.style.marginBottom = '12px';
      container.style.padding = '8px';
      container.style.backgroundColor = '#f0f0f0';
      container.style.borderRadius = '8px';

      const label = document.createElement('p');
      label.textContent = `${idx + 1}. ${capitalizeFirst(stmt.text)}`;
      label.style.margin = '0 0 6px 0';
      label.style.fontWeight = '600';
      container.appendChild(label);

      const btnGroup = document.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '8px';

      ['Falso', 'Verdadero'].forEach((text, answerIdx) => {
        const btn = document.createElement('button');
        btn.className = 'option chain-btn';
        btn.textContent = text;
        btn.disabled = state.role === 'spectator';
        btn.style.flex = '1';

        btn.onclick = () => {
          if (state.role === 'spectator') return;
          if (state.chainAnswers[idx] !== null) return;

          const isCorrect = answerIdx === (stmt.answer ? 1 : 0);
          state.chainAnswers[idx] = isCorrect;
          btn.style.backgroundColor = isCorrect ? '#90EE90' : '#FFB6C6';
          btn.style.fontWeight = '700';

          // Lock only this statement once answered.
          container.querySelectorAll('.chain-btn').forEach((b) => {
            b.disabled = true;
          });

          // Auto-advance if all answered
          const answeredCount = state.chainAnswers.filter((v) => v !== null).length;
          if (answeredCount === chainLength) {
            state.answered = true;
            send({
              type: 'answer',
              chainCorrect: state.chainAnswers.filter((x) => x === true).length,
              chainTotal: chainLength,
            });
            options.querySelectorAll('.chain-btn').forEach((b) => {
              b.disabled = true;
            });
          }
        };

        btnGroup.appendChild(btn);
      });

      container.appendChild(btnGroup);
      options.appendChild(container);
    });
  } else if (mode === 'order') {
    // Reorder 4 items - simple version with selection
    state.selectedOrder = [];
    const items = [...msg.question.items];
    
    const instructionLabel = document.createElement('p');
    instructionLabel.textContent = 'Selecciona en orden (izq/der para navegar, OK para confirmar):';
    instructionLabel.style.marginBottom = '12px';
    instructionLabel.style.fontSize = '14px';
    options.appendChild(instructionLabel);

    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option order-btn';
      btn.textContent = capitalizeFirst(item);
      btn.disabled = state.role === 'spectator';
      btn.style.marginBottom = '8px';

      btn.onclick = () => {
        if (state.role === 'spectator' || state.selectedOrder.includes(idx)) return;
        state.selectedOrder.push(idx);
        btn.style.opacity = '0.5';

        // When all 4 selected, send answer
        if (state.selectedOrder.length === 4) {
          state.answered = true;
          send({ type: 'answer', order: state.selectedOrder });
          options.querySelectorAll('.order-btn').forEach((b) => {
            b.disabled = true;
          });
        }
      };

      options.appendChild(btn);
    });
  }

  // High-frequency countdown for smooth UX.
  clearInterval(state.timerInt);
  state.timerInt = setInterval(() => {
    const ms = Math.max(0, state.endsAt - Date.now());
    $('timer').textContent = `${(ms / 1000).toFixed(0)}s`;

    if (ms <= 0) {
      clearInterval(state.timerInt);
      state.timerInt = null;
    }
  }, 100);

  updateAnswerDisplay();
  showScreen('question');
}

// Render intermediate round result + current ranking.
function renderRoundResult(msg) {
  clearInterval(state.timerInt);
  state.timerInt = null;

  audio.playRoundEnd();

  $('results-title').textContent = 'Fin de ronda';
  $('round-explanation').textContent = msg.explanation || 'Revisa el ranking provisional.';

  let nextQuestionTimer = $('next-question-timer');
  if (!nextQuestionTimer) {
    nextQuestionTimer = document.createElement('p');
    nextQuestionTimer.id = 'next-question-timer';
    nextQuestionTimer.className = 'next-question-timer';
    $('round-explanation').insertAdjacentElement('afterend', nextQuestionTimer);
  }

  let targetTs = Date.now() + FALLBACK_NEXT_QUESTION_MS;
  const serverNow = Number(msg.serverNow);
  const nextQuestionAt = Number(msg.nextQuestionAt);

  if (Number.isFinite(serverNow) && Number.isFinite(nextQuestionAt) && nextQuestionAt >= serverNow) {
    // Convert server absolute timestamps to the local clock to absorb clock skew.
    const clockOffset = Date.now() - serverNow;
    targetTs = nextQuestionAt + clockOffset;
  } else if (Number.isFinite(nextQuestionAt)) {
    targetTs = nextQuestionAt;
  }

  const renderRemaining = () => {
    const ms = Math.max(0, targetTs - Date.now());
    nextQuestionTimer.textContent = `Siguiente pregunta en ${(ms / 1000).toFixed(1)}s`;
    if (ms <= 0) {
      clearInterval(state.timerInt);
      state.timerInt = null;
      nextQuestionTimer.classList.add('hidden');
      nextQuestionTimer.textContent = '';
    }
  };

  nextQuestionTimer.classList.remove('hidden');
  renderRemaining();
  state.timerInt = setInterval(renderRemaining, 100);

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
  audio.stopBackground();

  $('results-title').textContent = 'Partida terminada';
  $('round-explanation').textContent = 'Clasificacion final.';
  const nextQuestionTimer = $('next-question-timer');
  if (nextQuestionTimer) {
    nextQuestionTimer.classList.add('hidden');
    nextQuestionTimer.textContent = '';
  }

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
  audio.init();
  connect();
  const name = $('host-name').value.trim() || 'Anfitrion';
  const totalRounds = Number($('host-rounds').value || 15);
  send({ type: 'host:create', name, totalRounds });
};

// Player action: join existing room.
$('btn-join').onclick = () => {
  audio.init();
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
  audio.init();
  connect();
  const room = $('join-room').value.trim().toUpperCase();
  const name = $('join-name').value.trim() || 'Espectador';
  const showSelections = $('spectator-show-selections').checked;

  if (!room) {
    toast('Escribe un codigo de sala.');
    return;
  }

  send({ type: 'spectator:join', room, name, showSelections });
};

// Host action: start game.
$('btn-start').onclick = () => {
  audio.init();
  send({ type: 'host:start' });
};

// Leave room action available in lobby/game/results.
document.querySelectorAll('.btn-leave-match').forEach((button) => {
  button.onclick = () => {
    openLeaveModal();
  };
});

// Leave modal controls.
$('btn-cancel-leave').onclick = () => {
  closeLeaveModal();
};

$('btn-confirm-leave').onclick = () => {
  closeLeaveModal();
  leaveMatch();
};

$('leave-modal').onclick = (event) => {
  if (event.target === $('leave-modal')) {
    closeLeaveModal();
  }
};

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('leave-modal').classList.contains('hidden')) {
    closeLeaveModal();
  }
});

// Reset app by navigating to root.
$('btn-back-home').onclick = () => {
  audio.stopBackground();
  location.href = '/';
};

// Toggle global sound/music.
$('btn-sound-toggle').onclick = () => {
  audio.init();
  audio.toggleSound();
};

// Pre-fill room code from query string for URL invites.
const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl) {
  $('join-room').value = roomFromUrl.toUpperCase();
}

// Keep connection idle on home screen; connect on explicit user action.
setConnectionStatus('disconnected', 'Listo para conectar');
updateSoundButton();
