/**
 * Quiz Generation API
 *
 * POST /api/adaptive/quiz/generate
 * { nodeId: string, count?: number, masteryLevel?: number }
 *
 * Returns: { questions: QuizQuestion[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';
import { buildQuizPrompt, parseQuiz } from '@/lib/adaptive/quiz-prompts';
import type { KnowledgeNode } from '@/lib/types/adaptive';
import knowledgeGraph from '@/data/fluids-knowledge-graph.json';

const log = createLogger('Quiz Generate API');

const nodeMap = new Map<string, KnowledgeNode>(
  (knowledgeGraph as KnowledgeNode[]).map((n) => [n.id, n]),
);

export async function POST(req: NextRequest) {
  try {
    const body: { nodeId: string; count?: number; masteryLevel?: number } = await req.json();

    if (!body.nodeId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: nodeId');
    }

    const node = nodeMap.get(body.nodeId);
    if (!node) {
      return apiError('INVALID_REQUEST', 404, `Node not found: ${body.nodeId}`);
    }

    const count = Math.min(5, Math.max(1, body.count ?? 3));
    const masteryLevel =
      typeof body.masteryLevel === 'number' && Number.isFinite(body.masteryLevel)
        ? Math.min(1, Math.max(0, body.masteryLevel))
        : 0.5;

    const { model: languageModel, apiKey, providerId, modelString } = await resolveModel({
      modelString: 'glm:glm-4.7',
      apiKey: req.headers.get('x-api-key') || undefined,
      baseUrl: req.headers.get('x-base-url') || undefined,
      providerType: req.headers.get('x-provider-type') || undefined,
    });

    if (isProviderKeyRequired(providerId) && !apiKey) {
      return apiError('MISSING_API_KEY', 401, 'API key required');
    }

    log.info(
      `Quiz generate: node=${body.nodeId}, count=${count}, mastery=${masteryLevel}, model=${modelString}`,
    );

    const prompt = buildQuizPrompt(node, count, masteryLevel);
    const thinkingConfig: ThinkingConfig = { enabled: false };

    const result = await callLLM(
      {
        model: languageModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
      },
      'quiz-generate',
      { retries: 2 },
      thinkingConfig,
    );

    const questions = parseQuiz(result.text ?? '');
    if (!questions) {
      log.error('Failed to parse quiz from LLM response');
      return apiError('GENERATION_FAILED', 500, 'Failed to generate valid quiz questions');
    }

    return NextResponse.json({ questions });
  } catch (error) {
    log.error('Quiz generate failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Failed');
  }
}
