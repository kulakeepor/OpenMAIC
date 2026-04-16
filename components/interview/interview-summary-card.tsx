'use client';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InterviewResult } from '@/lib/types/interview';

interface InterviewSummaryCardProps {
  result: InterviewResult;
  onConfirm: () => void;
  onModify: () => void;
  className?: string;
}

function formatApproachLabel(approach: InterviewResult['preferredApproach']): string {
  switch (approach) {
    case 'historical':
      return '历史叙事';
    case 'experimental':
      return '实验引入';
    case 'derivation':
      return '公式推导';
    case 'problem-driven':
      return '问题驱动';
    case 'mixed':
    default:
      return '混合式';
  }
}

function formatEngagementLabel(engagement: InterviewResult['engagementStyle']): string {
  switch (engagement) {
    case 'active':
      return '积极互动';
    case 'quiet':
      return '安静听讲';
    case 'mixed':
    default:
      return '混合型';
  }
}

function renderList(items: string[], emptyLabel: string) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-1.5 text-sm text-foreground/90">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function InterviewSummaryCard({
  result,
  onConfirm,
  onModify,
  className,
}: InterviewSummaryCardProps) {
  return (
    <Card
      className={cn(
        'border-primary/20 bg-white/95 shadow-lg shadow-primary/5 dark:bg-slate-900/95',
        className,
      )}
    >
      <CardHeader>
        <CardTitle>教学设计摘要</CardTitle>
        <CardDescription>
          请确认这份访谈结果是否符合你的课堂设计意图。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">教学目标</h3>
          {renderList(result.learningObjectives, '尚未整理出明确教学目标')}
          <p className="text-xs text-muted-foreground">Bloom 层级：{result.bloomLevel}</p>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">核心难点</h3>
            {renderList(result.keyDifficulties, '未记录核心难点')}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">常见误区</h3>
            {renderList(result.commonMisconceptions, '未记录常见误区')}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">学生画像</h3>
          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/25 p-3 text-sm">
            <p>
              <span className="text-muted-foreground">学生水平：</span>
              {result.studentLevel}
            </p>
            <p>
              <span className="text-muted-foreground">先修知识：</span>
              {result.prerequisites.length > 0 ? result.prerequisites.join('、') : '未指定'}
            </p>
            {result.classSize && (
              <p>
                <span className="text-muted-foreground">班级规模：</span>
                {result.classSize}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">参与风格：</span>
              {formatEngagementLabel(result.engagementStyle)}
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">教学策略</h3>
          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/25 p-3 text-sm">
            <p>
              <span className="text-muted-foreground">引入方式：</span>
              {formatApproachLabel(result.preferredApproach)}
            </p>
            <p>
              <span className="text-muted-foreground">课堂时长：</span>
              {result.duration} 分钟
            </p>
            <p>
              <span className="text-muted-foreground">时间分配：</span>
              概念引入 {result.timeAllocation.conceptIntroduction}% / 核心讲解{' '}
              {result.timeAllocation.coreExplanation}% / 练习讨论{' '}
              {result.timeAllocation.practiceAndDiscussion}% / 测评{' '}
              {result.timeAllocation.assessment}%
            </p>
          </div>
        </section>
      </CardContent>

      <CardFooter className="justify-end gap-2 border-t border-border/60 pt-4">
        <Button variant="outline" onClick={onModify}>
          修改
        </Button>
        <Button onClick={onConfirm}>确认</Button>
      </CardFooter>
    </Card>
  );
}
