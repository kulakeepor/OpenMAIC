/**
 * Adaptive Practice Chat API
 *
 * POST /api/adaptive/practice
 *
 * Streams a conversational AP Physics 2 Fluids practice session.
 * When the AI outputs a JSON line with `practice_complete: true`,
 * emits a "practice_complete" SSE event with the estimated mastery.
 *
 * Request headers:
 *   x-student-id: string (localStorage UUID)
 *   x-model: optional model override
 *
 * Request body:
 *   {
 *     nodeId: string,
 *     messages: { role: 'user' | 'assistant'; content: string }[],
 *     masteryLevel: number,
 *   }
 *
 * SSE events:
 *   data: { delta: string }                                        — text chunk
 *   data: { done: true }                                           — stream finished normally
 *   data: { type: 'practice_complete', estimated_mastery: number } — session assessed
 *   data: { type: 'error', data: { message: string } }
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';

const log = createLogger('Adaptive Practice API');

export const maxDuration = 60;

interface PracticeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PracticeRequestBody {
  nodeId: string;
  messages: PracticeMessage[];
  masteryLevel: number;
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildMasteryGuidance(masteryLevel: number): string {
  if (masteryLevel < 0.4) {
    return `The student is a beginner with this concept (mastery: ${masteryLevel.toFixed(2)}).
- Use simple analogies and everyday language to guide understanding.
- Be generous with encouragement — celebrate small wins.
- Ask one question at a time; do not overwhelm.
- Do NOT give away the answer directly; instead, lead them toward it.`;
  }

  if (masteryLevel <= 0.7) {
    return `The student has partial understanding of this concept (mastery: ${masteryLevel.toFixed(2)}).
- Probe their reasoning with follow-up questions to surface gaps.
- Correct misconceptions clearly but kindly, explaining why they are wrong.
- Challenge them to connect the concept to related ideas they already know.`;
  }

  return `The student has strong understanding of this concept (mastery: ${masteryLevel.toFixed(2)}).
- Present edge cases, counterintuitive scenarios, or real-world complexities.
- Push for deeper reasoning: ask "why" and "what if" questions.
- Expect precise, nuanced answers — gently push back on vague explanations.`;
}

function buildSystemPrompt(nodeId: string, masteryLevel: number): string {
  const guidance = buildMasteryGuidance(masteryLevel);

  return `You are an AP Physics 2 practice partner for the Fluids unit.
Current concept: ${nodeId}
Student mastery level: ${masteryLevel.toFixed(2)}

${guidance}

Engage the student in a 4–6 turn conversation:
- Ask them to explain the concept in their own words
- Follow up with probing questions
- Correct misconceptions clearly but kindly
- Use LaTeX for all math: inline $...$ display $$...$$

After 4–6 turns, output a JSON object on its own line:
{"practice_complete": true, "estimated_mastery": 0.0}
where estimated_mastery is your assessment of the student's understanding (0.0–1.0).
Before the JSON, write one sentence summarizing the student's performance.`;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Scans the full text for the practice-complete JSON line.
 * Returns the estimated_mastery value if found, otherwise null.
 */
function parsePracticeComplete(text: string): number | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.practice_complete === true && typeof parsed.estimated_mastery === 'number') {
        return Math.min(1, Math.max(0, parsed.estimated_mastery as number));
      }
    } catch {
      // Not valid JSON — keep scanning
    }
  }
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const studentId = req.headers.get('x-student-id') || 'anonymous';
    const body: PracticeRequestBody = await req.json();

    if (!body.nodeId || typeof body.nodeId !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: nodeId');
    }
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }
    if (typeof body.masteryLevel !== 'number') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: masteryLevel');
    }

    const modelOverride = req.headers.get('x-model');
    const { model: languageModel, apiKey, providerId, modelString } = await resolveModel({
      modelString: modelOverride || process.env.DEFAULT_MODEL || 'markx:gpt-4o-mini',
      apiKey: req.headers.get('x-api-key') || undefined,
      baseUrl: req.headers.get('x-base-url') || undefined,
      providerType: req.headers.get('x-provider-type') || undefined,
    });

    if (isProviderKeyRequired(providerId) && !apiKey) {
      return apiError('MISSING_API_KEY', 401, 'API key required');
    }

    log.info(
      `Practice request: student=${studentId}, node=${body.nodeId}, ` +
        `mastery=${body.masteryLevel.toFixed(2)}, model=${modelString}, msgs=${body.messages.length}`,
    );

    // Ensure messages list is non-empty (LLM requires at least one user turn).
    const effectiveMessages: PracticeMessage[] =
      body.messages.length > 0
        ? body.messages
        : [{ role: 'user', content: 'Please start the practice session.' }];

    const systemPrompt = buildSystemPrompt(body.nodeId, body.masteryLevel);

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
            system: systemPrompt,
            messages: effectiveMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            temperature: 0.7,
          },
          'adaptive-practice',
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

        // Detect practice-session completion
        const estimatedMastery = parsePracticeComplete(text);
        if (estimatedMastery !== null) {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'practice_complete', estimated_mastery: estimatedMastery })}\n\n`,
            ),
          );
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (req.signal.aborted) {
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error('Practice stream error:', error);
        try {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                data: { message: error instanceof Error ? error.message : String(error) },
              })}\n\n`,
            ),
          );
          await writer.close();
        } catch {
          /* already closed */
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
    log.error('Practice request failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Failed');
  }
}
