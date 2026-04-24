/**
 * Student Model — Server-only DB operations
 *
 * This file contains functions that require database access.
 * Must only be imported from API routes (server-side), never from client components.
 */

import { createLogger } from '@/lib/logger'
import type { StudentMastery, DiagnosticResult } from '@/lib/types/adaptive'
import { getStudentMastery, upsertStudentMastery } from '@/lib/supabase/adaptive'
import { updateMasteryLevel, isMastered } from './student-model'

const log = createLogger('StudentModel')

// ─── Diagnostic result → mastery ─────────────────────────────────────────────

export async function applyDiagnosticResult(diagnosticResult: DiagnosticResult): Promise<void> {
  const { student_id, node_assessments } = diagnosticResult

  if (!student_id) {
    log.warn('applyDiagnosticResult: missing student_id, skipping')
    return
  }

  if (!node_assessments || node_assessments.length === 0) {
    log.warn('applyDiagnosticResult: no node_assessments to apply')
    return
  }

  const now = new Date().toISOString()
  let writtenCount = 0

  for (const assessment of node_assessments) {
    if (!assessment.node_id || typeof assessment.estimated_mastery !== 'number') {
      continue
    }

    const mastery = Math.min(1, Math.max(0, assessment.estimated_mastery))

    const result = await upsertStudentMastery(student_id, assessment.node_id, {
      mastery_level: mastery,
      attempt_count: 1,
      correct_count: 0,
      last_seen_at: now,
      last_score: mastery,
    })

    if (result) {
      writtenCount++
    } else {
      log.warn(`applyDiagnosticResult: upsert failed for node ${assessment.node_id}, continuing`)
    }
  }

  log.info(
    `applyDiagnosticResult: wrote ${writtenCount}/${node_assessments.length} mastery rows for student ${student_id}`,
  )
}

// ─── Quiz result → mastery ────────────────────────────────────────────────────

export interface QuizMasteryUpdate {
  newMastery: number
  wasMastered: boolean
  nowMastered: boolean
}

export async function recordQuizResult(
  studentId: string,
  nodeId: string,
  correctCount: number,
  totalCount: number,
  sessionId: string,
): Promise<QuizMasteryUpdate> {
  if (totalCount <= 0) {
    log.warn(`recordQuizResult: totalCount=${totalCount} — nothing to record (session=${sessionId})`)
    return { newMastery: 0, wasMastered: false, nowMastered: false }
  }

  const score = Math.min(1, Math.max(0, correctCount / totalCount))

  let currentRow: StudentMastery | null = null
  try {
    currentRow = await getStudentMastery(studentId, nodeId)
  } catch (err) {
    log.error('recordQuizResult: error fetching current mastery, proceeding with 0:', err)
  }

  const currentMastery = currentRow?.mastery_level ?? 0
  const wasMastered = isMastered(currentMastery)
  const newMastery = updateMasteryLevel(currentMastery, score)
  const nowMastered = isMastered(newMastery)

  const newAttemptCount = (currentRow?.attempt_count ?? 0) + 1
  const newCorrectCount = (currentRow?.correct_count ?? 0) + correctCount
  const now = new Date().toISOString()

  const result = await upsertStudentMastery(studentId, nodeId, {
    mastery_level: newMastery,
    attempt_count: newAttemptCount,
    correct_count: newCorrectCount,
    last_seen_at: now,
    last_score: score,
  })

  if (!result) {
    log.error(`recordQuizResult: upsert failed for student=${studentId} node=${nodeId} session=${sessionId}`)
  } else {
    log.info(
      `recordQuizResult: student=${studentId} node=${nodeId} score=${score.toFixed(2)} mastery ${currentMastery.toFixed(2)}→${newMastery.toFixed(2)} attempts=${newAttemptCount}`,
    )
  }

  return { newMastery, wasMastered, nowMastered }
}
