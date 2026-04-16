'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { InterviewResult, InterviewSession, InterviewTurn } from '@/lib/types/interview';
import { InterviewSummaryCard } from './interview-summary-card';

interface InterviewChatProps {
  topic: string;
  onComplete: (result: InterviewResult) => void;
  onSkip: () => void;
}

type InterviewApiEvent =
  | string
  | {
      type?: string;
      data?: unknown;
      content?: string;
      delta?: string;
      done?: boolean;
      result?: InterviewResult;
    };

const DEFAULT_TOTAL_ROUNDS = 8;
const INTERVIEW_DRAFT_STORAGE_PREFIX = 'interviewDraft:';

interface InterviewDraftState {
  session: InterviewSession;
  input: string;
  parsedResult: InterviewResult | null;
}

function createInitialSession(topic: string): InterviewSession {
  return {
    id: `interview-${Date.now()}`,
    topic,
    status: 'in-progress',
    currentRound: 1,
    totalRounds: DEFAULT_TOTAL_ROUNDS,
    messages: [],
    collectedInfo: {},
  };
}

function createTurn(role: InterviewTurn['role'], content: string): InterviewTurn {
  return {
    role,
    content,
    timestamp: Date.now(),
  };
}

function countAssistantRounds(messages: InterviewTurn[]): number {
  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  return Math.min(DEFAULT_TOTAL_ROUNDS, Math.max(1, assistantMessages.length));
}

function extractJsonCodeBlock(content: string): string | null {
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

function tryParseInterviewResult(content: string): InterviewResult | null {
  const jsonBlock = extractJsonCodeBlock(content);
  if (!jsonBlock) return null;

  try {
    return JSON.parse(jsonBlock) as InterviewResult;
  } catch {
    return null;
  }
}

function formatCollectedInfo(collectedInfo: InterviewSession['collectedInfo']): string {
  const sections: string[] = [];

  if (collectedInfo.learningObjectives?.length) {
    sections.push(`教学目标：${collectedInfo.learningObjectives.join('；')}`);
  }
  if (collectedInfo.keyDifficulties?.length) {
    sections.push(`核心难点：${collectedInfo.keyDifficulties.join('；')}`);
  }
  if (collectedInfo.commonMisconceptions?.length) {
    sections.push(`常见误区：${collectedInfo.commonMisconceptions.join('；')}`);
  }
  if (collectedInfo.studentLevel) {
    sections.push(`学生水平：${collectedInfo.studentLevel}`);
  }
  if (collectedInfo.prerequisites?.length) {
    sections.push(`先修知识：${collectedInfo.prerequisites.join('、')}`);
  }
  if (collectedInfo.duration) {
    sections.push(`课堂时长：${collectedInfo.duration} 分钟`);
  }

  return sections.length > 0 ? sections.join('\n') : '暂无。请根据对话逐步收集并更新。';
}

function extractEventText(event: InterviewApiEvent): string | null {
  if (typeof event === 'string') return event;
  if (typeof event.content === 'string') return event.content;
  if (typeof event.delta === 'string') return event.delta;
  if (
    event.type === 'text_delta' &&
    event.data &&
    typeof event.data === 'object' &&
    'content' in event.data &&
    typeof (event.data as { content: unknown }).content === 'string'
  ) {
    return (event.data as { content: string }).content;
  }
  if (
    event.type === 'message' &&
    event.data &&
    typeof event.data === 'object' &&
    'content' in event.data &&
    typeof (event.data as { content: unknown }).content === 'string'
  ) {
    return (event.data as { content: string }).content;
  }
  return null;
}

function getInterviewDraftStorageKey(topic: string): string {
  return `${INTERVIEW_DRAFT_STORAGE_PREFIX}${topic}`;
}

function loadInterviewDraft(topic: string): InterviewDraftState | null {
  if (typeof window === 'undefined') return null;

  const raw = sessionStorage.getItem(getInterviewDraftStorageKey(topic));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as InterviewDraftState;
  } catch {
    return null;
  }
}

