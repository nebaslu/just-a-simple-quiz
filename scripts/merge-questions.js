/**
 * Merges data/questions.json + data/opentdb-es-questions.json into data/questions.json
 * Deduplicates by question text (case-insensitive) and reassigns stable sequential IDs.
 *
 * Usage:
 *   node scripts/merge-questions.js
 *   npm run questions:merge
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MAIN_FILE = path.join(DATA_DIR, 'questions.json');
const OPENTDB_FILE = path.join(DATA_DIR, 'opentdb-es-questions.json');

function loadIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`AVISO: no existe ${path.basename(filePath)}, se omite.`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const base = loadIfExists(MAIN_FILE);
  const extra = loadIfExists(OPENTDB_FILE);

  const combined = [...base, ...extra];
  const seen = new Set();
  const merged = [];

  for (const q of combined) {
    const key = String(q.question || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...q });
  }

  // Reassign stable sequential IDs.
  merged.forEach((q, i) => {
    q.id = `q_${String(i + 1).padStart(4, '0')}`;
  });

  const removed = combined.length - merged.length;
  fs.writeFileSync(MAIN_FILE, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`Fusionadas ${merged.length} preguntas en questions.json`);
  if (removed > 0) console.log(`  (${removed} duplicadas eliminadas)`);

  // Category and mode summary.
  const categories = {};
  const modes = {};
  for (const q of merged) {
    const cat = q.category || 'Sin categoria';
    const mode = q.mode || 'classic';
    categories[cat] = (categories[cat] || 0) + 1;
    modes[mode] = (modes[mode] || 0) + 1;
  }
  console.log('\nDistribucion por categoria:');
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log('\nDistribucion por modo:');
  for (const [mode, count] of Object.entries(modes)) {
    console.log(`  ${mode}: ${count}`);
  }
}

main();
