/**
 * Interview Utility Functions
 *
 * Helper functions for processing interview results.
 */

import type { InterviewResult, InterviewTurn } from '@/lib/types/interview';

/**
 * Extract InterviewResult JSON from AI response text.
 *
 * Handles common formatting variations:
 * - ```json ... ``` code blocks
 * - ``` ... ``` code blocks (without language spec)
 * - Plain JSON objects in the text
 *
 * @param text - AI response text that may contain JSON
 * @returns Parsed InterviewResult or null if extraction fails
 */
export function extractInterviewResult(text: string): InterviewResult | null {
  try {
    // Try to extract JSON from code blocks first
    const jsonCodeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonCodeBlockMatch) {
      return JSON.parse(jsonCodeBlockMatch[1]);
    }

    // Try generic code blocks
    const genericCodeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (genericCodeBlockMatch) {
      return JSON.parse(genericCodeBlockMatch[1]);
    }

    // Try to find JSON object boundaries in plain text
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
      const jsonCandidate = text.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonCandidate);
    }

    return null;
  } catch (error) {
    console.error('Failed to extract InterviewResult:', error);
    return null;
  }
}

/**
 * Build enhanced requirement text from InterviewResult.
 *
 * Converts structured interview data into Markdown format that can be
 * directly used in UserRequirements.requirement field.
 *
 * @param result - Validated InterviewResult from interview
 * @returns Markdown-formatted enhanced requirement
 */
export function buildEnhancedRequirement(result: InterviewResult): string {
  const sections: string[] = [];

  // Header
  sections.push(`# 教学设计需求`);

  // Topic
  sections.push(`\n**课题**: ${result.topic}`);

  // Learning Objectives with Bloom Level
  const bloomLabels: Record<string, string> = {
    remember: '记忆',
    understand: '理解',
    apply: '应用',
    analyze: '分析',
    evaluate: '评价',
    create: '创造',
  };

  sections.push(`\n## 教学目标`);
  sections.push(`\n**认知层级**: ${bloomLabels[result.bloomLevel] || result.bloomLevel}`);
  sections.push(`\n学生课后应达到的能力：`);
  result.learningObjectives.forEach((obj, i) => {
    sections.push(`${i + 1}. ${obj}`);
  });

  // Key Difficulties & Common Misconceptions
  sections.push(`\n## 重难点与常见误区`);

  if (result.keyDifficulties.length > 0) {
    sections.push(`\n**重难点**:`);
    result.keyDifficulties.forEach((diff, i) => {
      sections.push(`- ${diff}`);
    });
  }

  if (result.commonMisconceptions.length > 0) {
    sections.push(`\n**常见误区**:`);
    result.commonMisconceptions.forEach((mis, i) => {
      sections.push(`- ${mis}`);
    });
  }

  // Student Profile
  sections.push(`\n## 学生画像`);
  sections.push(`\n**学生水平**: ${result.studentLevel}`);

  if (result.prerequisites.length > 0) {
    sections.push(`\n**先修知识**:`);
    result.prerequisites.forEach((prereq, i) => {
      sections.push(`- ${prereq}`);
    });
  }

  if (result.classSize) {
    sections.push(`\n**班级规模**: ${result.classSize}`);
  }

  const engagementLabels: Record<string, string> = {
    active: '积极互动',
    quiet: '安静听讲',
    mixed: '混合型',
  };
  sections.push(`\n**课堂参与风格**: ${engagementLabels[result.engagementStyle] || result.engagementStyle}`);

  // Teaching Strategy
  sections.push(`\n## 教学策略`);

  const approachLabels: Record<string, string> = {
    historical: '历史故事引入',
    experimental: '实验引入',
    derivation: '直接推导',
    'problem-driven': '问题驱动',
    mixed: '混合方式',
  };
  sections.push(`\n**偏好引入方式**: ${approachLabels[result.preferredApproach] || result.preferredApproach}`);
  sections.push(`\n**课堂时长**: ${result.duration} 分钟`);

  sections.push(`\n**时间分配**:`);
  sections.push(`- 概念引入: ${result.timeAllocation.conceptIntroduction}%`);
  sections.push(`- 核心讲解: ${result.timeAllocation.coreExplanation}%`);
  sections.push(`- 练习讨论: ${result.timeAllocation.practiceAndDiscussion}%`);
  sections.push(`- 评估反馈: ${result.timeAllocation.assessment}%`);

  // Preferred Examples
  if (result.preferredExamples.length > 0) {
    sections.push(`\n## 偏好素材/案例`);
    result.preferredExamples.forEach((example, i) => {
      sections.push(`${i + 1}. ${example}`);
    });
  }

  // Constraints
  if (result.constraints.length > 0) {
    sections.push(`\n## 约束条件`);
    result.constraints.forEach((constraint, i) => {
      sections.push(`- ${constraint}`);
    });
  }

  // Additional Notes
  if (result.additionalNotes) {
    sections.push(`\n## 补充说明`);
    sections.push(`\n${result.additionalNotes}`);
  }

  // Conversation History (optional reference)
  sections.push(`\n---`);
  sections.push(`\n*此需求基于 ${result.conversationHistory.length} 轮访谈对话整理生成*`);

  return sections.join('\n');
}

/**
 * Format conversation history for display.
 *
 * @param turns - Array of InterviewTurn objects
 * @returns Formatted conversation string
 */
export function formatConversationHistory(turns: InterviewTurn[]): string {
  if (!turns || turns.length === 0) {
    return '无对话记录';
  }

  return turns
    .map((turn, index) => {
      const roleLabel = turn.role === 'assistant' ? '访谈助手' : '老师';
      return `[${index + 1}] ${roleLabel}: ${turn.content}`;
    })
    .join('\n\n');
}
