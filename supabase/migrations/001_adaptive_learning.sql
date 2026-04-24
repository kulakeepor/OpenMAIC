-- ============================================================
-- 001_adaptive_learning.sql
-- Phase 1 Adaptive Learning System — Data Model
--
-- Note: Phase 1 has NO Supabase Auth. student_id is a plain
-- TEXT field containing a random UUID generated on the client
-- and persisted in localStorage. No RLS / no auth.uid().
-- ============================================================

-- ─── student_mastery ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_mastery (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    TEXT         NOT NULL,
  node_id       TEXT         NOT NULL,
  -- 0.00 – 1.00 (EMA of quiz scores)
  mastery_level DECIMAL(3,2) NOT NULL DEFAULT 0.0
    CHECK (mastery_level >= 0 AND mastery_level <= 1),
  attempt_count INTEGER      NOT NULL DEFAULT 0,
  correct_count INTEGER      NOT NULL DEFAULT 0,
  last_seen_at  TIMESTAMPTZ,
  last_score    DECIMAL(5,2),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, node_id)
);

-- ─── learning_sessions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   TEXT        NOT NULL,
  node_id      TEXT        NOT NULL,
  session_type TEXT        NOT NULL
    CHECK (session_type IN ('learn', 'quiz', 'review', 'diagnostic')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  score        DECIMAL(5,2),
  metadata     JSONB       NOT NULL DEFAULT '{}'
);

-- ─── learning_events ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID        REFERENCES learning_sessions(id) ON DELETE CASCADE,
  student_id TEXT        NOT NULL,
  node_id    TEXT        NOT NULL,
  event_type TEXT        NOT NULL,
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── diagnostic_results ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnostic_results (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            TEXT        NOT NULL,
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Array of { node_id, estimated_mastery, confidence }
  node_assessments      JSONB       NOT NULL DEFAULT '[]',
  recommended_start_node TEXT,
  -- Full raw conversation for debugging / future fine-tuning
  raw_conversation      JSONB       NOT NULL DEFAULT '[]'
);

-- ─── Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_student_mastery_student
  ON student_mastery (student_id);

CREATE INDEX IF NOT EXISTS idx_student_mastery_node
  ON student_mastery (node_id);

CREATE INDEX IF NOT EXISTS idx_learning_sessions_student
  ON learning_sessions (student_id);

CREATE INDEX IF NOT EXISTS idx_learning_events_session
  ON learning_events (session_id);

CREATE INDEX IF NOT EXISTS idx_learning_events_student
  ON learning_events (student_id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_results_student
  ON diagnostic_results (student_id);

-- ─── updated_at trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_student_mastery_updated_at
  BEFORE UPDATE ON student_mastery
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
