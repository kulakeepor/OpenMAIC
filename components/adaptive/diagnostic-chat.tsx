'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { MathText } from './math-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DIAGNOSTIC_INITIAL_MESSAGE } from '@/lib/adaptive/diagnostic-prompts';
import { getOrCreateStudentId } from '@/lib/adaptive/student-model';
import { cn } from '@/lib/utils';
import type { DiagnosticResult } from '@/lib/types/adaptive';

interface DiagnosticChatProps {
  onComplete: (result: DiagnosticResult) => void;
}

interface DiagnosticMessage {
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
}

type DiagnosticApiEvent =
  | {
      delta?: string;
      done?: boolean;
      type?: string;
      result?: DiagnosticResult;
      data?: {
        message?: string;
      };
    }
  | string;

const DIAGNOSTIC_KEY_PREFIX = 'adaptive_diagnostic_completed:';

function createMessage(role: DiagnosticMessage['role'], content: string): DiagnosticMessage {
  return {
    role,
    content,
    timestamp: Date.now(),
  };
}

function toApiMessages(messages: DiagnosticMessage[]) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function parseSSEPayload(payload: string): DiagnosticApiEvent {
  try {
    return JSON.parse(payload) as DiagnosticApiEvent;
  } catch {
    return payload;
  }
}

function getEventError(event: DiagnosticApiEvent): string | null {
  if (typeof event === 'string') return null;
  if (event.type === 'error') {
    return event.data?.message || '诊断请求失败，请稍后重试。';
  }
  return null;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" aria-label="AI 正在输入">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

export function DiagnosticChat({ onComplete }: DiagnosticChatProps) {
  const [messages, setMessages] = useState<DiagnosticMessage[]>(() => [
    createMessage('assistant', DIAGNOSTIC_INITIAL_MESSAGE),
  ]);
  const [input, setInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const completionHandledRef = useRef(false);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isAiThinking, error]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const appendToLatestAssistantMessage = useCallback((delta: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const lastMessage = next[next.length - 1];

      if (lastMessage?.role === 'assistant') {
        next[next.length - 1] = {
          ...lastMessage,
          content: `${lastMessage.content}${delta}`,
        };
        return next;
      }

      return [...next, createMessage('assistant', delta)];
    });
  }, []);

  const handleDiagnosticComplete = useCallback(
    (result: DiagnosticResult) => {
      if (completionHandledRef.current) return;
      completionHandledRef.current = true;

      const studentId = result.student_id || getOrCreateStudentId();
      if (studentId) {
        localStorage.setItem(`${DIAGNOSTIC_KEY_PREFIX}${studentId}`, 'true');
      }

      onComplete(result);
    },
    [onComplete],
  );

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

      if (event.type === 'diagnostic_complete' && event.result) {
        handleDiagnosticComplete(event.result);
        return;
      }

      if (event.delta) {
        appendToLatestAssistantMessage(event.delta);
      }
    },
    [appendToLatestAssistantMessage, handleDiagnosticComplete],
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
      const response = await fetch('/api/adaptive/diagnostic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': studentId || 'anonymous',
        },
        body: JSON.stringify({
          messages: toApiMessages(requestMessages),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Diagnostic API error: ${response.status}`);
      }

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        await readSSEStream(response);
      } else {
        appendToLatestAssistantMessage(await response.text());
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '诊断请求失败，请稍后重试。');
    } finally {
      setIsAiThinking(false);
    }
  }, [appendToLatestAssistantMessage, input, isAiThinking, messages, readSSEStream]);

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
    const lastMessage = messages[messages.length - 1];
    return Boolean(isAiThinking && lastMessage?.role === 'assistant' && !lastMessage.content);
  }, [isAiThinking, messages]);

  return (
    <div className="flex h-[620px] min-h-0 flex-col overflow-hidden rounded-lg border border-slate-900/10 bg-white shadow-sm">
      <div className="border-b border-slate-900/10 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-sky-700" />
              <h2 className="text-base font-semibold text-slate-950">Fluids 诊断对话</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">回答几个问题，系统会生成你的起点建议。</p>
          </div>
          {isAiThinking ? (
            <div className="flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800">
              <Loader2 className="size-3.5 animate-spin" />
              AI thinking
            </div>
          ) : null}
        </div>
      </div>

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
                  <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <Bot className="size-4" />
                  </div>
                ) : null}

                <Card
                  size="sm"
                  className={cn(
                    'max-w-[86%] gap-0 px-0 py-0 shadow-sm',
                    isAssistant
                      ? 'rounded-tl-sm border-slate-200 bg-white'
                      : 'rounded-tr-sm border-sky-200 bg-sky-100 text-slate-900',
                  )}
                >
                  <div className="px-4 py-3 text-sm leading-6 break-words text-slate-900">
                    {isEmptyLoadingMessage ? <ThinkingDots /> : <MathText>{message.content}</MathText>}
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

      <div className="border-t border-slate-900/10 bg-white px-4 py-4 md:px-5">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={isAiThinking ? '等待 AI 老师回复...' : '输入你的想法...'}
            disabled={isAiThinking}
          />
          <Button
            size="icon"
            aria-label="发送诊断消息"
            disabled={isAiThinking || !input.trim()}
            onClick={() => void sendMessage()}
            className="bg-slate-950 text-white hover:bg-slate-800"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
