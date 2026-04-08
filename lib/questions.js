const { QUESTIONS, MODES_ROTATION } = require('./config');

// Themed round distribution: group questions by category and assign modes.
function pickQuestionsWithThemes(total) {
  const seen = new Set();
  const pool = QUESTIONS.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });

  // Group by category
  const byCategory = new Map();
  for (const q of pool) {
    const cat = q.category || 'Mixto';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(q);
  }

  // Shuffle each category pool
  for (const cats of byCategory.values()) {
    for (let i = cats.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [cats[i], cats[j]] = [cats[j], cats[i]];
    }
  }

  // Distribute questions across themed rounds
  const categories = Array.from(byCategory.keys());
  const result = [];
  let categoryIndex = 0;
  let questionsPerRound = Math.max(5, Math.floor(total / 5)); // ~5 questions per round
  let currentRound = 0;

  while (result.length < total && categories.length > 0) {
    const cat = categories[categoryIndex % categories.length];
    const catQuestions = byCategory.get(cat);

    if (catQuestions.length > 0) {
      const q = catQuestions.shift();
      // Assign mode based on round
      const modeForThisRound = MODES_ROTATION[currentRound % MODES_ROTATION.length];
      q.assignedMode = modeForThisRound;
      q.theme = cat;
      result.push(q);

      // Move to next category every questionsPerRound questions or if category is empty
      if (result.length % questionsPerRound === 0 || catQuestions.length === 0) {
        currentRound++;
        categoryIndex++;
      }
    } else {
      // Category exhausted, move to next
      categoryIndex++;
    }

    // Safeguard: stop if we've cycled through all categories multiple times
    if (categoryIndex >= categories.length * 3) break;
  }

  return result.slice(0, total);
}

// Original random picker for fallback.
function pickQuestions(total) {
  const seen = new Set();
  const pool = QUESTIONS.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, total);
}

// Format question data based on mode for sending to clients.
function formatQuestion(q) {
  const questionData = {
    id: q.id,
    mode: q.mode || 'classic',
    category: q.category,
    difficulty: q.difficulty,
    text: q.question,
    explanation: q.explanation,
  };

  // Include mode-specific fields
  const mode = q.mode || 'classic';
  if (mode === 'classic') {
    questionData.options = q.options;
  } else if (mode === 'true_false_chain') {
    questionData.chain = q.chain;
  } else if (mode === 'order') {
    questionData.items = q.items;
  }

  return questionData;
}

module.exports = {
  pickQuestionsWithThemes,
  pickQuestions,
  formatQuestion,
};
