const { logEvent } = require('./logger');
const { broadcast, send, roomPublicState } = require('./message');
const { ROUND_MS, REVEAL_ANSWER_MS, MIN_ANSWER_DISPLAY_MS } = require('./config');
const { formatQuestion } = require('./questions');

// Shared ranking builder reused in round and game summaries.
function buildRanking(room) {
  return Array.from(room.players.values())
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// Close current round, reveal answer and transient ranking.
function finishRound(room) {
  if (room.state !== 'question' || !room.currentQuestion) return;
  clearTimeout(room.roundTimer);
  clearTimeout(room.roundEndScheduled);
  room.roundEndScheduled = null;

  const q = room.currentQuestion;
  room.state = 'round_result';
  const serverNow = Date.now();
  const nextQuestionAt = serverNow + REVEAL_ANSWER_MS;

  const ranking = buildRanking(room);

  room.lastRoundResult = {
    correctIndex: q.answerIndex,
    explanation: q.explanation,
    scores: ranking,
    serverNow,
    nextQuestionAt,
  };
  logEvent('round_finished', { roomCode: room.code, round: room.round, correctIndex: q.answerIndex });

  broadcast(room, {
    type: 'round:result',
    correctIndex: q.answerIndex,
    explanation: q.explanation,
    scores: ranking,
    serverNow,
    nextQuestionAt,
    room: roomPublicState(room),
  });

  room.currentQuestion = null;

  setTimeout(() => {
    startNextQuestion(room);
  }, REVEAL_ANSWER_MS);
}

// Evaluate one player answer, apply score and auto-close when all have answered.
function scoreAnswer(room, playerId, answerData) {
  if (room.state !== 'question' || !room.currentQuestion) return;
  if (room.answeredPlayers.has(playerId)) return;

  const player = room.players.get(playerId);
  if (!player || !player.connected) return;

  room.answeredPlayers.add(playerId);

  const elapsed = Date.now() - room.questionStartedAt;
  const clampedElapsed = Math.max(0, Math.min(ROUND_MS, elapsed));
  const speedFactor = 1 - clampedElapsed / ROUND_MS;

  const q = room.currentQuestion;
  const mode = q.mode || 'classic';
  let isCorrect = false;

  // Mode-specific scoring
  if (mode === 'classic') {
    const optionIndex = answerData.optionIndex;
    isCorrect = optionIndex === q.answerIndex;
  } else if (mode === 'true_false_chain') {
    const correct = answerData.chainCorrect || 0;
    isCorrect = correct >= 3; // 3 or more correct = pass
    if (isCorrect) {
      const points = 600 + Math.round(400 * speedFactor);
      player.score += points;
    }
  } else if (mode === 'order') {
    const order = answerData.order || [];
    isCorrect = JSON.stringify(order) === JSON.stringify(q.correctOrder);
  }

  // Apply score if correct
  if (isCorrect && mode === 'classic') {
    const points = 600 + Math.round(400 * speedFactor);
    player.score += points;
  }

  // Record this player's answer for display.
  room.currentQuestion.playerAnswers[playerId] = {
    playerName: player.name,
    isCorrect: isCorrect,
    answerData: answerData,
  };

  send(player.ws, { type: 'answer:ack', accepted: true });

  // Broadcast all answers so far to everyone (for live display).
  broadcast(room, {
    type: 'answers:update',
    playerAnswers: room.currentQuestion.playerAnswers,
  });

  const activePlayers = Array.from(room.players.values()).filter((p) => p.connected).length;

  // If this is the first answer, record when it came in.
  if (room.answeredPlayers.size === 1) {
    room.firstAnswerAt = Date.now();
  }

  // Check if all active players have answered.
  if (room.answeredPlayers.size >= activePlayers) {
    const timeSinceFirst = Date.now() - room.firstAnswerAt;
    const delayBeforeEnd = Math.max(0, MIN_ANSWER_DISPLAY_MS - timeSinceFirst);

    // End round after minimum display time (even if it's 0).
    if (delayBeforeEnd > 0) {
      if (!room.roundEndScheduled) {
        room.roundEndScheduled = setTimeout(() => {
          room.roundEndScheduled = null;
          finishRound(room);
        }, delayBeforeEnd);
      }
    } else {
      finishRound(room);
    }
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
  room.currentQuestion.playerAnswers = {};
  room.answeredPlayers = new Set();
  room.questionStartedAt = Date.now();
  room.firstAnswerAt = null;
  room.roundEndScheduled = null;
  logEvent('question_started', { roomCode: room.code, round: room.round, questionId: q.id });

  const endsAt = room.questionStartedAt + ROUND_MS;

  const questionData = formatQuestion(q);

  broadcast(room, {
    type: 'question',
    question: questionData,
    round: room.round,
    totalRounds: room.totalRounds,
    endsAt,
    room: roomPublicState(room),
  });

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => finishRound(room), ROUND_MS + 25);
}

module.exports = {
  buildRanking,
  finishRound,
  scoreAnswer,
  endGame,
  startNextQuestion,
};
