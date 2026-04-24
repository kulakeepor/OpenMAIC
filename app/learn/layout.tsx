'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Waves } from 'lucide-react';
import knowledgeGraph from '@/data/fluids-knowledge-graph.json';
import { getOrCreateStudentId, getStudentProgress } from '@/lib/adaptive/student-model';
import type { KnowledgeNode, StudentMastery } from '@/lib/types/adaptive';
import type { StudentProgress } from '@/lib/adaptive/student-model';

const nodes = knowledgeGraph as KnowledgeNode[];

const emptyProgress: StudentProgress = {
  studentId: '',
  totalNodes: nodes.length,
  masteredNodes: 0,
  inProgressNodes: 0,
  notStartedNodes: nodes.length,
  overallProgress: 0,
  weakNodes: [],
};

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<StudentProgress>(emptyProgress);

  const percent = useMemo(
    () => Math.round((progress.overallProgress || 0) * 100),
    [progress.overallProgress],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      const studentId = getOrCreateStudentId();
      if (!studentId) return;

      try {
        const res = await fetch(`/api/adaptive/mastery?studentId=${encodeURIComponent(studentId)}`);
        if (!res.ok) throw new Error(`mastery fetch failed: ${res.status}`);

        const rows = (await res.json()) as StudentMastery[];
        const masteryByNode = rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.node_id] = Number(row.mastery_level) || 0;
          return acc;
        }, {});

        const nextProgress = getStudentProgress(
          studentId,
          nodes.map((node) => node.id),
          masteryByNode,
        );
        if (!cancelled) setProgress(nextProgress);
      } catch {
        if (!cancelled) setProgress({ ...emptyProgress, studentId });
      }
    }

    loadProgress();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f3ea] text-slate-950">
      <header className="border-b border-slate-900/10 bg-[#fffaf0]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/learn" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm">
              <Waves className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
                AP Physics 2
              </span>
              <span className="block text-xl font-semibold tracking-tight">Fluids</span>
            </span>
          </Link>

          <div className="w-full sm:max-w-xs">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <BookOpen className="size-4 text-emerald-700" />
                学生进度
              </span>
              <span className="font-semibold text-slate-950">{percent}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 text-right text-xs text-slate-500">
              {progress.masteredNodes}/{progress.totalNodes} nodes mastered
            </div>
          </div>
        </div>
      </header>

      {children}
    </main>
  );
}
