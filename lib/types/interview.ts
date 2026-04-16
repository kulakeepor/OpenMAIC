/**
 * Interview Types
 *
 * Defines the structured data exchanged during the teacher interview flow.
 */

export type InterviewRole = 'assistant' | 'user';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export type InterviewEngagementStyle = 'active' | 'quiet' | 'mixed';

export type InterviewPreferredApproach =
  | 'historical'
  | 'experimental'
  | 'derivation'
  | 'problem-driven'
  | 'mixed';

export type InterviewSessionStatus =
  | 'in-progress'
  | 'summarizing'
  | 'confirmed'
  | 'cancelled';

/**
 * Single turn in the interview conversation.
 */
export interface InterviewTurn {
  role: InterviewRole;
  content: string;
  timestamp: number;
}

/**
 * Time allocation across classroom phases.
 * Values are percentages and are expected to sum to 100.
 */
export interface TimeAllocation {
  conceptIntroduction: number;
  coreExplanation: number;
  practiceAndDiscussion: number;
  assessment: number;
}

/**
 * Structured output produced by the interview assistant.
 * This becomes an enhanced upstream input for classroom generation.
 */
export interface InterviewResult {
  // Metadata
  id: string;
  topic: string;
  createdAt: number;

  // Learning goals
  learningObjectives: string[];
  bloomLevel: BloomLevel;

  // Difficulties and misconceptions
  keyDifficulties: string[];
  commonMisconceptions: string[];

  // Student profile
  studentLevel: string;
  prerequisites: string[];
  classSize?: string;
  engagementStyle: InterviewEngagementStyle;

  // Teaching strategy
  preferredApproach: InterviewPreferredApproach;
  duration: number;
  timeAllocation: TimeAllocation;

  // Additional constraints and preferences
  preferredExamples: string[];
  constraints: string[];
  additionalNotes?: string;

  // Full conversation trace for auditing and debugging
  conversationHistory: InterviewTurn[];
}

/**
 * Frontend interview session state.
 * Allows partial structured data to accumulate before final confirmation.
 */
export interface InterviewSession {
  id: string;
  topic: string;
  status: InterviewSessionStatus;
  currentRound: number;
  totalRounds: number;
  messages: InterviewTurn[];
  collectedInfo: Partial<InterviewResult>;
  result?: InterviewResult;
}
