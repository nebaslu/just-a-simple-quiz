const path = require('node:path');
const fs = require('node:fs');

// Runtime tuning knobs (can be overridden by environment variables).
const PORT = Number(process.env.PORT || 3000);
const QUESTIONS_PER_MATCH = Number(process.env.QUESTIONS_PER_MATCH || 10);
const ALLOWED_ROUNDS = new Set([10, 25, 35]);
const ROUND_MS = Number(process.env.ROUND_MS || 30000);
const KEEPALIVE_MS = 25000;
const REVEAL_ANSWER_MS = Number(process.env.REVEAL_ANSWER_MS || 5000);
const GAME_START_DELAY_MS = Number(process.env.GAME_START_DELAY_MS || 900);
const MIN_ANSWER_DISPLAY_MS = Number(process.env.MIN_ANSWER_DISPLAY_MS || 2000);

// Load the question bank once at startup for maximum runtime performance.
const QUESTIONS_PATH = path.join(__dirname, '..', 'data', 'questions.json');
const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));

// Modes rotation for themed rounds: each theme gets a different mode.
const MODES_ROTATION = ['classic', 'true_false_chain', 'order', 'classic', 'true_false_chain'];

module.exports = {
  PORT,
  QUESTIONS_PER_MATCH,
  ALLOWED_ROUNDS,
  ROUND_MS,
  KEEPALIVE_MS,
  REVEAL_ANSWER_MS,
  GAME_START_DELAY_MS,
  MIN_ANSWER_DISPLAY_MS,
  QUESTIONS,
  MODES_ROTATION,
};
