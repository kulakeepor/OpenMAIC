'use client';

import { useRouter } from 'next/navigation';
import { DiagnosticChat } from '@/components/adaptive/diagnostic-chat';
import type { DiagnosticResult } from '@/lib/types/adaptive';

export default function DiagnosticPage() {
  const router = useRouter();

  const handleComplete = (_result: DiagnosticResult) => {
    router.push('/learn');
  };

  return (
    <section className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-5">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
          Diagnostic interview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Fluids 诊断</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          用一段简短对话校准你的 AP Physics 2 Fluids 起点。
        </p>
      </div>
      <DiagnosticChat onComplete={handleComplete} />
    </section>
  );
}
