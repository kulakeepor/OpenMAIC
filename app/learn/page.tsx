'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, Compass, Play, Sparkles } from 'lucide-react';
import knowledgeGraph from '@/data/fluids-knowledge-graph.json';
import { Button } from '@/components/ui/button';
import { getOrCreateStudentId, getStudentProgress } from '@/lib/adaptive/student-model';
import { getLearningMapNodes } from '@/lib/adaptive/path-engine';
import type { KnowledgeNode, StudentMastery } from '@/lib/types/adaptive';
import type { StudentProgress } from '@/lib/adaptive/student-model';

const nodes = knowledgeGraph as KnowledgeNode[];
const nodeIds = nodes.map((node) => node.id);
const DIAGNOSTIC_KEY_PREFIX = 'adaptive_diagnostic_completed:';

const emptyProgress: StudentProgress = {
  studentId: '',
  totalNodes: nodes.length,
  masteredNodes: 0,
  inProgressNodes: 0,
  notStartedNodes: nodes.length,
  overallProgress: 0,
  weakNodes: [],
};

function masteryPercent(value: number) {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

function masteryLabel(value: number) {
  if (value >= 0.8) return '已掌握';
  if (value > 0) return '学习中';
  return '未开始';
}

function pickRecommendedNode(masteryByNode: Record<string, number>) {
  const readyNode = nodes.find((node) => {
    const mastery = masteryByNode[node.id] ?? 0;
    if (mastery >= 0.8) return false;
    return node.prerequisites.every((id) => (masteryByNode[id] ?? 0) >= 0.8);
  });

  return readyNode ?? nodes.find((node) => (masteryByNode[node.id] ?? 0) < 0.8) ?? nodes[0];
}

export default function LearnPage() {
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<StudentProgress>(emptyProgress);
  const [masteryByNode, setMasteryByNode] = useState<Record<string, number>>({});
  const [hasDiagnosticRecord, setHasDiagnosticRecord] = useState(false);
  const [progressUnavailable, setProgressUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStudentProgress() {
      const id = getOrCreateStudentId();
      setStudentId(id);
      if (!id) {
        setLoading(false);
        return;
      }

      const diagnosticComplete = localStorage.getItem(`${DIAGNOSTIC_KEY_PREFIX}${id}`) === 'true';

      try {
        const res = await fetch(`/api/adaptive/mastery?studentId=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`mastery fetch failed: ${res.status}`);

        const rows = (await res.json()) as StudentMastery[];
        const nextMastery = rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.node_id] = Number(row.mastery_level) || 0;
          return acc;
        }, {});

        const nextProgress = getStudentProgress(id, nodeIds, nextMastery);

        if (!cancelled) {
          setMasteryByNode(nextMastery);
          setProgress(nextProgress);
          setHasDiagnosticRecord(diagnosticComplete || rows.length > 0);
        }
      } catch {
        if (!cancelled) {
          setMasteryByNode({});
          setProgress({ ...emptyProgress, studentId: id });
          setHasDiagnosticRecord(diagnosticComplete);
          setProgressUnavailable(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStudentProgress();

    // Re-fetch when user switches back to this tab (e.g. after completing a quiz)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        cancelled = false;
        void loadStudentProgress();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const recommendedNode = useMemo(() => pickRecommendedNode(masteryByNode), [masteryByNode]);
  const learningMapNodes = useMemo(() => getLearningMapNodes(nodes, masteryByNode), [masteryByNode]);
  const overallPercent = masteryPercent(progress.overallProgress);

  if (loading) {
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-6xl items-center px-5">
        <div className="text-sm font-medium text-slate-500">Loading adaptive plan...</div>
      </section>
    );
  }

  if (!hasDiagnosticRecord) {
    return (
      <section className="mx-auto grid min-h-[75vh] max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800">
            <Compass className="size-4" />
            Adaptive start point
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            先做一次简短诊断，再开始你的 Fluids 学习路径。
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
            系统会根据你的回答估计 53 个知识点的初始掌握度，并推荐最合适的第一个学习节点。
          </p>
          <Button asChild size="lg" className="mt-8 bg-slate-950 text-white hover:bg-slate-800">
            <Link href="/learn/diagnostic">
              <Play className="size-4" />
              开始诊断
            </Link>
          </Button>
        </div>

        <div className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-950">诊断后会生成</h2>
              <p className="text-sm text-slate-500">个人化学习入口</p>
            </div>
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="rounded-md bg-slate-50 p-3">知识点掌握度进度</div>
            <div className="rounded-md bg-slate-50 p-3">推荐下一个学习节点</div>
            <div className="rounded-md bg-slate-50 p-3">按先修关系排列的学习列表</div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-5 py-8">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="rounded-lg border border-slate-900/10 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">
                Knowledge graph progress
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Fluids 学习进度</h1>
            </div>
            <div className="text-sm text-slate-500">
              Student ID: <span className="font-mono text-slate-700">{studentId}</span>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-emerald-50 p-4">
              <div className="text-2xl font-semibold text-emerald-800">{progress.masteredNodes}</div>
              <div className="text-sm text-emerald-900/70">已掌握</div>
            </div>
            <div className="rounded-md bg-amber-50 p-4">
              <div className="text-2xl font-semibold text-amber-800">{progress.inProgressNodes}</div>
              <div className="text-sm text-amber-900/70">学习中</div>
            </div>
            <div className="rounded-md bg-slate-50 p-4">
              <div className="text-2xl font-semibold text-slate-800">{overallPercent}%</div>
              <div className="text-sm text-slate-500">整体完成度</div>
            </div>
          </div>

          {progressUnavailable ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              数据库进度读取失败，当前显示空进度。
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-sky-200 bg-sky-50 p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-sky-800">
            <Compass className="size-4" />
            Next node
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
            {recommendedNode.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{recommendedNode.name_zh}</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <Clock className="size-4 text-sky-700" />
            {recommendedNode.estimated_minutes} min · Difficulty {recommendedNode.difficulty}/5
          </div>
          <Button asChild className="mt-6 w-full bg-sky-700 text-white hover:bg-sky-800">
            <Link href={`/learn/${recommendedNode.id}`}>
              开始学习
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </aside>
      </div>

      <div className="mt-6 rounded-lg border border-slate-900/10 bg-white shadow-sm">
        <div className="border-b border-slate-900/10 px-6 py-4">
          <h2 className="text-lg font-semibold">知识节点</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {learningMapNodes.map((node) => {
            const percent = masteryPercent(node.mastery);
            const isRecommended = node.id === recommendedNode.id;
            const isLocked = node.status === 'locked';

            const statusBadge = {
              mastered: <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">已掌握</span>,
              in_progress: <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">学习中</span>,
              available: null,
              locked: <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">🔒 需先修</span>,
            }[node.status];

            return (
              <Link
                key={node.id}
                href={isLocked ? '#' : `/learn/${node.id}`}
                onClick={isLocked ? (e) => e.preventDefault() : undefined}
                className={`block px-6 py-4 transition ${
                  isLocked ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'
                } ${isRecommended ? 'bg-sky-50/70' : ''}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-950">{node.name}</h3>
                      <span className="text-sm text-slate-500">{node.name_zh}</span>
                      {isRecommended && !isLocked ? (
                        <span className="rounded-full bg-sky-700 px-2 py-0.5 text-xs font-medium text-white">推荐</span>
                      ) : null}
                      {node.status === 'mastered' ? <CheckCircle2 className="size-4 text-emerald-600" /> : null}
                      {statusBadge}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{node.topic}</p>
                  </div>

                  <div className="w-full sm:w-56">
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>{masteryLabel(node.mastery)}</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${
                          percent >= 80 ? 'bg-emerald-600' : percent > 0 ? 'bg-amber-500' : 'bg-slate-300'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
