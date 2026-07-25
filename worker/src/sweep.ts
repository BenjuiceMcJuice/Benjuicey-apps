import { commitSubmissionUpdates, SubmissionUpdate } from './firestore'
import { isAutoCloseDue, isStatus, normaliseStatus } from '../../lib/status'

// ─── status sweep ────────────────────────────────────────────────────
// Two housekeeping jobs, both driven off a list of submissions we already
// hold in memory (so a sweep costs zero extra reads and, when nothing is
// due, zero writes):
//
//   1. auto-close — a ticket that has been `resolved` for longer than the
//      AUTO_CLOSE_DAYS window becomes `closed`. Nobody can set `closed` by
//      hand; this is the only path to it.
//   2. legacy migration — records written by the old four-status system
//      (`open` / `done` / `wont-fix`) are rewritten in place to the current
//      enum, so the stored data matches what the UI shows.

export interface SweepPlanEntry {
  ref: string
  fields: SubmissionUpdate
  reason: 'auto-close' | 'legacy-migration' | 'resolved-clock-start'
}

/**
 * Works out the writes a sweep would make, without performing them.
 * Pure — exported separately so the policy is testable and so the caller
 * can log exactly what changed.
 */
export function planStatusSweep(
  submissions: Record<string, unknown>[],
  now: number,
): SweepPlanEntry[] {
  const plan: SweepPlanEntry[] = []

  for (const sub of submissions) {
    const ref = typeof sub.ref === 'string' ? sub.ref : ''
    if (!ref) continue

    const raw = sub.status
    const resolvedAt = (sub.resolvedAt ?? null) as string | null

    // 1. Legacy status → current enum.
    if (!isStatus(raw)) {
      const status = normaliseStatus(raw)
      const fields: SubmissionUpdate = { status }
      // A legacy `done` starts its auto-close clock now rather than closing
      // instantly — it never had a resolve timestamp to count from.
      if (status === 'resolved') fields.resolvedAt = new Date(now)
      if (status === 'closed') {
        fields.closedAt = new Date(now)
        fields.autoClosed = false
      }
      plan.push({ ref, fields, reason: 'legacy-migration' })
      continue
    }

    if (raw !== 'resolved') continue

    // 2a. Resolved but with no timestamp (e.g. written before this field
    //     existed): start the clock rather than close it out of nowhere.
    if (!resolvedAt) {
      plan.push({ ref, fields: { resolvedAt: new Date(now) }, reason: 'resolved-clock-start' })
      continue
    }

    // 2b. Resolved long enough — close it.
    if (isAutoCloseDue(resolvedAt, now)) {
      plan.push({
        ref,
        fields: { status: 'closed', closedAt: new Date(now), autoClosed: true },
        reason: 'auto-close',
      })
    }
  }

  return plan
}

/** Applies a sweep plan to an in-memory submission list (no network). */
export function applyStatusSweep(
  submissions: Record<string, unknown>[],
  plan: SweepPlanEntry[],
): Record<string, unknown>[] {
  if (plan.length === 0) return submissions
  const byRef = new Map(plan.map(p => [p.ref, p.fields]))
  return submissions.map(sub => {
    const fields = byRef.get(sub.ref as string)
    if (!fields) return sub
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      patch[k] = v instanceof Date ? v.toISOString() : v
    }
    return { ...sub, ...patch }
  })
}

/**
 * Runs the sweep: commits any due writes and returns the submission list
 * with those writes reflected, so a caller can hand the result straight
 * back to the dashboard.
 */
export async function runStatusSweep(
  projectId: string,
  token: string,
  submissions: Record<string, unknown>[],
  now: number = Date.now(),
): Promise<{ submissions: Record<string, unknown>[]; plan: SweepPlanEntry[] }> {
  const plan = planStatusSweep(submissions, now)
  if (plan.length === 0) return { submissions, plan }
  await commitSubmissionUpdates(
    projectId,
    token,
    plan.map(({ ref, fields }) => ({ ref, fields })),
  )
  return { submissions: applyStatusSweep(submissions, plan), plan }
}
