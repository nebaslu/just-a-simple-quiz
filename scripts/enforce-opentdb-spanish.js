const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'opentdb-es-questions.json');
const cache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateToEs(text) {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (cache.has(clean)) return cache.get(clean);

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(clean)}`;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await sleep(250 * attempt);
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        await sleep(250 * attempt);
        continue;
      }
      const translated = data[0]
        .filter((seg) => Array.isArray(seg) && typeof seg[0] === 'string')
        .map((seg) => seg[0])
        .join('')
        .trim();
      const out = translated || clean;
      cache.set(clean, out);
      return out;
    } catch {
      await sleep(250 * attempt);
    }
  }

  cache.set(clean, clean);
  return clean;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;

  for (const q of data) {
    const oldQuestion = q.question;
    const oldExplanation = q.explanation;

    q.question = await translateToEs(q.question);
    q.explanation = await translateToEs(q.explanation);

    if (Array.isArray(q.options)) {
      const translatedOptions = [];
      for (const option of q.options) {
        translatedOptions.push(await translateToEs(option));
      }
      q.options = translatedOptions;
    }

    if (oldQuestion !== q.question || oldExplanation !== q.explanation) {
      changed += 1;
    }
  }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Preguntas revisadas: ${data.length}`);
  console.log(`Preguntas con cambios de traduccion: ${changed}`);
}

main().catch((err) => {
  console.error('Error aplicando traduccion:', err.message);
  process.exit(1);
});
