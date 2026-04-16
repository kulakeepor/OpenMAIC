/**
 * Interview Chat API Endpoint
 *
 * POST /api/interview/chat - Send interview message, receive SSE stream
 *
 * This endpoint:
 * 1. Receives interview state (topic, messages, collectedInfo, currentRound)
 * 2. Builds system prompt using buildInterviewSystemPrompt()
 * 3. Streams AI response via SSE
 * 4. Supports interruption via request abort
 */

import { NextRequest } from 'next/server';
import { streamLLM } from '@/lib/ai/llm';
import { buildInterviewSystemPrompt } from '@/lib/interview/interview-prompts';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import type { InterviewTurn } from '@/lib/types/interview';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { ThinkingConfig } from '@/lib/types/provider';

const log = createLogger('Interview Chat API');

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export interface InterviewChatRequest {
  topic: string;
  messages: InterviewTurn[];
  collectedInfo?: string;
  currentRound: number;
}

/**
 * POST /api/interview/chat
 *
 * Request headers:
 * - x-model: model string (e.g., "openai/gpt-4o-mini")
 *
 * Request body: InterviewChatRequest
 * {
 *   topic: string,
 *   messages: InterviewTurn[],
 *   collectedInfo?: string,
 *   currentRound: number
 * }
 *
 * Response: SSE stream of text deltas
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body: InterviewChatRequest = await req.json();

    // Validate required fields
    if (!body.topic || typeof body.topic !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: topic');
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (typeof body.currentRound !== 'number' || body.currentRound < 1) {
      return apiError('INVALID_REQUEST', 400, 'Invalid currentRound: must be a positive number');
    }

    // Resolve model from headers
    const { model: languageModel, apiKey, providerId } = await resolveModelFromHeaders(req);

    if (isProviderKeyRequired(providerId) && !apiKey) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info(`Processing interview chat request: topic="${body.topic}", round=${body.currentRound}`);

    // Build system prompt
    const systemPrompt = buildInterviewSystemPrompt({
      topic: body.topic,
      collectedInfo: body.collectedInfo,
      currentRound: body.currentRound,
    });

    // Build messages array for LLM with proper typing
    const llmMessages = body.messages.map((turn) =>
      turn.role === 'assistant'
        ? { role: 'assistant' as const, content: turn.content }
        : { role: 'user' as const, content: turn.content },
    );

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat
    const HEARTBEAT_INTERVAL_MS = 15_000;
    (async () => {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
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

        const result = streamLLM(
          {
            model: languageModel,
            system: systemPrompt,
            messages: llmMessages,
            temperature: 0.7,
          },
          'interview-chat',
          thinkingConfig,
        );

        // Stream text deltas
        for await (const delta of result.textStream) {
          if (req.signal.aborted) {
            log.info('Request was aborted');
            break;
          }

          const data = `data: ${JSON.stringify({ delta })}\n\n`;
          await writer.write(encoder.encode(data));
        }

        // Send done event
        await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (req.signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error('Interview stream error:', error);

        try {
          const errorEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
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
    log.error('Interview chat request failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}
