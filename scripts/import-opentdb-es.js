const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'data', 'opentdb-es-questions.json');

const CATEGORY_PLAN = [
  { id: 17, category: 'Ciencia' },
  { id: 23, category: 'Historia' },
  { id: 22, category: 'Geografia' },
  { id: 21, category: 'Deportes' },
  { id: 11, category: 'Cine y TV' },
  { id: 14, category: 'Cine y TV' },
  { id: 15, category: 'Videojuegos' },
];

const translateCache = new Map();

function normalizeForCompare(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function hasEnglishMarkers(text) {
  return /\b(the|which|what|who|where|when|why|how|true|false|is|are|was|were|not|none|all|in|on|at|for|with|without|and|or)\b/i
    .test(String(text || ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getArgNumber(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function decodeOpenTdb(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mapDifficulty(value) {
  if (value === 'easy') return 'facil';
  if (value === 'medium') return 'media';
  if (value === 'hard') return 'dificil';
  return 'media';
}

async function fetchOpenTdbBatch(categoryId, amount) {
  const url = `https://opentdb.com/api.php?amount=${amount}&category=${categoryId}&type=multiple&encode=url3986`;
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'just-a-simple-quiz-opentdb-importer/1.0',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          const backoff = 1200 * attempt;
          await sleep(backoff);
          continue;
        }
        throw new Error(`OpenTriviaDB HTTP ${res.status} en categoria ${categoryId}`);
      }

      const data = await res.json();
      if (!Array.isArray(data.results)) {
        throw new Error(`Respuesta invalida de OpenTriviaDB en categoria ${categoryId}`);
      }

      return data.results;
    } catch (err) {
      lastError = err;
      await sleep(800 * attempt);
    }
  }

  throw new Error(`No se pudo descargar categoria ${categoryId}: ${lastError ? lastError.message : 'error desconocido'}`);
}

async function translateToEs(text) {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (translateCache.has(clean)) return translateCache.get(clean);

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(clean)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      translateCache.set(clean, null);
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      translateCache.set(clean, null);
      return null;
    }

    const translated = data[0]
      .filter((seg) => Array.isArray(seg) && typeof seg[0] === 'string')
      .map((seg) => seg[0])
      .join('')
      .trim();

    const out = translated || null;
    translateCache.set(clean, out);
    return out;
  } catch {
    translateCache.set(clean, null);
    return null;
  }
}

async function buildQuestion(row, fallbackCategory) {
  const questionRaw = decodeOpenTdb(row.question);
  const correctRaw = decodeOpenTdb(row.correct_answer);
  const incorrectRaw = row.incorrect_answers.map(decodeOpenTdb);

  const question = await translateToEs(questionRaw);
  if (!question) return null;

  // Guarantee spanish content: if translation did not change source english, discard.
  const sameAsSource = normalizeForCompare(question) === normalizeForCompare(questionRaw);
  if (sameAsSource || hasEnglishMarkers(question)) return null;

  const correct = await translateToEs(correctRaw);
  if (!correct || hasEnglishMarkers(correct)) return null;
  const wrongs = [];
  for (const item of incorrectRaw) {
    const translated = await translateToEs(item);
    if (!translated || hasEnglishMarkers(translated)) return null;
    wrongs.push(translated);
  }

  const options = shuffle([correct, ...wrongs]);

  const explanation = `Respuesta correcta: ${correct}.`;
  if (hasEnglishMarkers(explanation)) return null;

  return {
    mode: 'classic',
    category: fallbackCategory,
    difficulty: mapDifficulty(row.difficulty),
    question,
    options,
    answerIndex: options.indexOf(correct),
    explanation,
  };
}

function validateClassic(dataset) {
  const errors = [];
  for (const q of dataset) {
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      errors.push(`${q.id}: opciones invalidas`);
      continue;
    }

    if (q.answerIndex < 0 || q.answerIndex > 3) {
      errors.push(`${q.id}: answerIndex fuera de rango`);
    }

    if (new Set(q.options).size !== 4) {
      errors.push(`${q.id}: opciones duplicadas`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validacion fallida (${errors.length}):\n${errors.slice(0, 10).join('\n')}`);
  }
}

// Filter out invalid questions instead of throwing – translation can collapse options.
function filterValid(dataset) {
  const clean = dataset.filter((q) => {
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (q.answerIndex < 0 || q.answerIndex > 3) return false;
    if (new Set(q.options).size !== 4) return false;
    return true;
  });
  const dropped = dataset.length - clean.length;
  if (dropped > 0) console.log(`  (${dropped} preguntas invalidas descartadas)`);
  return clean;
}

async function main() {
  const total = getArgNumber('--total', 350);
  if (process.argv.includes('--no-translate')) {
    throw new Error('No se permite --no-translate: las preguntas deben estar siempre en espanol.');
  }
  const perCategory = Math.max(5, Math.floor(total / CATEGORY_PLAN.length));

  const imported = [];
  let droppedNotSpanish = 0;

  for (const plan of CATEGORY_PLAN) {
    const amount = Math.min(50, perCategory);
    const rows = await fetchOpenTdbBatch(plan.id, amount);

    for (const row of rows) {
      const q = await buildQuestion(row, plan.category);
      if (q) {
        imported.push(q);
      } else {
        droppedNotSpanish += 1;
      }
    }

    console.log(`Categoria ${plan.category}: ${rows.length} descargadas`);
    await sleep(1200);
  }

  const deduped = [];
  const seen = new Set();
  for (const q of imported) {
    const key = q.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(q);
  }

  const valid = filterValid(deduped);
  if (droppedNotSpanish > 0) {
    console.log(`  (${droppedNotSpanish} preguntas descartadas por traduccion no valida al espanol)`);
  }
  valid.forEach((q, idx) => {
    q.id = `otdb_${String(idx + 1).padStart(4, '0')}`;
  });

  fs.writeFileSync(OUT, JSON.stringify(valid, null, 2), 'utf8');
  console.log(`Guardadas ${valid.length} preguntas en ${OUT}`);
}

main().catch((err) => {
  console.error('Error importando OpenTriviaDB:', err.message);
  process.exit(1);
});
