'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, MessageSquare, Send, User } from 'lucide-react';
import { MathText } from './math-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getOrCreateStudentId } from '@/lib/adaptive/student-model';
import { cn } from '@/lib/utils';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PracticeChatProps {
  nodeId: string;
  masteryLevel: number;
  onComplete: (newMastery: number) => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface PracticeMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
}

type PracticeApiEvent =
  | {
      delta?: string;
      done?: boolean;
      type?: string;
      estimated_mastery?: number;
      data?: {
        message?: string;
      };
    }
  | string;

// ─── Initial message by mastery level ────────────────────────────────────────

function getInitialMessage(masteryLevel: number): string {
  if (masteryLevel < 0.4) {
    return "Let's talk through this concept together. In your own words, can you describe what you understand so far?";
  }
  if (masteryLevel <= 0.7) {
    return "You've seen this before — let's go deeper. Explain the concept and give me a real-world example.";
  }
  return "Let's push your understanding. I'll give you a tricky scenario to reason through.";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMessage(role: PracticeMessage['role'], content: string): PracticeMessage {
  return { role, content, timestamp: Date.now() };
}

function toApiMessages(messages: PracticeMessage[]) {
  return messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

function parseSSEPayload(payload: string): PracticeApiEvent {
  try {
    return JSON.parse(payload) as PracticeApiEvent;
  } catch {
    return payload;
  }
}

function getEventError(event: PracticeApiEvent): string | null {
  if (typeof event === 'string') return null;
  if (event.type === 'error') {
    return event.data?.message || 'Practice request failed. Please try again.';
  }
  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" aria-label="AI is thinking">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PracticeChat({ nodeId, masteryLevel, onComplete }: PracticeChatProps) {
  const [messages, setMessages] = useState<PracticeMessage[]>(() => [
    createMessage('assistant', getInitialMessage(masteryLevel)),
  ]);
  const [input, setInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const completionHandledRef = useRef(false);

  // Auto-scroll on new content
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isAiThinking, error]);

  // Abort in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Message helpers ──────────────────────────────────────────────────────

  const appendToLatestAssistantMessage = useCallback((delta: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];

      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, content: `${last.content}${delta}` };
        return next;
      }

      return [...next, createMessage('assistant', delta)];
    });
  }, []);

  const handlePracticeComplete = useCallback(
    (estimatedMastery: number) => {
      if (completionHandledRef.current) return;
      completionHandledRef.current = true;
      onComplete(estimatedMastery);
    },
    [onComplete],
  );

  // ── SSE parsing ──────────────────────────────────────────────────────────

  const handleSSEPayload = useCallback(
    (payload: string) => {
      if (!payload.trim()) return;

      const event = parseSSEPayload(payload);
      const eventError = getEventError(event);
      if (eventError) {
        setError(eventError);
        return;
      }

      if (typeof event === 'string') {
        appendToLatestAssistantMessage(event);
        return;
      }

      if (event.type === 'practice_complete' && typeof event.estimated_mastery === 'number') {
        handlePracticeComplete(event.estimated_mastery);
        return;
      }

      if (event.delta) {
        appendToLatestAssistantMessage(event.delta);
      }
    },
    [appendToLatestAssistantMessage, handlePracticeComplete],
  );

  const readSSEStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          const payload = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n');

          handleSSEPayload(payload);
        }
      }

      const trailingText = decoder.decode();
      if (trailingText) buffer += trailingText;

      if (buffer.trim()) {
        const payload = buffer
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, ''))
          .join('\n');

        handleSSEPayload(payload);
      }
    },
    [handleSSEPayload],
  );

  // ── Send ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isAiThinking) return;

    const studentId = getOrCreateStudentId();
    const userMessage = createMessage('user', trimmed);
    const assistantPlaceholder = createMessage('assistant', '');
    const nextMessages = [...messages, userMessage, assistantPlaceholder];
    const requestMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    setIsAiThinking(true);
    completionHandledRef.current = false;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/adaptive/practice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': studentId || 'anonymous',
        },
        body: JSON.stringify({
          nodeId,
          masteryLevel,
          messages: toApiMessages(requestMessages),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Practice API error: ${response.status}`);
      }

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        await readSSEStream(response);
      } else {
        appendToLatestAssistantMessage(await response.text());
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Practice request failed. Please try again.');
    } finally {
      setIsAiThinking(false);
    }
  }, [appendToLatestAssistantMessage, input, isAiThinking, masteryLevel, messages, nodeId, readSSEStream]);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage],
  );

  const hasEmptyAssistantPlaceholder = useMemo(() => {
    const last = messages[messages.length - 1];
    return Boolean(isAiThinking && last?.role === 'assistant' && !last.content);
  }, [isAiThinking, messages]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[620px] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-900/10 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-900/10 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-violet-700" />
              <h2 className="text-base font-semibold text-slate-950">Practice</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Work through the concept with your AI practice partner.
            </p>
          </div>
          {isAiThinking ? (
            <div className="flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800">
              <Loader2 className="size-3.5 animate-spin" />
              AI thinking
            </div>
          ) : null}
        </div>
      </div>

      {/* Message list */}
      <ScrollArea className="min-h-0 flex-1 bg-[#fbf8f0]">
        <div className="space-y-4 px-4 py-5 md:px-5">
          {messages.map((message, index) => {
            const isAssistant = message.role === 'assistant';
            const isEmptyLoadingMessage =
              hasEmptyAssistantPlaceholder && index === messages.length - 1;

            return (
              <div
                key={`${message.timestamp}-${index}-${message.role}`}
                className={cn('flex gap-3', isAssistant ? 'justify-start' : 'justify-end')}
              >
                {isAssistant ? (
                  <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                    <MessageSquare className="size-4" />
                  </div>
                ) : (
                  <div className="order-last mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <User className="size-4" />
                  </div>
                )}

                <Card
                  size="sm"
                  className={cn(
                    'max-w-[86%] gap-0 px-0 py-0 shadow-sm',
                    isAssistant
                      ? 'rounded-tl-sm border-slate-200 bg-white text-slate-900'
                      : 'rounded-tr-sm border-violet-200 bg-violet-100 text-slate-900',
                  )}
                >
                  <div className="px-4 py-3 text-sm leading-6 break-words text-slate-900">
                    {isEmptyLoadingMessage ? (
                      <ThinkingDots />
                    ) : (
                      <MathText>{message.content}</MathText>
                    )}
                  </div>
                </Card>
              </div>
            );
          })}

          {error ? (
            <Card size="sm" className="gap-0 border-red-200 bg-red-50 px-0 py-0">
              <div className="px-4 py-3 text-sm text-red-700">{error}</div>
            </Card>
          ) : null}

          <div ref={scrollAnchorRef} />
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="border-t border-slate-900/10 bg-white px-4 py-4 md:px-5">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={isAiThinking ? 'Waiting for AI response...' : 'Type your answer...'}
            disabled={isAiThinking}
          />
          <Button
            size="icon"
            aria-label="Send practice message"
            disabled={isAiThinking || !input.trim()}
            onClick={() => void sendMessage()}
            className="bg-violet-700 text-white hover:bg-violet-800"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
