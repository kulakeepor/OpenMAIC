import 'server-only'

/**
 * Database Client — Phase 1 Adaptive Learning
 *
 * Uses `postgres` (pg) directly against local PostgreSQL.
 * The two legacy exports (getSupabaseBrowserClient / getSupabaseServerClient)
 * are kept for backward compatibility but now return the sql tag instance.
 */

import postgres from 'postgres'

export const sql = postgres(process.env.DATABASE_URL!)

// ─── Backward-compat shims ───────────────────────────────────────────────────
// Callers that still import getSupabaseBrowserClient / getSupabaseServerClient
// should migrate to `import { sql } from '@/lib/supabase/client'`.

/** @deprecated Use `sql` from '@/lib/supabase/client' instead. */
export function getSupabaseBrowserClient() {
  return sql
}

/** @deprecated Use `sql` from '@/lib/supabase/client' instead. */
export function getSupabaseServerClient() {
  return sql
}
