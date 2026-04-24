/**
 * Adaptive Learning — TypeScript Types
 *
 * Phase 1 MVP: AP Physics 2 Fluids unit.
 * No user authentication; student_id is a random UUID in localStorage.
 */

// ─── Knowledge Graph ─────────────────────────────────────────────────────────

export interface TeachingSkeleton {
  core_idea: string
  explain_like_5: string
  key_examples: string[]
  real_world_connections: string[]
  ap_exam_tips: string
}

export interface KnowledgeNode {
  id: string
  name: string
  name_zh: string
  unit: string
  topic: string
  ap_learning_objective: string
  /** IDs of other KnowledgeNodes that must be understood first */
  prerequisites: string[]
  difficulty: 1 | 2 | 3 | 4 | 5
  estimated_minutes: number
  common_misconceptions: string[]
  key_equations: string[]
  teaching_skeleton: TeachingSkeleton
}

// ─── Student Mastery ─────────────────────────────────────────────────────────

/**
 * Tracks how well a student has mastered a single knowledge node.
 * Phase 1 uses a simple numeric level (EMA of quiz scores).
 */
export interface StudentMastery {
  student_id: string
  node_id: string
  /** 0.0 (untouched) – 1.0 (fully mastered) */
  mastery_level: number
  attempt_count: number
  correct_count: number
  last_seen_at: string
  last_score: number | null
}

// ─── Learning Session ────────────────────────────────────────────────────────

export type SessionType = 'learn' | 'quiz' | 'review' | 'diagnostic'

export interface LearningSession {
  id: string
  student_id: string
  node_id: string
  started_at: string
  completed_at: string | null
  session_type: SessionType
  score: number | null
}

// ─── Learning Events ─────────────────────────────────────────────────────────

export type LearningEventType =
  | 'view_content'
  | 'answer_question'
  | 'complete_quiz'
  | 'skip'

export interface LearningEvent {
  id: string
  session_id: string
  student_id: string
  node_id: string
  event_type: LearningEventType
  payload: Record<string, unknown>
  created_at: string
}

// ─── Diagnostic Result ───────────────────────────────────────────────────────

export interface NodeAssessment {
  node_id: string
  /** AI-inferred mastery estimate from the diagnostic interview */
  estimated_mastery: number
  confidence: 'low' | 'medium' | 'high'
}

export interface DiagnosticResult {
  student_id: string
  completed_at: string
  node_assessments: NodeAssessment[]
  recommended_start_node: string
}
