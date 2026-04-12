const { QUESTIONS, MODES_ROTATION } = require('./config');

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildChainFromClassic(q) {
  const options = Array.isArray(q.options) ? q.options : [];
  const correct = options[q.answerIndex] || '';
  const wrongs = options.filter((_, idx) => idx !== q.answerIndex);
  const useCorrect = Math.random() >= 0.5 || wrongs.length === 0;
  const claimed = useCorrect ? correct : wrongs[Math.floor(Math.random() * wrongs.length)];

  // One statement per round (not a 5-question chain).
  return [
    {
      text: `Para la pregunta "${q.question}", la respuesta correcta es "${claimed}".`,
      answer: useCorrect,
    },
  ];
}

function buildOrderFromClassic(q) {
  const sourceItems = Array.isArray(q.options) && q.options.length === 4
    ? q.options
    : [
      `${q.category || 'Tema'} A`,
      `${q.category || 'Tema'} B`,
      `${q.category || 'Tema'} C`,
      `${q.category || 'Tema'} D`,
    ];

  const items = shuffle(sourceItems);
  const sorted = [...items].sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
  const correctOrder = sorted.map((item) => items.indexOf(item));

  return {
    text: `Ordena alfabeticamente estas opciones relacionadas con: ${q.question}`,
    items,
    correctOrder,
  };
}

function assignModeData(question, mode) {
  if (mode === 'classic') {
    return { ...question, mode: 'classic' };
  }

  if (mode === 'true_false_chain') {
    const chain = Array.isArray(question.chain) && question.chain.length > 0
      ? question.chain.slice(0, 1)
      : buildChainFromClassic(question);

    return {
      ...question,
      mode: 'true_false_chain',
      chain,
    };
  }

  if (mode === 'order') {
    if (!Array.isArray(question.items) || question.items.length !== 4
      || !Array.isArray(question.correctOrder) || question.correctOrder.length !== 4) {
      const built = buildOrderFromClassic(question);
      return {
        ...question,
        mode: 'order',
        question: built.text,
        items: built.items,
        correctOrder: built.correctOrder,
      };
    }

    return {
      ...question,
      mode: 'order',
      items: question.items,
      correctOrder: question.correctOrder,
    };
  }

  return { ...question, mode: 'classic' };
}

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
  const questionsPerRound = Math.max(1, Math.floor(total / MODES_ROTATION.length));
  let currentRound = 0;

  while (result.length < total && categories.length > 0) {
    const cat = categories[categoryIndex % categories.length];
    const catQuestions = byCategory.get(cat);

    if (catQuestions.length > 0) {
      const q = catQuestions.shift();
      // Assign mode based on round
      const modeForThisRound = MODES_ROTATION[currentRound % MODES_ROTATION.length];
      const questionWithMode = assignModeData(q, modeForThisRound);
      result.push({
        ...questionWithMode,
        theme: cat,
      });

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
