/**
 * Quiz Submit API
 *
 * POST /api/adaptive/quiz/submit
 * Headers: x-student-id
 * Body: { nodeId: string, correctCount: number, totalCount: number }
 *
 * Returns: { newMastery, wasMastered, nowMastered }
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { recordQuizResult } from '@/lib/adaptive/student-model-server';
import { createLearningSession } from '@/lib/supabase/adaptive';

const log = createLogger('Quiz Submit API');

export async function POST(req: NextRequest) {
  try {
    const studentId = req.headers.get('x-student-id') || 'anonymous';
    const body: { nodeId: string; correctCount: number; totalCount: number } = await req.json();

    if (!body.nodeId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: nodeId');
    }

    if (typeof body.correctCount !== 'number' || typeof body.totalCount !== 'number') {
      return apiError('INVALID_REQUEST', 400, 'correctCount and totalCount must be numbers');
    }

    // Create a session record for this quiz attempt
    const session = await createLearningSession(studentId, body.nodeId, 'quiz');
    const sessionId = session?.id ?? `local-${Date.now()}`;

    log.info(`Quiz submit: student=${studentId}, node=${body.nodeId}, score=${body.correctCount}/${body.totalCount}`);

    const update = await recordQuizResult(
      studentId,
      body.nodeId,
      body.correctCount,
      body.totalCount,
      sessionId,
    );

    return NextResponse.json(update);
  } catch (error) {
    log.error('Quiz submit failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Failed');
  }
}
