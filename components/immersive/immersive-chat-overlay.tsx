'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { UIMessage } from 'ai';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, ChevronDown, Loader2, MessageCircle, Send, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatMessageMetadata, StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { useCanvasStore, useSettingsStore, useStageStore } from '@/lib/store';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { cn } from '@/lib/utils';
import type {
  ImmersiveChatMessage,
  ImmersiveChatOverlayProps,
} from './immersive-chat-overlay.types';

// Student NPC IDs for discussion mode
const STUDENT_NPC_IDS = [
  'default-student-physics-1', // Riley Chen
  'default-student-physics-2', // Marcus Thompson
  'default-student-physics-3', // Priya Sharma
  'default-student-physics-4', // Ethan Park
];

// Student NPC colors for differentiating messages
const STUDENT_COLORS: Record<string, string> = {
  'default-student-physics-1': '#22d3ee', // Riley - cyan
  'default-student-physics-2': '#64748b', // Marcus - slate
  'default-student-physics-3': '#fb923c', // Priya - orange
  'default-student-physics-4': '#a78bfa', // Ethan - violet
};

const IMMERSIVE_MODEL = 'glm:glm-4.7';

function toUiMessages(messages: ImmersiveChatMessage[]): UIMessage<ChatMessageMetadata>[] {
  return messages.map((message, index) => ({
    id: `immersive-${message.timestamp}-${index}`,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
    metadata: {
      senderName: message.agentName,
      agentId: message.agentId,
      originalRole: message.role === 'assistant' ? 'teacher' : 'user',
      createdAt: message.timestamp,
    },
  }));
}

function getModelRequestConfig() {
  const glmConfig = useSettingsStore.getState().providersConfig.glm;

  return {
    apiKey: glmConfig?.apiKey || '',
    baseUrl: glmConfig?.baseUrl || '',
    providerType: glmConfig?.type,
  };
}

