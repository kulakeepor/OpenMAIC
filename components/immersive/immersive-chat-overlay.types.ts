'use client';

export type ImmersiveChatMessageRole = 'user' | 'assistant';

export interface ImmersiveChatMessage {
  role: ImmersiveChatMessageRole;
  content: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
}

export interface ImmersiveChatOverlayProps {
  sceneId: string;
  narrativeText: string;
  historicalContext?: string;
  keyFormulas?: string[];
  sceneTitle?: string;
  sceneImageUrl?: string;
  teacherAgentId: string;
  teacherName?: string;
  teacherAvatar?: string;
}