export function InterviewChat({ topic, onComplete, onSkip }: InterviewChatProps) {
  const restoredDraftRef = useRef<InterviewDraftState | null>(null);
  const [session, setSession] = useState<InterviewSession>(() => createInitialSession(topic));
  const [input, setInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<InterviewResult | null>(null);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasBootstrappedRef = useRef(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const draftStorageKey = useMemo(() => getInterviewDraftStorageKey(topic), [topic]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session.messages, assistantDraft, parsedResult]);

  useEffect(() => {
    const restoredDraft = loadInterviewDraft(topic);
    restoredDraftRef.current = restoredDraft;

    if (restoredDraft) {
      setSession(restoredDraft.session);
      setInput(restoredDraft.input);
      setParsedResult(restoredDraft.parsedResult);
    }

    setDraftReady(true);
  }, [topic]);

  useEffect(() => {
    if (!draftReady || typeof window === 'undefined') return;

    const draftPayload: InterviewDraftState = {
      session,
      input,
      parsedResult,
    };
    sessionStorage.setItem(draftStorageKey, JSON.stringify(draftPayload));
  }, [draftReady, draftStorageKey, input, parsedResult, session]);

  useEffect(() => {
    if (!draftReady) return;
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    if (session.messages.length > 0 || session.result || parsedResult) {
      return () => {
        abortControllerRef.current?.abort();
      };
    }

    void sendInterviewMessage();

    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady]);

  const progressValue = useMemo(
    () => Math.min(100, (session.currentRound / session.totalRounds) * 100),
    [session.currentRound, session.totalRounds],
  );

  const replaceOrAppendAssistantMessage = useCallback((content: string) => {
    setSession((prev) => {
      const messages = [...prev.messages];
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        messages[messages.length - 1] = { ...lastMessage, content };
      } else {
        messages.push(createTurn('assistant', content));
      }

      return {
        ...prev,
        messages,
        currentRound: countAssistantRounds(messages),
      };
    });
  }, []);

  const finalizeAssistantMessage = useCallback(
    (content: string, explicitResult?: InterviewResult) => {
      const finalContent = content.trim();
      if (!finalContent) return;

      replaceOrAppendAssistantMessage(finalContent);
      const nextResult = explicitResult || tryParseInterviewResult(finalContent);

      if (nextResult) {
        setParsedResult(nextResult);
        setSession((prev) => ({
          ...prev,
          status: 'summarizing',
          collectedInfo: nextResult,
          result: nextResult,
        }));
      }
    },
    [replaceOrAppendAssistantMessage],
  );

  const handleSSEPayload = useCallback(
    (payload: string, assistantContentRef: { value: string }) => {
      if (!payload.trim()) return;

      let parsed: InterviewApiEvent = payload;
      try {
        parsed = JSON.parse(payload) as InterviewApiEvent;
      } catch {
        parsed = payload;
      }

      if (
        typeof parsed !== 'string' &&
        parsed.type === 'done' &&
        parsed.result &&
        typeof parsed.result === 'object'
      ) {
        finalizeAssistantMessage(
          assistantContentRef.value || '```json\n' + JSON.stringify(parsed.result, null, 2) + '\n```',
          parsed.result,
        );
        return;
      }

      if (typeof parsed !== 'string' && parsed.done === true) {
        return;
      }

      const text = extractEventText(parsed);
      if (text) {
        assistantContentRef.value += text;
        setAssistantDraft(assistantContentRef.value);
      }
    },
    [finalizeAssistantMessage],
  );

  const readSSEStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return '';

      const decoder = new TextDecoder();
      const assistantContentRef = { value: '' };
      let sseBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const rawEvent of events) {
          const lines = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''));

          if (lines.length === 0) continue;
          handleSSEPayload(lines.join('\n'), assistantContentRef);
        }
      }

      const finalText = decoder.decode();
      if (finalText) {
        sseBuffer += finalText;
      }

      if (sseBuffer.trim()) {
        const lines = sseBuffer
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, ''));

        if (lines.length > 0) {
          handleSSEPayload(lines.join('\n'), assistantContentRef);
        }
      }

      return assistantContentRef.value;
    },
    [handleSSEPayload],
  );

  const sendInterviewMessage = useCallback(
    async (userContent?: string) => {
      if (isAiThinking) return;

      const trimmed = userContent?.trim();
      const nextMessages = trimmed ? [...session.messages, createTurn('user', trimmed)] : session.messages;

      if (trimmed) {
        setSession((prev) => ({
          ...prev,
          messages: [...prev.messages, createTurn('user', trimmed)],
          status: 'in-progress',
        }));
        setInput('');
      }

      setError(null);
      setAssistantDraft('');
      setParsedResult(null);
      setIsAiThinking(true);

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch('/api/interview/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-model': 'glm:glm-4.7',
          },
          body: JSON.stringify({
            sessionId: session.id,
            topic,
            currentRound: session.currentRound,
            totalRounds: session.totalRounds,
            messages: nextMessages,
            collectedInfo: session.collectedInfo,
            collectedInfoText: formatCollectedInfo(session.collectedInfo),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Interview API error: ${response.status}`);
        }

        let finalAssistantContent = '';

        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          finalAssistantContent = await readSSEStream(response);
        } else {
          finalAssistantContent = await response.text();
          setAssistantDraft(finalAssistantContent);
        }

        if (finalAssistantContent.trim()) {
          finalizeAssistantMessage(finalAssistantContent);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;

        const message = err instanceof Error ? err.message : '访谈请求失败';
        setError(message);
      } finally {
        setAssistantDraft('');
        setIsAiThinking(false);
      }
    },
    [
      finalizeAssistantMessage,
      isAiThinking,
      readSSEStream,
      session.collectedInfo,
      session.currentRound,
      session.id,
      session.messages,
      session.totalRounds,
      topic,
    ],
  );

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    void sendInterviewMessage(input);
  }, [input, sendInterviewMessage]);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleConfirm = useCallback(() => {
    const result = parsedResult || session.result;
    if (!result) return;

    setSession((prev) => ({
      ...prev,
      status: 'confirmed',
      result,
    }));
    sessionStorage.removeItem(draftStorageKey);
    onComplete(result);
  }, [draftStorageKey, onComplete, parsedResult, session.result]);

  const handleModify = useCallback(() => {
    setParsedResult(null);
    setSession((prev) => ({
      ...prev,
      status: 'in-progress',
    }));
  }, []);

  const handleSkip = useCallback(() => {
    abortControllerRef.current?.abort();
    setSession((prev) => ({
      ...prev,
      status: 'cancelled',
    }));
    sessionStorage.removeItem(draftStorageKey);
    onSkip();
  }, [draftStorageKey, onSkip]);

  const allMessages = useMemo(() => {
    if (!assistantDraft) return session.messages;
    return [...session.messages, createTurn('assistant', assistantDraft)];
  }, [assistantDraft, session.messages]);
  const hasAssistantQuestion = useMemo(
    () => allMessages.some((message) => message.role === 'assistant'),
    [allMessages],
  );
  const isBootstrappingFirstQuestion =
    draftReady &&
    !restoredDraftRef.current &&
    !hasAssistantQuestion &&
    isAiThinking &&
    !assistantDraft;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-white/80 shadow-[0_10px_40px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:bg-slate-950/70">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">课堂设计访谈</h2>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">课题：{topic}</p>
          </div>

          <Button variant="ghost" size="sm" onClick={handleSkip}>
            跳过访谈
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              第 {session.currentRound} / {session.totalRounds} 轮
            </span>
            <span>{Math.round(progressValue)}%</span>
          </div>
          <Progress value={progressValue} />
          {restoredDraftRef.current && session.messages.length > 0 && (
            <p className="text-xs text-muted-foreground">
              已恢复上次未完成的访谈记录，你可以继续回答或直接确认摘要。
            </p>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 py-5 md:px-5">
          {isBootstrappingFirstQuestion && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 px-4 py-4"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                AI 老师正在生成第一个访谈问题
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                访谈会先由 AI 抛出第一个问题，再由你逐步回答。请稍等片刻。
              </p>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {allMessages.map((message, index) => {
              const isAssistant = message.role === 'assistant';

              return (
                <motion.div
                  key={`${message.timestamp}-${index}-${message.role}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className={cn(
                    'flex gap-3',
                    isAssistant ? 'justify-start' : 'justify-end',
                  )}
                >
                  {isAssistant && (
                    <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Bot className="size-4" />
                    </div>
                  )}

                  <Card
                    size="sm"
                    className={cn(
                      'max-w-[85%] gap-0 px-0 py-0 shadow-sm',
                      isAssistant
                        ? 'rounded-tl-sm border-border/60 bg-background/95'
                        : 'rounded-tr-sm border-primary/15 bg-primary text-primary-foreground',
                    )}
                  >
                    <div className="px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words">
                      {message.content}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isAiThinking && !assistantDraft && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3"
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-4" />
              </div>
              <Card size="sm" className="gap-0 rounded-tl-sm px-0 py-0">
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span>{hasAssistantQuestion ? 'AI 老师正在整理下一问…' : 'AI 老师正在生成第一个问题…'}</span>
                </div>
              </Card>
            </motion.div>
          )}

          {(parsedResult || session.result) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <InterviewSummaryCard
                result={(parsedResult || session.result)!}
                onConfirm={handleConfirm}
                onModify={handleModify}
              />
            </motion.div>
          )}

          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card size="sm" className="gap-0 border-destructive/20 bg-destructive/5 px-0 py-0">
                <div className="px-4 py-3 text-sm text-destructive">{error}</div>
              </Card>
            </motion.div>
          )}

          <div ref={scrollAnchorRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border/60 px-4 py-4 md:px-5">
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={
              isBootstrappingFirstQuestion
                ? '请等待 AI 老师先提出第一个问题...'
                : parsedResult || session.status === 'summarizing'
                ? '如果需要修改，请补充说明你的调整意见'
                : hasAssistantQuestion
                  ? '请回答上方问题...'
                  : '等待 AI 老师发问...'
            }
            disabled={isAiThinking || isBootstrappingFirstQuestion}
          />
          <Button
            onClick={handleSend}
            disabled={isAiThinking || !input.trim()}
            size="icon"
            aria-label="发送访谈消息"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
