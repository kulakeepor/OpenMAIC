/**
 * Adaptive Content Generation API
 *
 * POST /api/adaptive/content
 *
 * Generates personalized lesson content for a single knowledge node,
 * streamed via SSE. Content depth adapts to student mastery level.
 *
 * Request body:
 *   { nodeId: string, studentMastery: number }
 *
 * SSE events:
 *   data: { delta: string }
 *   data: { done: true }
 *   data: { type: 'error', data: { message: string } }
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';
import { buildContentPrompt } from '@/lib/adaptive/content-prompts';
import type { KnowledgeNode } from '@/lib/types/adaptive';
import knowledgeGraph from '@/data/fluids-knowledge-graph.json';

const log = createLogger('Adaptive Content API');

export const maxDuration = 60;

const nodeMap = new Map<string, KnowledgeNode>(
  (knowledgeGraph as KnowledgeNode[]).map((n) => [n.id, n]),
);

interface ContentRequest {
  nodeId: string;
  studentMastery: number;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body: ContentRequest = await req.json();

    if (!body.nodeId || typeof body.nodeId !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: nodeId');
    }

    const mastery =
      typeof body.studentMastery === 'number'
        ? Math.min(1, Math.max(0, body.studentMastery))
        : 0;

    const node = nodeMap.get(body.nodeId);
    if (!node) {
      return apiError('INVALID_REQUEST', 404, `Node not found: ${body.nodeId}`);
    }

    const { model: languageModel, apiKey, providerId, modelString } = await resolveModel({
      modelString: process.env.DEFAULT_MODEL || 'markx:gpt-4o-mini',
      apiKey: req.headers.get('x-api-key') || undefined,
      baseUrl: req.headers.get('x-base-url') || undefined,
      providerType: req.headers.get('x-provider-type') || undefined,
    });

    if (isProviderKeyRequired(providerId) && !apiKey) {
      return apiError('MISSING_API_KEY', 401, 'API key required');
    }

    log.info(`Content request: node=${body.nodeId}, mastery=${mastery}, model=${modelString}`);

    const prompt = buildContentPrompt(node, mastery);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    const HEARTBEAT_MS = 15_000;
    (async () => {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          writer.write(encoder.encode(':heartbeat\n\n')).catch(stopHeartbeat);
        }, HEARTBEAT_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        const thinkingConfig: ThinkingConfig = { enabled: false };

        const result = await callLLM(
          {
            model: languageModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
          },
          'adaptive-content',
          { retries: 1 },
          thinkingConfig,
        );

        if (req.signal.aborted) {
          stopHeartbeat();
          await writer.close();
          return;
        }

        const text = result.text?.trim() || '';
        if (text) {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (req.signal.aborted) {
          try { await writer.close(); } catch { /* already closed */ }
          return;
        }

        log.error('Content stream error:', error);
        try {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', data: { message: error instanceof Error ? error.message : String(error) } })}\n\n`,
            ),
          );
          await writer.close();
        } catch { /* already closed */ }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Content request failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Failed');
  }
}
