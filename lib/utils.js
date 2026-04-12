const { ALLOWED_ROUNDS, QUESTIONS_PER_MATCH } = require('./config');

// Validate and normalize display names.
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Jugador';
  const clean = name.trim().slice(0, 22);
  return clean || 'Jugador';
}

// Keep round count in supported presets only.
function normalizeTotalRounds(value) {
  const parsed = Number(value);
  if (ALLOWED_ROUNDS.has(parsed)) {
    return parsed;
  }
  if (ALLOWED_ROUNDS.has(QUESTIONS_PER_MATCH)) {
    return QUESTIONS_PER_MATCH;
  }
  return Math.min(...ALLOWED_ROUNDS);
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

module.exports = {
  sanitizeName,
  normalizeTotalRounds,
  randomCode,
};
