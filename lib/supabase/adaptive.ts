/**
 * Database Helper Functions — Adaptive Learning (Phase 1)
 *
 * All functions follow the same error contract:
 *   - On success: return the result value (or void)
 *   - On failure: console.error + return null (never throws)
 *
 * Phase 1: no auth — student_id is a plain string (UUID from localStorage).
 */

import { sql } from './client'
import type {
  StudentMastery,
  LearningSession,
  LearningEventType,
  DiagnosticResult,
  SessionType,
} from '@/lib/types/adaptive'

// ─── Student Mastery ─────────────────────────────────────────────────────────

/**
 * Fetch the mastery record for one (student, node) pair.
 * Returns null if no record exists yet or on error.
 */
export async function getStudentMastery(
  studentId: string,
  nodeId: string,
): Promise<StudentMastery | null> {
  try {
    const rows = await sql<StudentMastery[]>`
      SELECT *
      FROM student_mastery
      WHERE student_id = ${studentId}
        AND node_id    = ${nodeId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      student_id:    row.student_id,
      node_id:       row.node_id,
      mastery_level: Number(row.mastery_level),
      attempt_count: row.attempt_count,
      correct_count: row.correct_count,
      last_seen_at:  row.last_seen_at,
      last_score:    row.last_score != null ? Number(row.last_score) : null,
    }
  } catch (err) {
    console.error('[adaptive] getStudentMastery error:', err)
    return null
  }
}

/**
 * Upsert mastery data for a (student, node) pair.
 * Partial updates are supported — only the provided fields are changed.
 * Returns the updated record or null on error.
 */
export async function upsertStudentMastery(
  studentId: string,
  nodeId: string,
  data: Partial<
    Pick<
      StudentMastery,
      'mastery_level' | 'attempt_count' | 'correct_count' | 'last_seen_at' | 'last_score'
    >
  >,
): Promise<StudentMastery | null> {
  try {
    const lastSeenAt = data.last_seen_at ?? new Date().toISOString()

    const rows = await sql<StudentMastery[]>`
      INSERT INTO student_mastery
        (student_id, node_id, mastery_level, attempt_count, correct_count, last_seen_at, last_score)
      VALUES (
        ${studentId},
        ${nodeId},
        ${data.mastery_level ?? 0},
        ${data.attempt_count ?? 0},
        ${data.correct_count ?? 0},
        ${lastSeenAt},
        ${data.last_score ?? null}
      )
      ON CONFLICT (student_id, node_id) DO UPDATE SET
        mastery_level = EXCLUDED.mastery_level,
        attempt_count = EXCLUDED.attempt_count,
        correct_count = EXCLUDED.correct_count,
        last_seen_at  = EXCLUDED.last_seen_at,
        last_score    = EXCLUDED.last_score,
        updated_at    = now()
      RETURNING *
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      student_id:    row.student_id,
      node_id:       row.node_id,
      mastery_level: Number(row.mastery_level),
      attempt_count: row.attempt_count,
      correct_count: row.correct_count,
      last_seen_at:  row.last_seen_at,
      last_score:    row.last_score != null ? Number(row.last_score) : null,
    }
  } catch (err) {
    console.error('[adaptive] upsertStudentMastery error:', err)
    return null
  }
}

// ─── Learning Sessions ───────────────────────────────────────────────────────

/**
 * Create a new learning session and return it.
 * Returns null on error.
 */
export async function createLearningSession(
  studentId: string,
  nodeId: string,
  sessionType: SessionType,
): Promise<LearningSession | null> {
  try {
    const rows = await sql<LearningSession[]>`
      INSERT INTO learning_sessions (student_id, node_id, session_type)
      VALUES (${studentId}, ${nodeId}, ${sessionType})
      RETURNING *
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id:           row.id,
      student_id:   row.student_id,
      node_id:      row.node_id,
      started_at:   row.started_at,
      completed_at: row.completed_at ?? null,
      session_type: row.session_type as SessionType,
      score:        row.score != null ? Number(row.score) : null,
    }
  } catch (err) {
    console.error('[adaptive] createLearningSession error:', err)
    return null
  }
}

/**
 * Mark a session as completed and optionally record a score.
 * Returns true on success, null on error.
 */
export async function completeLearningSession(
  sessionId: string,
  score: number | null,
): Promise<true | null> {
  try {
    if (score != null) {
      await sql`
        UPDATE learning_sessions
        SET completed_at = now(),
            score        = ${score}
        WHERE id = ${sessionId}
      `
    } else {
      await sql`
        UPDATE learning_sessions
        SET completed_at = now()
        WHERE id = ${sessionId}
      `
    }
    return true
  } catch (err) {
    console.error('[adaptive] completeLearningSession error:', err)
    return null
  }
}

// ─── Learning Events ─────────────────────────────────────────────────────────

/**
 * Append a learning event to the log.
 * Returns true on success, null on error.
 */
export async function logLearningEvent(
  sessionId: string,
  studentId: string,
  nodeId: string,
  eventType: LearningEventType,
  payload: Record<string, unknown> = {},
): Promise<true | null> {
  try {
    await sql`
      INSERT INTO learning_events (session_id, student_id, node_id, event_type, payload)
      VALUES (
        ${sessionId},
        ${studentId},
        ${nodeId},
        ${eventType},
        ${sql.json(payload as never)}
      )
    `
    return true
  } catch (err) {
    console.error('[adaptive] logLearningEvent error:', err)
    return null
  }
}

// ─── Diagnostic Results ──────────────────────────────────────────────────────

/**
 * Persist a completed diagnostic result.
 * Returns the saved record id or null on error.
 */
export async function saveDiagnosticResult(
  result: DiagnosticResult,
  rawConversation: Record<string, unknown>[] = [],
): Promise<string | null> {
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO diagnostic_results
        (student_id, completed_at, node_assessments, recommended_start_node, raw_conversation)
      VALUES (
        ${result.student_id},
        ${result.completed_at},
        ${sql.json(result.node_assessments as never)},
        ${result.recommended_start_node},
        ${sql.json(rawConversation as never)}
      )
      RETURNING id
    `

    if (rows.length === 0) return null
    return rows[0].id
  } catch (err) {
    console.error('[adaptive] saveDiagnosticResult error:', err)
    return null
  }
}
