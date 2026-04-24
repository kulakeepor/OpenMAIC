/**
 * Student Model — Mastery Tracking
 *
 * Core mastery-tracking module for the adaptive learning system.
 * Uses Exponential Moving Average (EMA) — not BKT — for simplicity and
 * interpretability in Phase 1.
 *
 * Algorithm:
 *   new_mastery = α × score + (1 − α) × current_mastery
 *   α = 0.3 (default; higher values weight recent performance more)
 *
 * All database operations are guarded with try/catch and return sane
 * defaults on failure so callers never crash on DB errors.
 *
 * Dependencies:
 *   - lib/supabase/adaptive.ts  (Step A helper functions — already created)
 *   - lib/types/adaptive.ts     (Step A type definitions — already created)
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('StudentModel')

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default EMA smoothing factor — weight given to the most recent score. */
const DEFAULT_ALPHA = 0.3

/** Mastery threshold above which a node is considered "mastered". */
const DEFAULT_MASTERY_THRESHOLD = 0.8

/** Mastery threshold below which an attempted node is flagged as "weak". */
const WEAK_NODE_THRESHOLD = 0.5

// ─── Student ID management ────────────────────────────────────────────────────

const STUDENT_ID_KEY = 'student_id'

/**
 * Returns the persistent student ID from localStorage, creating a new UUID
 * and storing it if one doesn't exist yet.
 *
 * Safe to call from Next.js Server Components — returns `null` on the server
 * (where `window` is undefined) rather than throwing. Callers that need a
 * guaranteed ID should only invoke this from client-side code or a
 * Client Component.
 *
 * @returns The student UUID string, or `null` when called server-side.
 */
export function getOrCreateStudentId(): string | null {
  if (typeof window === 'undefined') {
    // Running on the server — no localStorage available.
    return null
  }

  const existing = localStorage.getItem(STUDENT_ID_KEY)
  if (existing) {
    return existing
  }

  // crypto.randomUUID() is available in all modern browsers and Node ≥ 19.
  const newId = crypto.randomUUID()
  localStorage.setItem(STUDENT_ID_KEY, newId)
  log.info('Created new student ID:', newId)
  return newId
}

// ─── Mastery calculation ──────────────────────────────────────────────────────

/**
 * Computes a new mastery level using Exponential Moving Average.
 *
 * Formula: `new = α × score + (1 − α) × current`
 *
 * Both `currentMastery` and `score` must be in [0, 1]. The returned value
 * is clamped to [0, 1] to guard against floating-point drift.
 *
 * @param currentMastery  Current mastery level in [0, 1].
 * @param score           Performance score for the latest attempt in [0, 1].
 * @param alpha           Smoothing factor in (0, 1]. Defaults to 0.3.
 * @returns               Updated mastery level in [0, 1].
 */
export function updateMasteryLevel(
  currentMastery: number,
  score: number,
  alpha: number = DEFAULT_ALPHA,
): number {
  if (alpha <= 0 || alpha > 1) {
    log.warn(`updateMasteryLevel: alpha=${alpha} is out of (0, 1], using default ${DEFAULT_ALPHA}`)
    alpha = DEFAULT_ALPHA
  }

  const updated = alpha * score + (1 - alpha) * currentMastery
  // Clamp to [0, 1] to be safe against floating-point imprecision.
  return Math.min(1, Math.max(0, updated))
}

/**
 * Returns `true` when the mastery level meets or exceeds the mastery
 * threshold — i.e., the student can be considered to have "mastered" this
 * knowledge node.
 *
 * @param mastery    Mastery level in [0, 1].
 * @param threshold  Minimum value to be considered mastered. Defaults to 0.8.
 */
export function isMastered(mastery: number, threshold: number = DEFAULT_MASTERY_THRESHOLD): boolean {
  return mastery >= threshold
}

// ─── StudentProgress ──────────────────────────────────────────────────────────

/**
 * Snapshot of a student's overall progress across all nodes in a unit.
 */
export interface StudentProgress {
  /** The student's persistent UUID. */
  studentId: string
  /** Total number of nodes in the curriculum. */
  totalNodes: number
  /** Nodes where mastery_level >= 0.8. */
  masteredNodes: number
  /** Nodes where 0 < mastery_level < 0.8 (started but not yet mastered). */
  inProgressNodes: number
  /** Nodes that have never been attempted (mastery_level === 0 or no DB row). */
  notStartedNodes: number
  /** Fraction of mastered nodes out of all nodes: masteredNodes / totalNodes. */
  overallProgress: number
  /** Node IDs with mastery_level < 0.5 that the student has already attempted. */
  weakNodes: string[]
}

/**
 * Computes the student's overall progress across the full set of node IDs.
 *
 * Pure function — accepts a pre-fetched mastery map so it can run in the
 * browser without touching the database. Callers should fetch mastery data
 * via GET /api/adaptive/mastery and build the map themselves.
 *
 * @param studentId     Student UUID (from `getOrCreateStudentId()`).
 * @param allNodeIds    Complete list of node IDs in the curriculum.
 * @param masteryByNode Pre-fetched map of nodeId → mastery_level (0–1).
 * @returns             A `StudentProgress` snapshot.
 */
export function getStudentProgress(
  studentId: string,
  allNodeIds: string[],
  masteryByNode: Record<string, number> = {},
): StudentProgress {
  const totalNodes = allNodeIds.length

  if (!studentId || totalNodes === 0) {
    return {
      studentId,
      totalNodes,
      masteredNodes: 0,
      inProgressNodes: 0,
      notStartedNodes: totalNodes,
      overallProgress: 0,
      weakNodes: [],
    }
  }

  let masteredNodes = 0
  let inProgressNodes = 0
  let notStartedNodes = 0
  const weakNodes: string[] = []

  for (const nodeId of allNodeIds) {
    const level = masteryByNode[nodeId] ?? 0

    if (level === 0) {
      notStartedNodes++
    } else if (isMastered(level)) {
      masteredNodes++
    } else {
      inProgressNodes++
      // Flag as weak if below the weak threshold but already attempted.
      if (level < WEAK_NODE_THRESHOLD) {
        weakNodes.push(nodeId)
      }
    }
  }

  const overallProgress = totalNodes > 0 ? masteredNodes / totalNodes : 0

  return {
    studentId,
    totalNodes,
    masteredNodes,
    inProgressNodes,
    notStartedNodes,
    overallProgress,
    weakNodes,
  }
}

