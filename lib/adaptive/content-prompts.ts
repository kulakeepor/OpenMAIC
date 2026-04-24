/**
 * Adaptive Content Prompts
 *
 * Builds LLM prompts for generating personalized lesson content
 * based on a KnowledgeNode and the student's current mastery level.
 */

import type { KnowledgeNode } from '@/lib/types/adaptive';

/**
 * Build a content generation prompt tailored to the student's mastery level.
 *
 * - Low mastery (< 0.4): Focus on intuition, analogies, explain_like_5
 * - Mid mastery (0.4–0.7): Balance concept + application, highlight misconceptions
 * - High mastery (> 0.7): Direct treatment, equations, AP exam focus
 */
export function buildContentPrompt(node: KnowledgeNode, studentMastery: number): string {
  const depth = getMasteryDepth(studentMastery);
  const skeleton = node.teaching_skeleton;

  return `You are an AP Physics 2 tutor. Generate a focused, engaging lesson for the following concept.

## Concept
- Name: ${node.name}
- Difficulty: ${node.difficulty}/5
- Estimated time: ${node.estimated_minutes} minutes
- Key equations: ${node.key_equations.length > 0 ? node.key_equations.join('; ') : 'none'}

## Student Level
Mastery: ${Math.round(studentMastery * 100)}% — ${depth.label}
Instruction: ${depth.instruction}

## Teaching Reference (use as your guide, not as a script)
Core idea: ${skeleton.core_idea}
Simple explanation: ${skeleton.explain_like_5}
Key example: ${skeleton.key_examples[0] ?? 'none'}
Real world: ${skeleton.real_world_connections[0] ?? 'none'}
AP tip: ${skeleton.ap_exam_tips}

## Common Misconceptions to Address
${node.common_misconceptions.slice(0, 2).map((m, i) => `${i + 1}. ${m}`).join('\n')}

## Output Format
Write the lesson content in clean Markdown with these exact four sections:

### Core Idea
[One clear paragraph explaining the concept at the right depth for this student]

### Key Example
[One concrete worked example — show the thinking process, not just the answer]

### Real World Connection
[One vivid real-world application that makes the concept memorable]

### AP Exam Tip
[One specific, actionable exam strategy for this concept]

Keep it concise — the student should be able to read this in ${Math.round(node.estimated_minutes * 0.6)} minutes.
Use plain English. No unnecessary jargon. Be direct.`;
}

interface MasteryDepth {
  label: string;
  instruction: string;
}

function getMasteryDepth(mastery: number): MasteryDepth {
  if (mastery < 0.4) {
    return {
      label: 'Beginner',
      instruction:
        'Start from scratch. Use everyday analogies and the simple explanation provided. Avoid equations until the concept is clear. Build intuition first.',
    };
  } else if (mastery < 0.7) {
    return {
      label: 'Developing',
      instruction:
        'Student has partial understanding. Clarify common misconceptions directly. Introduce equations with conceptual meaning. Use the key example to bridge intuition and math.',
    };
  } else {
    return {
      label: 'Proficient',
      instruction:
        'Student has solid foundation. Go straight to the physics. Introduce equations rigorously. Focus on AP exam applications and edge cases.',
    };
  }
}
