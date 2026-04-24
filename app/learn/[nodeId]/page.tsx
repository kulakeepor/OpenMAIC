'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { MathText } from '@/components/adaptive/math-text';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock, ListChecks, MessageSquare, Star } from 'lucide-react';
import knowledgeGraph from '@/data/fluids-knowledge-graph.json';
import { QuizView } from '@/components/adaptive/quiz-view';
import { PracticeChat } from '@/components/adaptive/practice-chat';
import { Button } from '@/components/ui/button';
import { getNextRecommendedNode } from '@/lib/adaptive/path-engine';
import { getOrCreateStudentId } from '@/lib/adaptive/student-model';
import type { KnowledgeNode, StudentMastery } from '@/lib/types/adaptive';

type Phase = 'learn' | 'practice' | 'test';

const nodes = knowledgeGraph as KnowledgeNode[];

type AdaptiveQuizViewProps = {
  nodeId: string;
  masteryLevel?: number;
  onComplete: (score: number, total: number) => void;
  onRetry: () => void;
  onSubmitted?: () => void;
  justMastered: boolean;
};

const AdaptiveQuizView = QuizView as unknown as ComponentType<AdaptiveQuizViewProps>;

function DifficultyStars({ difficulty }: { difficulty: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`Difficulty ${difficulty} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={`size-4 ${
            index < difficulty ? 'fill-amber-400 text-amber-500' : 'text-slate-300'
          }`}
        />
      ))}
    </span>
  );
}

export default function NodeLearningPage() {
  const params = useParams<{ nodeId: string }>();
  const nodeId = params.nodeId;
  const node = nodes.find((item) => item.id === nodeId);
  const [phase, setPhase] = useState<Phase>('learn');
  const [quizKey, setQuizKey] = useState(0);
  const [quizScore, setQuizScore] = useState<{ score: number; total: number } | null>(null);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [practiceMastery, setPracticeMastery] = useState<number | null>(null);
  const [justMastered, setJustMastered] = useState(false);
  const [masteryByNode, setMasteryByNode] = useState<Record<string, number>>({});
  const prevMasteryRef = useRef<number>(masteryByNode[nodeId] ?? 0);
  const nextNode = getNextRecommendedNode(nodeId, nodes, masteryByNode);

  const loadMastery = useCallback(async (): Promise<Record<string, number> | null> => {
    const studentId = getOrCreateStudentId();
    if (!studentId) return null;

    const res = await fetch(`/api/adaptive/mastery?studentId=${encodeURIComponent(studentId)}`);
    if (!res.ok) throw new Error(`mastery fetch failed: ${res.status}`);

    const rows = (await res.json()) as StudentMastery[];
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.node_id] = Number(row.mastery_level) || 0;
      return acc;
    }, {});
  }, []);

  const handleQuizRetry = useCallback(() => {
    setJustMastered(false);
    setQuizKey((k) => k + 1);
  }, []);

  // Called after auto-submit — refresh mastery so the QuizView progress bar updates
  const handleQuizSubmitted = useCallback(async () => {
    try {
      const nextMastery = await loadMastery();
      if (nextMastery) {
        const nextMasteryLevel = nextMastery[nodeId] ?? 0;
        const justMasteredNow = prevMasteryRef.current < 0.8 && nextMasteryLevel >= 0.8;
        prevMasteryRef.current = nextMasteryLevel;
        setMasteryByNode(nextMastery);
        setJustMastered(justMasteredNow);
      }
    } catch { /* ignore */ }
  }, [loadMastery, nodeId]);

  // Called when user clicks "下一节"
  const handleQuizComplete = useCallback(
    async (_score: number, _total: number) => {
      try {
        const nextMastery = await loadMastery();
        if (nextMastery) {
          const nextMasteryLevel = nextMastery[nodeId] ?? 0;
          const justMasteredNow = prevMasteryRef.current < 0.8 && nextMasteryLevel >= 0.8;
          prevMasteryRef.current = nextMasteryLevel;
          setMasteryByNode(nextMastery);
          setJustMastered(justMasteredNow);
        }
      } catch { /* ignore */ }
    },
    [loadMastery, nodeId],
  );

  useEffect(() => {
    let cancelled = false;

    async function syncMastery() {
      try {
        const nextMastery = await loadMastery();
        if (!nextMastery) return;
        if (!cancelled) setMasteryByNode(nextMastery);
      } catch {
        if (!cancelled) setMasteryByNode({});
      }
    }

    void syncMastery();

    return () => {
      cancelled = true;
    };
  }, [loadMastery]);

  useEffect(() => {
    prevMasteryRef.current = masteryByNode[nodeId] ?? 0;
  }, [masteryByNode, nodeId]);

  if (!node) {
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-4xl items-center px-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">未找到知识点</h1>
          <Button asChild className="mt-6">
            <Link href="/learn">返回学习主页</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <article className="mx-auto max-w-4xl px-5 py-8">
      <Button asChild variant="ghost" className="mb-5 text-slate-600">
        <Link href="/learn">
          <ArrowLeft className="size-4" />
          返回知识图谱
        </Link>
      </Button>

      <header className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
              {node.topic}
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
              {node.name}
            </h1>
            <p className="mt-2 text-lg text-slate-500">{node.name_zh}</p>
          </div>

          <div className="rounded-lg bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-6 text-sm">
              <span className="text-slate-500">难度</span>
              <DifficultyStars difficulty={node.difficulty} />
            </div>
            <div className="flex items-center justify-between gap-6 text-sm">
              <span className="text-slate-500">预计时长</span>
              <span className="flex items-center gap-1 font-medium text-slate-900">
                <Clock className="size-4 text-emerald-700" />
                {node.estimated_minutes} min
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 三阶段 Tab 导航 */}
      <div className="mt-6 flex gap-1 rounded-xl border border-slate-900/10 bg-white p-1.5 shadow-sm">
        {([
          { id: 'learn' as const, label: '① 学习', icon: BookOpen },
          { id: 'practice' as const, label: '② 练习', icon: MessageSquare },
          { id: 'test' as const, label: '③ 测试', icon: ListChecks },
        ]).map(({ id, label, icon: Icon }) => {
          const isActive = phase === id;
          const isDone = id === 'test' && !!quizScore;
          const activeColor = id === 'learn' ? 'bg-sky-50 text-sky-800' : id === 'practice' ? 'bg-violet-50 text-violet-800' : 'bg-emerald-50 text-emerald-800';
          return (
            <button
              key={id}
              onClick={() => setPhase(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${isActive ? `${activeColor} shadow-sm` : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon className="size-4" />
              {label}
              {isDone && <Check className="size-3 text-emerald-600" />}
            </button>
          );
        })}
      </div>

      {/* 学习阶段 */}
      {phase === 'learn' && (
        <div className="mt-5 space-y-5">
          <section className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Core idea</h2>
            <p className="mt-3 leading-7 text-slate-700"><MathText>{node.teaching_skeleton.core_idea}</MathText></p>
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Explain like 5</h2>
            <p className="mt-3 leading-7 text-slate-700"><MathText>{node.teaching_skeleton.explain_like_5}</MathText></p>
          </section>
          <section className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ListChecks className="size-5 text-sky-700" />
              <h2 className="text-xl font-semibold">Key examples</h2>
            </div>
            <div className="space-y-3">
              {node.teaching_skeleton.key_examples.map((example) => (
                <div key={example} className="rounded-md bg-slate-50 p-4 leading-7 text-slate-700">
                  <MathText>{example}</MathText>
                </div>
              ))}
            </div>
          </section>
          <div className="flex justify-end">
            <Button onClick={() => setPhase('practice')} className="bg-sky-700 text-white hover:bg-sky-800">
              进入练习 <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 练习阶段 — PracticeChat 接入后替换 */}
      {phase === 'practice' && (
        <div className="mt-5 rounded-lg border border-violet-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-violet-700 mb-2">
            <MessageSquare className="size-5" />
            <h2 className="text-xl font-semibold">对话练习</h2>
          </div>
          <p className="text-sm text-slate-500">AI 用对话方式帮你巩固概念——用自己的话解释，AI 追问纠正。</p>
          <div className="mt-4">
            {practiceComplete ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-700">
                ✓ 练习完成！估算掌握度：{Math.round((practiceMastery ?? 0) * 100)}%
                <div className="mt-3">
                  <Button onClick={() => setPhase('test')} className="bg-violet-700 text-white hover:bg-violet-800">
                    去测试 <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <PracticeChat
                nodeId={node.id}
                masteryLevel={masteryByNode[node.id] ?? 0}
                onComplete={(newMastery) => {
                  setPracticeMastery(newMastery);
                  setPracticeComplete(true);
                }}
              />
            )}
          </div>
          {!practiceComplete && (
            <div className="mt-3 flex justify-between">
              <Button variant="ghost" onClick={() => setPhase('learn')} className="text-slate-500">
                <ArrowLeft className="size-4" /> 返回学习
              </Button>
              <Button variant="outline" onClick={() => setPhase('test')} className="text-slate-500">
                跳过，直接测试
              </Button>
            </div>
          )}
        </div>
      )}

      {/* 测试阶段 */}
      {phase === 'test' && (
        <div className="mt-5 space-y-4">
          <AdaptiveQuizView
            key={quizKey}
            nodeId={node.id}
            masteryLevel={masteryByNode[node.id] ?? 0}
            onComplete={handleQuizComplete}
            onRetry={handleQuizRetry}
            onSubmitted={handleQuizSubmitted}
            justMastered={justMastered}
          />
          <div className="flex justify-start">
            <Button variant="ghost" onClick={() => setPhase('practice')} className="text-slate-500">
              <ArrowLeft className="size-4" /> 返回练习
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
