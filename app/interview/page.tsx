'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowLeft, ClipboardList, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InterviewChat } from '@/components/interview/interview-chat';
import type { GenerationSessionState } from '@/app/generation-preview/types';
import type { InterviewResult } from '@/lib/types/interview';
import { buildEnhancedRequirement } from '@/lib/interview/interview-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('InterviewPage');

function InterviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem('generationSession');
    if (!saved) {
      setSessionLoaded(true);
      return;
    }

    try {
      setSession(JSON.parse(saved) as GenerationSessionState);
    } catch (error) {
      log.error('Failed to parse generation session:', error);
    } finally {
      setSessionLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionLoaded || !session?.interviewCompleted) return;
    if (searchParams.get('revisit') === '1') return;
    router.replace('/generation-preview');
  }, [router, searchParams, session?.interviewCompleted, sessionLoaded]);

  const topic = useMemo(() => {
    if (!session) return '';
    return session.originalRequirement || session.requirements.requirement || '';
  }, [session]);

  const navigateToGeneration = () => {
    router.push('/generation-preview');
  };

  const handleBackToEdit = () => {
    router.push('/');
  };

  const handleSkip = () => {
    if (session) {
      const nextSession: GenerationSessionState = {
        ...session,
        interviewCompleted: false,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(nextSession));
    }
    navigateToGeneration();
  };

  const handleComplete = (result: InterviewResult) => {
    if (!session) return;

    const nextSession: GenerationSessionState = {
      ...session,
      requirements: {
        ...session.requirements,
        requirement: buildEnhancedRequirement(result),
      },
      interviewResult: result,
      interviewCompleted: true,
    };

    sessionStorage.setItem('generationSession', JSON.stringify(nextSession));
    navigateToGeneration();
  };

  if (!sessionLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="text-sm text-muted-foreground">正在加载访谈…</div>
      </div>
    );
  }

  if (!session || !topic.trim()) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 dark:from-slate-950 dark:to-slate-900">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>找不到待生成的课堂需求</CardTitle>
            <CardDescription>
              当前没有可用的 generation session。请先回到首页输入课题，再进入访谈。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end">
            <Button onClick={() => router.push('/')}>返回首页</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(139,92,246,0.14),_transparent_28%),linear-gradient(to_bottom,_#020617,_#0b1020)] text-foreground">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            className="text-white/80 hover:bg-white/8 hover:text-white"
            onClick={handleBackToEdit}
          >
            <ArrowLeft className="size-4" />
            返回修改原始需求
          </Button>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 md:flex">
            <ClipboardList className="size-3.5" />
            先访谈，再生成课堂
          </div>
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="min-h-0"
          >
            <InterviewChat topic={topic} onComplete={handleComplete} onSkip={handleSkip} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: 0.08, ease: 'easeOut' }}
            className="hidden lg:block"
          >
            <Card className="border-white/10 bg-white/5 text-white shadow-xl shadow-black/20 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <MessageSquareText className="size-4 text-violet-300" />
                  访谈说明
                </CardTitle>
                <CardDescription className="text-white/60">
                  这一步会先和你确认教学目标、学生画像、重难点和课堂策略，再进入正式生成。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-white/80">
                <div>
                  <p className="font-medium text-white">当前课题</p>
                  <p className="mt-1 leading-6 text-white/70">{topic}</p>
                </div>
                <div>
                  <p className="font-medium text-white">你会得到什么</p>
                  <ul className="mt-2 space-y-2 text-white/70">
                    <li>1. 更清晰的教学目标和 Bloom 层级</li>
                    <li>2. 对学生误区和重难点的显式约束</li>
                    <li>3. 更贴近你课堂风格的生成输入</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-white">如果你赶时间</p>
                  <p className="mt-1 text-white/70">可以直接点击“跳过访谈”，系统会按原始需求继续生成。</p>
                </div>
                <div>
                  <p className="font-medium text-white">如果你想改题目</p>
                  <p className="mt-1 text-white/70">点击左上角“返回修改原始需求”，会回到首页并保留你刚才输入的主题。</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function InterviewPage() {
  return <InterviewPageContent />;
}
