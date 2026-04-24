/**
 * Adaptive Diagnostic Chat API
 *
 * POST /api/adaptive/diagnostic
 *
 * Streams a conversational AP Physics 2 Fluids diagnostic.
 * When the AI outputs a <diagnostic_result> block, emits a
 * "diagnostic_complete" SSE event and saves to Supabase.
 *
 * Request headers:
 *   x-student-id: string (localStorage UUID)
 *   x-model: optional model override
 *
 * Request body:
 *   { messages: { role: 'user' | 'assistant'; content: string }[] }
 *
 * SSE events:
 *   data: { delta: string }          — text chunk
 *   data: { done: true }             — stream finished normally
 *   data: { type: 'diagnostic_complete', result: DiagnosticResult } — assessment ready
 *   data: { type: 'error', data: { message: string } }
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';
import {
  DIAGNOSTIC_SYSTEM_PROMPT,
  DIAGNOSTIC_INITIAL_MESSAGE,
  parseDiagnosticResult,
} from '@/lib/adaptive/diagnostic-prompts';
import { saveDiagnosticResult } from '@/lib/supabase/adaptive';

const log = createLogger('Adaptive Diagnostic API');

export const maxDuration = 60;

interface DiagnosticMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const studentId = req.headers.get('x-student-id') || 'anonymous';
    const body: { messages: DiagnosticMessage[] } = await req.json();

    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
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

    log.info(`Diagnostic request: student=${studentId}, model=${modelString}, msgs=${body.messages.length}`);

    // If no messages yet, send a trigger so the AI produces the opening message.
    // GLM requires the first message to be role: 'user'.
    const effectiveMessages: DiagnosticMessage[] =
      body.messages.length > 0
        ? body.messages
        : [{ role: 'user', content: 'Please start the diagnostic conversation.' }];

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
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      };

      try {
        startHeartbeat();

        const thinkingConfig: ThinkingConfig = { enabled: false };

        const result = await callLLM(
          {
            model: languageModel,
            system: DIAGNOSTIC_SYSTEM_PROMPT,
            messages: effectiveMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: 0.7,
          },
          'adaptive-diagnostic',
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

        // Detect diagnostic completion
        if (text.includes('<diagnostic_result>')) {
          const diagnosticResult = parseDiagnosticResult(text, studentId);
          if (diagnosticResult) {
            // Save to Supabase (fire-and-forget, don't block stream)
            saveDiagnosticResult(diagnosticResult).catch((err) =>
              log.error('Failed to save diagnostic result:', err),
            );

            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'diagnostic_complete', result: diagnosticResult })}\n\n`,
              ),
            );
          }
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

        log.error('Diagnostic stream error:', error);
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
    log.error('Diagnostic request failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Failed');
  }
}
