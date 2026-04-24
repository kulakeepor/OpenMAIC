'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getOrCreateStudentId } from '@/lib/adaptive/student-model';
import { cn } from '@/lib/utils';
import type { QuizQuestion } from '@/lib/adaptive/quiz-prompts';

interface QuizViewProps {
  nodeId: string;
  masteryLevel?: number;
  onComplete: (score: number, total: number) => void;
  onRetry?: () => void;
  onSubmitted?: () => void;
  justMastered?: boolean;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

function getOptionLetter(option: string, index: number) {
  const match = option.trim().match(/^([A-D])[\).:\s-]/i);
  return (match?.[1]?.toUpperCase() || OPTION_LETTERS[index] || 'A') as string;
}

function cleanOptionText(option: string) {
  return option.replace(/^[A-D][\).:\s-]+/i, '').trim();
}

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function QuizView({ nodeId, masteryLevel = 0.5, onComplete, onRetry, onSubmitted, justMastered }: QuizViewProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setLoading(true);
      setError(null);
      setQuestions([]);
      setCurrentIndex(0);
      setSelectedAnswers({});

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);
        const response = await fetch('/api/adaptive/quiz/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId, count: 3, masteryLevel }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          throw new Error(`Quiz generate failed: ${response.status}`);
        }

        const data = (await response.json()) as { questions?: QuizQuestion[] };
        if (!data.questions?.length) {
          throw new Error('No quiz questions returned');
        }

        if (!cancelled) setQuestions(data.questions);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error && err.name === 'AbortError'
            ? 'AI 响应超时（>45s），请点击重试'
            : err instanceof Error ? err.message : '题目生成失败，请稍后重试。';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadQuestions();

    return () => {
      cancelled = true;
    };
  }, [masteryLevel, nodeId]);

  const currentQuestion = questions[currentIndex];
  const selectedAnswer = selectedAnswers[currentIndex];
  const isAnswered = Boolean(selectedAnswer);

  const correctCount = useMemo(
    () =>
      questions.reduce((count, question, index) => {
        return selectedAnswers[index] === question.correct ? count + 1 : count;
      }, 0),
    [questions, selectedAnswers],
  );

  const isFinished = questions.length > 0 && currentIndex >= questions.length;
  const answeredCount = currentIndex;
  const accuracyPercent = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
  const circleRadius = 28;
  const circleStrokeWidth = 5;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const progressOffset = circleCircumference - (accuracyPercent / 100) * circleCircumference;

  const selectAnswer = useCallback(
    (letter: string) => {
      if (isAnswered) return;
      setSelectedAnswers((prev) => ({
        ...prev,
        [currentIndex]: letter,
      }));
    },
    [currentIndex, isAnswered],
  );

  const submitQuiz = useCallback(async () => {
    if (submitting) return;

    const studentId = getOrCreateStudentId();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/adaptive/quiz/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': studentId || 'anonymous',
        },
        body: JSON.stringify({
          nodeId,
          correctCount,
          totalCount: questions.length,
        }),
      });

      if (!response.ok) {
        throw new Error(`Quiz submit failed: ${response.status}`);
      }

      onComplete(correctCount, questions.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '成绩提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }, [correctCount, nodeId, onComplete, questions.length, submitting]);

  // Auto-submit when quiz is finished — submit scores but do NOT call onComplete
  // (onComplete navigates away; we want to stay on the result screen)
  const autoSubmit = useCallback(async () => {
    if (submitting) return;
    const studentId = getOrCreateStudentId();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/adaptive/quiz/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': studentId || 'anonymous',
        },
        body: JSON.stringify({ nodeId, correctCount, totalCount: questions.length }),
      });
      if (!response.ok) throw new Error(`Quiz submit failed: ${response.status}`);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '成绩提交失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }, [correctCount, nodeId, onSubmitted, questions.length, submitting]);

  useEffect(() => {
    if (isFinished && !submitted && !submitting) {
      void autoSubmit();
      setSubmitted(true);
    }
  }, [isFinished, submitted, submitting, autoSubmit]);

  if (loading) {
    return (
      <Card className="w-full gap-0 border-slate-200 bg-slate-50 p-6">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
          <Loader2 className="size-4 animate-spin text-sky-700" />
          正在生成 3 道小测题...
        </div>
      </Card>
    );
  }

  if (error && questions.length === 0) {
    return (
      <Card className="w-full gap-4 border-red-200 bg-red-50 p-6">
        <div>
          <h3 className="font-semibold text-red-900">Quiz 加载失败</h3>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RotateCcw className="size-4" />
          重试
        </Button>
      </Card>
    );
  }

  if (isFinished) {
    const masteryPct = Math.round((masteryLevel ?? 0) * 100);
    return (
      <div className="relative w-full overflow-hidden">
        {justMastered && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className="confetti-piece absolute top-0 block h-3 w-2 rounded-sm opacity-0"
                style={{
                  left: `${(i / 18) * 100}%`,
                  backgroundColor: ['#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6'][i % 5],
                  animationDelay: `${(i * 0.07).toFixed(2)}s`,
                  animation: 'confettiFall 1.8s ease-in forwards',
                }}
              />
            ))}
            <style>{`
              @keyframes confettiFall {
                0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
                100% { transform: translateY(400px) rotate(360deg); opacity: 0; }
              }
            `}</style>
          </div>
        )}
        <Card className="w-full gap-0 border-emerald-200 bg-emerald-50 p-6">
          {justMastered && (
            <div className="mb-4 text-center">
              <p className="text-3xl">🎉</p>
              <h2 className="mt-1 text-xl font-bold text-emerald-800">已掌握！</h2>
            </div>
          )}
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-emerald-800">
                Quiz complete
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                {correctCount} / {questions.length} 正确
              </h3>
              {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            </div>

            <div>
              <div className="mb-1 flex justify-between text-sm text-slate-600">
                <span>节点掌握度</span>
                <span className="font-semibold text-emerald-700">{masteryPct}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                  style={{ width: `${masteryPct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">达到 80% 即为掌握</p>
            </div>

            <div className="flex gap-3">
              {onRetry && (
                <Button
                  variant="outline"
                  onClick={onRetry}
                  className="flex-1 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                >
                  <RotateCcw className="size-4" />
                  继续挑战
                </Button>
              )}
              <Button
                onClick={() => onComplete(correctCount, questions.length)}
                disabled={submitting}
                className="flex-1 bg-emerald-700 text-white hover:bg-emerald-800"
              >
                <ChevronRight className="size-4" />
                下一节
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!currentQuestion) return null;

  return (
    <>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
      <div className="flex items-start gap-6 rounded-2xl bg-slate-50/80 p-6">
        <div className="flex-1">
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
              <span>
                Question {currentIndex + 1} / {questions.length}
              </span>
              <span>{isAnswered ? '已作答' : '请选择一个答案'}</span>
            </div>
            <h3 className="mt-4 text-lg font-semibold leading-7 text-slate-950">
              {currentQuestion.question}
            </h3>

            <div className="mt-6 space-y-3">
              {currentQuestion.options.slice(0, 4).map((option, index) => {
                const letter = getOptionLetter(option, index);
                const isCorrect = letter === currentQuestion.correct;
                const isSelected = selectedAnswer === letter;
                const isCorrectSelection = isAnswered && isSelected && isCorrect;
                const isRevealCorrectAnswer = isAnswered && !isSelected && isCorrect;

                return (
                  <button
                    key={`${letter}-${option}`}
                    type="button"
                    disabled={isAnswered}
                    onClick={() => selectAnswer(letter)}
                    className={cn(
                      'flex w-full items-start gap-4 rounded-xl border border-slate-200 p-4 text-left text-sm text-slate-900 transition-all duration-300',
                      !isAnswered && 'cursor-pointer hover:border-slate-400 hover:bg-slate-50',
                      !isAnswered && isSelected && 'border-slate-900 bg-slate-900 text-white',
                      isCorrectSelection && 'border-emerald-500 bg-emerald-50 text-emerald-800',
                      isAnswered && isSelected && !isCorrect && 'border-red-400 bg-red-50 text-red-800 [animation:shake_0.4s_ease-in-out]',
                      isRevealCorrectAnswer && 'border-emerald-400 bg-emerald-50 text-emerald-800',
                      isAnswered && !isSelected && !isCorrect && 'border-slate-200 bg-white text-slate-600',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300',
                        !isAnswered && isSelected
                          ? 'bg-slate-950 text-white'
                          : isCorrectSelection || isRevealCorrectAnswer
                            ? 'bg-emerald-500 text-white'
                            : isAnswered && isSelected
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {isAnswered && isCorrect ? (
                        <Check className="size-4" />
                      ) : isAnswered && isSelected ? (
                        <X className="size-4" />
                      ) : (
                        letter
                      )}
                    </span>
                    <span className="leading-6">{cleanOptionText(option)}</span>
                  </button>
                );
              })}

              {isAnswered ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
                  <span className="font-semibold">Explanation: </span>
                  {currentQuestion.explanation}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="sticky top-6 w-52 rounded-2xl border border-slate-200 bg-white/88 p-5 text-slate-900 shadow-sm backdrop-blur-sm">
          <div>
            <p className="text-xs tracking-widest text-slate-400">PROGRESS</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {currentIndex + 1} / {questions.length}
            </p>
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="text-xs tracking-widest text-slate-400">TIME</p>
            <p className="mt-2 font-mono text-2xl text-slate-800">{formatElapsedTime(elapsedSeconds)}</p>
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="text-xs tracking-widest text-slate-400">SCORE</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">{correctCount}</p>
            {currentIndex > 0 ? <p className="mt-1 text-sm text-slate-500">/ {currentIndex} correct</p> : null}
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="flex justify-center">
              <div className="relative flex size-24 items-center justify-center">
                <svg className="-rotate-90" width="66" height="66" viewBox="0 0 66 66" aria-hidden="true">
                  <circle
                    cx="33"
                    cy="33"
                    r={circleRadius}
                    fill="none"
                    stroke="rgb(226 232 240)"
                    strokeWidth={circleStrokeWidth}
                  />
                  <circle
                    cx="33"
                    cy="33"
                    r={circleRadius}
                    fill="none"
                    stroke="rgb(16 185 129)"
                    strokeWidth={circleStrokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={progressOffset}
                    className="transition-all duration-300"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-slate-700">
                  {accuracyPercent}%
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!isAnswered}
          onClick={() => setCurrentIndex((index) => index + 1)}
          className="bg-slate-950 text-white hover:bg-slate-800"
        >
          {currentIndex === questions.length - 1 ? '查看成绩' : '下一题'}
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </>
  );
}
