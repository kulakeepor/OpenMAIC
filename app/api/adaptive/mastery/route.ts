/**
 * Mastery API
 *
 * GET  /api/adaptive/mastery?studentId=<id>
 *   Returns all mastery rows for the given student as a JSON array.
 *
 * POST /api/adaptive/mastery
 *   Body: { studentId, nodeId, masteryLevel, attempts?, lastCorrect?, lastTotal? }
 *   Upserts a single mastery row.
 *   Returns: { ok: true }
 *
 * Used by client components that cannot call the postgres sql tag directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/supabase/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('Mastery API')

export async function GET(req: NextRequest) {
  try {
    const studentId = req.nextUrl.searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json({ error: 'Missing studentId' }, { status: 400 })
    }

    const rows = await sql`
      SELECT *
      FROM student_mastery
      WHERE student_id = ${studentId}
    `

    return NextResponse.json(rows)
  } catch (err) {
    log.error('GET /api/adaptive/mastery error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: {
      studentId: string
      nodeId: string
      masteryLevel: number
      attempts?: number
      lastCorrect?: number
      lastTotal?: number
    } = await req.json()

    const { studentId, nodeId, masteryLevel } = body

    if (!studentId || !nodeId || typeof masteryLevel !== 'number') {
      return NextResponse.json(
        { error: 'Missing required fields: studentId, nodeId, masteryLevel' },
        { status: 400 },
      )
    }

    const attemptCount = body.attempts ?? 0
    const correctCount = body.lastCorrect ?? 0
    const lastScore = typeof body.lastTotal === 'number' && body.lastTotal > 0
      ? body.lastCorrect! / body.lastTotal
      : null
    const now = new Date().toISOString()

    await sql`
      INSERT INTO student_mastery
        (student_id, node_id, mastery_level, attempt_count, correct_count, last_seen_at, last_score)
      VALUES (
        ${studentId},
        ${nodeId},
        ${masteryLevel},
        ${attemptCount},
        ${correctCount},
        ${now},
        ${lastScore}
      )
      ON CONFLICT (student_id, node_id) DO UPDATE SET
        mastery_level = EXCLUDED.mastery_level,
        attempt_count = EXCLUDED.attempt_count,
        correct_count = EXCLUDED.correct_count,
        last_seen_at  = EXCLUDED.last_seen_at,
        last_score    = EXCLUDED.last_score,
        updated_at    = now()
    `

    return NextResponse.json({ ok: true })
  } catch (err) {
    log.error('POST /api/adaptive/mastery error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
