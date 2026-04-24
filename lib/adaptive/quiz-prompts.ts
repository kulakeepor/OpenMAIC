/**
 * Quiz Prompt Builder for Adaptive Learning
 *
 * Generates multiple-choice questions for a knowledge node,
 * calibrated to the node's difficulty level.
 */

import type { KnowledgeNode } from '@/lib/types/adaptive';

export interface QuizQuestion {
  question: string;
  options: string[];   // ["A. ...", "B. ...", "C. ...", "D. ..."]
  correct: string;     // "A" | "B" | "C" | "D"
  explanation: string;
}

/**
 * Build a prompt that asks the LLM to generate multiple-choice quiz questions.
 */
export function buildQuizPrompt(
  node: KnowledgeNode,
  count: number = 3,
  masteryLevel: number = 0.5,
): string {
  const difficultyLabel = ['', 'Intro', 'Basic', 'Intermediate', 'Advanced', 'AP Exam'][node.difficulty] ?? 'Intermediate';
  const normalizedMastery = Math.min(1, Math.max(0, masteryLevel));
  const adaptiveDifficulty =
    normalizedMastery < 0.4
      ? 'Low mastery: write basic concept questions with direct formula substitution and clean, simple numbers.'
      : normalizedMastery <= 0.7
        ? 'Developing mastery: write questions that require two-step reasoning and include unit conversions.'
        : 'High mastery: write AP exam-level questions with multi-step reasoning, graph/table descriptions, and boundary cases.';

  return `You are an AP Physics 2 question writer. Generate exactly ${count} multiple-choice questions for the following concept.

## Concept
- Name: ${node.name}
- Difficulty: ${node.difficulty}/5 (${difficultyLabel})
- Key equations: ${node.key_equations.length > 0 ? node.key_equations.join('; ') : 'none'}
- Core idea: ${node.teaching_skeleton.core_idea}

## Adaptive Difficulty
- Student mastery level: ${normalizedMastery.toFixed(2)} (0.00 = untouched, 1.00 = fully mastered)
- ${adaptiveDifficulty}

## Question Requirements
- Each question must test conceptual understanding or application, not just recall
- Difficulty should match both the concept level ${node.difficulty}/5 and the adaptive difficulty above
- All 4 options must be plausible (no obviously wrong distractors)
- One and only one correct answer per question
- Explanation should address why the correct answer is right AND why common wrong answers are wrong

## Output Format
Output ONLY the JSON below, wrapped in <quiz> tags. No other text.

<quiz>
[
  {
    "question": "Question text here?",
    "options": ["A. first option", "B. second option", "C. third option", "D. fourth option"],
    "correct": "A",
    "explanation": "A is correct because... B is wrong because... etc."
  }
]
</quiz>`;
}

/**
 * Parse the <quiz> JSON block from LLM response.
 * Returns null if block is missing or JSON is invalid.
 */
export function parseQuiz(content: string): QuizQuestion[] | null {
  const match = content.match(/<quiz>\s*([\s\S]*?)\s*<\/quiz>/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]);
    if (!Array.isArray(raw) || raw.length === 0) return null;

    return raw.map((q: Record<string, unknown>) => ({
      question: String(q.question ?? ''),
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      correct: String(q.correct ?? 'A').trim().match(/^([A-D])/i)?.[1]?.toUpperCase() ?? 'A',
      explanation: String(q.explanation ?? ''),
    }));
  } catch {
    return null;
  }
}