export function ImmersiveChatOverlay({
  sceneId,
  narrativeText,
  historicalContext,
  keyFormulas,
  sceneTitle,
  sceneImageUrl,
  teacherAgentId,
  teacherName,
  teacherAvatar,
}: ImmersiveChatOverlayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ImmersiveChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [discussionAgentIds, setDiscussionAgentIds] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stage = useStageStore((state) => state.stage);
  const scenes = useStageStore((state) => state.scenes);
  const currentSceneId = useStageStore((state) => state.currentSceneId);
  const mode = useStageStore((state) => state.mode);

  const teacherDisplayName = teacherName || 'AI Teacher';
  const teacherDisplayAvatar = teacherAvatar || null;
  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isExpanded]);

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsExpanded(false);
    setInputValue('');
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    setUnreadCount(0);
    setDiscussionAgentIds([]);
  }, [sceneId]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const startDiscussion = async () => {
    if (isStreaming || !teacherAgentId) return;

    setError(null);
    setIsExpanded(true);

    // Randomly select a student to trigger the discussion
    const randomStudentId = STUDENT_NPC_IDS[Math.floor(Math.random() * STUDENT_NPC_IDS.length)];

    const agentIds = [teacherAgentId, ...STUDENT_NPC_IDS];

    // Initial placeholder message for the discussion
    const placeholderMessage: ImmersiveChatMessage = {
      role: 'assistant',
      content: '',
      agentId: teacherAgentId,
      agentName: teacherDisplayName,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, placeholderMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const { apiKey, baseUrl, providerType } = getModelRequestConfig();
    const userProfile = useUserProfileStore.getState();

    const requestBody: StatelessChatRequest = {
      messages: toUiMessages([...messages, placeholderMessage]),
      storeState: {
        stage,
        scenes,
        currentSceneId,
        mode,
        whiteboardOpen: useCanvasStore.getState().whiteboardOpen,
      },
      config: {
        agentIds,
        sessionType: 'discussion',
        triggerAgentId: randomStudentId,
        discussionTopic: 'React to the current scene and share your thoughts',
        immersiveContext: {
          sceneId,
          sceneTitle,
          narrativeText,
          historicalContext,
          keyFormulas,
          sceneImageUrl,
        },
      },
      userProfile: {
        nickname: userProfile.nickname || undefined,
        bio: userProfile.bio || undefined,
      },
      apiKey,
      baseUrl: baseUrl || undefined,
      model: IMMERSIVE_MODEL,
      providerType,
    };

    setDiscussionAgentIds(agentIds);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-model': IMMERSIVE_MODEL,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const rawEvent of events) {
          const line = rawEvent
            .split('\n')
            .find((entry) => entry.startsWith('data: '));

          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as StatelessEvent;

          if (event.type === 'text_delta') {
            setMessages((prev) => {
              const updated = [...prev];
              const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
              if (targetIndex === -1) return prev;

              updated[targetIndex] = {
                ...updated[targetIndex],
                content: `${updated[targetIndex].content}${event.data.content}`,
              };
              return updated;
            });
            continue;
          }

          if (event.type === 'agent_start') {
            setMessages((prev) => {
              const updated = [...prev];
              const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
              if (targetIndex === -1) return prev;

              updated[targetIndex] = {
                ...updated[targetIndex],
                agentId: event.data.agentId,
                agentName: event.data.agentName || teacherDisplayName,
              };
              return updated;
            });
            continue;
          }

          if (event.type === 'error') {
            streamError = event.data.message;
            break;
          }
        }

        if (streamError) {
          throw new Error(streamError);
        }
      }
    } catch (streamError) {
      if (streamError instanceof DOMException && streamError.name === 'AbortError') {
        return;
      }

      setError(streamError instanceof Error ? streamError.message : 'Failed to get response');
      setMessages((prev) => {
        const updated = [...prev];
        const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
        if (targetIndex === -1) return prev;

        if (!updated[targetIndex].content.trim()) {
          updated[targetIndex] = {
            ...updated[targetIndex],
            content: 'I hit a temporary issue just now. Ask again and I will continue from this scene.',
          };
        }
        return updated;
      });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  const sendMessage = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming || !teacherAgentId) return;

    setError(null);
    setIsExpanded(true);

    const userMessage: ImmersiveChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    const assistantMessage: ImmersiveChatMessage = {
      role: 'assistant',
      content: '',
      agentId: teacherAgentId,
      agentName: teacherDisplayName,
      timestamp: Date.now() + 1,
    };

    const nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages);
    setInputValue('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const { apiKey, baseUrl, providerType } = getModelRequestConfig();
    const userProfile = useUserProfileStore.getState();

    const requestBody: StatelessChatRequest = {
      messages: toUiMessages(nextMessages),
      storeState: {
        stage,
        scenes,
        currentSceneId,
        mode,
        whiteboardOpen: useCanvasStore.getState().whiteboardOpen,
      },
      config: {
        agentIds: discussionAgentIds.length > 0 ? discussionAgentIds : [teacherAgentId],
        sessionType: discussionAgentIds.length > 0 ? 'discussion' : 'qa',
        immersiveContext: {
          sceneId,
          sceneTitle,
          narrativeText,
          historicalContext,
          keyFormulas,
          sceneImageUrl,
        },
      },
      userProfile: {
        nickname: userProfile.nickname || undefined,
        bio: userProfile.bio || undefined,
      },
      apiKey,
      baseUrl: baseUrl || undefined,
      model: IMMERSIVE_MODEL,
      providerType,
    };

    setDiscussionAgentIds([]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-model': IMMERSIVE_MODEL,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const events = sseBuffer.split('\n\n');
        sseBuffer = events.pop() || '';

        for (const rawEvent of events) {
          const line = rawEvent
            .split('\n')
            .find((entry) => entry.startsWith('data: '));

          if (!line) continue;

          const event = JSON.parse(line.slice(6)) as StatelessEvent;

          if (event.type === 'text_delta') {
            setMessages((prev) => {
              const updated = [...prev];
              const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
              if (targetIndex === -1) return prev;

              updated[targetIndex] = {
                ...updated[targetIndex],
                content: `${updated[targetIndex].content}${event.data.content}`,
              };
              return updated;
            });
            continue;
          }

          if (event.type === 'agent_start') {
            setMessages((prev) => {
              const updated = [...prev];
              const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
              if (targetIndex === -1) return prev;

              updated[targetIndex] = {
                ...updated[targetIndex],
                agentId: event.data.agentId,
                agentName: event.data.agentName || teacherDisplayName,
              };
              return updated;
            });
            continue;
          }

          if (event.type === 'error') {
            streamError = event.data.message;
            break;
          }
        }

        if (streamError) {
          throw new Error(streamError);
        }
      }
    } catch (streamError) {
      if (streamError instanceof DOMException && streamError.name === 'AbortError') {
        return;
      }

      setError(streamError instanceof Error ? streamError.message : 'Failed to get response');
      setMessages((prev) => {
        const updated = [...prev];
        const targetIndex = updated.findLastIndex((message) => message.role === 'assistant');
        if (targetIndex === -1) return prev;

        if (!updated[targetIndex].content.trim()) {
          updated[targetIndex] = {
            ...updated[targetIndex],
            content: 'I hit a temporary issue just now. Ask again and I will continue from this scene.',
          };
        }
        return updated;
      });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) setUnreadCount(0);
      return next;
    });
  };

  useEffect(() => {
    if (isExpanded) {
      setUnreadCount(0);
      return;
    }

    if (lastAssistantMessage?.content) {
      setUnreadCount((count) => count + 1);
    }
  }, [isExpanded, lastAssistantMessage?.content]);

  return (
    <div className="pointer-events-none absolute bottom-24 right-3 z-20 sm:bottom-28 sm:right-4">
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn(
                'w-[min(calc(100vw-1.5rem),400px)] max-h-[60vh] overflow-hidden rounded-3xl',
                'border border-white/12 bg-slate-950/72 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl',
              )}
            >
              <div className="border-b border-white/10 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                      <Sparkles className="size-3.5" />
                      Scene Chat
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">
                      {sceneTitle || 'Immersive scene'}
                    </p>
                    <p className="mt-1 text-xs text-white/55">
                      Ask {teacherDisplayName} about what is on screen right now.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleExpanded}
                    className="rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="flex max-h-[calc(60vh-8.75rem)] flex-col overflow-hidden">
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/60">
                      Ask for clarification, historical context, or how the formula connects to the scene.
                    </div>
                  ) : (
                    messages.map((message) => {
                      const isAssistant = message.role === 'assistant';
                      const isStudentNPC = isAssistant && message.agentId && STUDENT_NPC_IDS.includes(message.agentId);
                      const studentColor = isStudentNPC ? STUDENT_COLORS[message.agentId || '#22d3ee'] : undefined;
                      return (
                        <div
                          key={`${message.timestamp}-${message.role}-${message.content.length}`}
                          className={cn(
                            'flex gap-3',
                            isAssistant ? 'items-start justify-start' : 'justify-end',
                          )}
                        >
                          {isAssistant && (
                            <div
                              className={cn(
                                'mt-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10',
                                isStudentNPC ? `bg-white/8 text-white/90` : 'bg-white/8 text-white/90',
                              )}
                              style={isStudentNPC ? { borderColor: studentColor } : undefined}
                            >
                              {isStudentNPC && message.agentName ? (
                                <span className="text-xs font-medium">{message.agentName.split(' ')[0][0]}</span>
                              ) : teacherDisplayAvatar ? (
                                <img
                                  src={teacherDisplayAvatar}
                                  alt={message.agentName || teacherDisplayName}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <Bot className="size-4" />
                              )}
                            </div>
                          )}

                          <div
                            className={cn(
                              'max-w-[80%] rounded-2xl px-3.5 py-3 text-sm leading-6',
                              isStudentNPC
                                ? 'rounded-tl-md border border-white/10 text-white/92'
                                : isAssistant
                                  ? 'rounded-tl-md border border-white/10 bg-white/8 text-white/92'
                                  : 'rounded-tr-md bg-cyan-400/18 text-cyan-50 ring-1 ring-cyan-200/14',
                            )}
                            style={isStudentNPC ? { backgroundColor: `${studentColor}1a` } : undefined}
                          >
                            {isAssistant && (
                              <p
                                className={cn(
                                  'mb-1 text-[11px] font-medium uppercase tracking-[0.2em]',
                                  isStudentNPC ? 'text-white/70' : 'text-cyan-100/58',
                                )}
                              >
                                {message.agentName || teacherDisplayName}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">
                              {message.content || (isStreaming && isAssistant ? '...' : '')}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="border-t border-white/10 bg-black/10 px-4 py-3">
                  {error && <p className="mb-2 text-xs text-rose-300/90">{error}</p>}
                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => void startDiscussion()}
                      disabled={isStreaming || !teacherAgentId}
                      className="mb-0.5 shrink-0 rounded-full bg-orange-300/80 text-slate-950 hover:bg-orange-200"
                      title="Ask classmates for their thoughts"
                    >
                      <Users className="size-4" />
                    </Button>
                    <Textarea
                      value={inputValue}
                      onChange={(event) => setInputValue(event.target.value)}
                      onKeyDown={handleTextareaKeyDown}
                      placeholder="Ask about this scene..."
                      rows={1}
                      disabled={isStreaming}
                      className={cn(
                        'min-h-[44px] resize-none rounded-2xl border-white/10 bg-white/6 px-3 py-2.5 text-sm text-white',
                        'placeholder:text-white/35 focus-visible:border-cyan-200/30 focus-visible:ring-cyan-200/20',
                      )}
                    />
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => void sendMessage()}
                      disabled={!inputValue.trim() || isStreaming || !teacherAgentId}
                      className="mb-0.5 shrink-0 rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                    >
                      {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0, y: 18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex flex-col items-end gap-2"
            >
              {lastAssistantMessage?.content && (
                <button
                  type="button"
                  onClick={toggleExpanded}
                  className={cn(
                    'max-w-[280px] rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-xs text-white/72 backdrop-blur-xl',
                    'shadow-[0_14px_40px_rgba(0,0,0,0.3)]',
                  )}
                >
                  <p className="mb-1 text-[10px] uppercase tracking-[0.24em] text-cyan-200/55">
                    Latest reply
                  </p>
                  <p className="line-clamp-2">{lastAssistantMessage.content}</p>
                </button>
              )}

              <Button
                type="button"
                onClick={toggleExpanded}
                className={cn(
                  'relative h-14 rounded-full border border-white/12 bg-slate-950/74 px-4 text-white backdrop-blur-xl',
                  'shadow-[0_18px_44px_rgba(0,0,0,0.42)] hover:bg-slate-900/86',
                )}
              >
                <MessageCircle className="mr-2 size-4" />
                Ask the teacher
                {isStreaming && <Loader2 className="ml-2 size-4 animate-spin text-cyan-200" />}
                {!isStreaming && unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-cyan-300 text-[10px] font-bold text-slate-950">
                    {Math.min(unreadCount, 9)}
                  </span>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
