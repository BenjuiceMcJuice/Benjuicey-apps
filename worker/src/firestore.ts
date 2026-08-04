const BASE = 'https://firestore.googleapis.com/v1'

function docName(projectId: string, ...segments: string[]): string {
  return `projects/${projectId}/databases/(default)/documents/${segments.join('/')}`
}

function toField(v: unknown): unknown {
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) }
  if (typeof v === 'boolean') return { booleanValue: v }
  // Arrays and plain objects — used by `workNotes`, a list of {at, text}
  // maps. Both recurse, so a map's values get the same treatment.
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toField) } }
  if (typeof v === 'object' && v !== null) {
    const fields: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) fields[k] = toField(val)
    return { mapValue: { fields } }
  }
  return { nullValue: null }
}

function toDoc(name: string, data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) fields[k] = toField(v)
  return { name, fields }
}

function fromField(v: Record<string, unknown>): unknown {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return parseInt(v.integerValue as string)
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return v.timestampValue
  // Mirrors the array/map arms of `toField` — without these, `workNotes`
  // would read back as `null` and every ticket would look like it had no
  // journal at all.
  if ('arrayValue' in v) {
    const values = ((v.arrayValue ?? {}) as { values?: Record<string, unknown>[] }).values ?? []
    return values.map(fromField)
  }
  if ('mapValue' in v) return fromDoc(v.mapValue as Record<string, unknown>)
  return null
}

function fromDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const fields = (doc.fields ?? {}) as Record<string, Record<string, unknown>>
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) result[k] = fromField(v)
  return result
}

export async function createSubmission(
  projectId: string,
  token: string,
  trigram: string,
  data: Record<string, unknown>,
): Promise<string> {
  const dbPath = `projects/${projectId}/databases/(default)`
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // Begin transaction so counter increment + submission write are atomic
  const txRes = await fetch(`${BASE}/${dbPath}/documents:beginTransaction`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ options: { readWrite: {} } }),
  })
  if (!txRes.ok) throw new Error(`beginTransaction: ${await txRes.text()}`)
  const { transaction } = (await txRes.json()) as { transaction: string }

  // Read the current counter for this trigram
  const counterUrl = `${BASE}/${docName(projectId, 'counters', trigram)}?transaction=${encodeURIComponent(transaction)}`
  const counterRes = await fetch(counterUrl, { headers: auth })

  let count = 0
  if (counterRes.ok) {
    const doc = (await counterRes.json()) as Record<string, unknown>
    count = ((fromDoc(doc).count as number) ?? 0)
  } else if (counterRes.status !== 404) {
    throw new Error(`Counter read: ${await counterRes.text()}`)
  }

  const newCount = count + 1
  const ref = `${trigram}-${String(newCount).padStart(4, '0')}`

  // Commit: update counter + write submission in one transaction
  const commitRes = await fetch(`${BASE}/${dbPath}/documents:commit`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      transaction,
      writes: [
        { update: toDoc(docName(projectId, 'counters', trigram), { count: newCount }) },
        { update: toDoc(docName(projectId, 'submissions', ref), { ...data, ref }) },
      ],
    }),
  })
  if (!commitRes.ok) throw new Error(`Commit: ${await commitRes.text()}`)

  return ref
}

export async function listSubmissions(
  projectId: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  const url = `${BASE}/projects/${projectId}/databases/(default)/documents:runQuery`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'submissions' }],
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
        limit: 200,
      },
    }),
  })
  if (!res.ok) throw new Error(`Query failed: ${await res.text()}`)
  const results = (await res.json()) as { document?: Record<string, unknown> }[]
  return results.filter(r => r.document).map(r => fromDoc(r.document!))
}

/**
 * Fields a submission update may touch. `null` clears a field (written as a
 * Firestore null, which `fromField` reads back as `null`) — that's how
 * `resolvedAt` / `closedAt` are cleared when a ticket moves back off
 * `resolved` / `closed`.
 *
 * `workNotes` is absent on purpose: the journal is append-only and goes
 * through `appendWorkNote`, never a whole-field overwrite.
 */
export interface SubmissionUpdate {
  status?: string
  /** LEGACY single-string note, kept so old text survives — see lib/worknotes.ts. */
  notes?: string
  closureCode?: string | null
  closureNote?: string | null
  resolvedAt?: Date | null
  closedAt?: Date | null
  autoClosed?: boolean | null
}

export async function updateSubmission(
  projectId: string,
  token: string,
  ref: string,
  updates: SubmissionUpdate,
): Promise<void> {
  const fields = Object.keys(updates).filter(k => updates[k as keyof SubmissionUpdate] !== undefined)
  if (fields.length === 0) return

  const docFields: Record<string, unknown> = {}
  for (const f of fields) docFields[f] = toField(updates[f as keyof SubmissionUpdate])

  const mask = fields.map(f => `updateMask.fieldPaths=${f}`).join('&')
  const res = await fetch(`${BASE}/${docName(projectId, 'submissions', ref)}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: docName(projectId, 'submissions', ref), fields: docFields }),
  })
  if (!res.ok) throw new Error(`Update failed: ${await res.text()}`)
}

/**
 * Adds one entry to a ticket's `workNotes` journal.
 *
 * This deliberately doesn't read-modify-write the array: it uses Firestore's
 * `appendMissingElements` transform, so the append happens server-side in one
 * atomic call. Two updates written at once can't overwrite each other, and no
 * note can ever be lost to a stale copy of the list. (Set semantics also mean
 * a double-tapped "add" with the same text *and* the same timestamp lands
 * once, which is the behaviour you want.)
 *
 * `exists: true` stops a typo'd ref from conjuring a document that is nothing
 * but a work note — Firestore's PATCH would otherwise create one.
 */
export async function appendWorkNote(
  projectId: string,
  token: string,
  ref: string,
  note: { at: Date; text: string },
): Promise<void> {
  const res = await fetch(`${BASE}/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: docName(projectId, 'submissions', ref),
          fieldTransforms: [{
            fieldPath: 'workNotes',
            appendMissingElements: { values: [toField({ at: note.at, text: note.text })] },
          }],
        },
        currentDocument: { exists: true },
      }],
    }),
  })
  if (!res.ok) throw new Error(`Work note append failed: ${await res.text()}`)
}

/**
 * Applies many partial submission updates in a single Firestore commit —
 * used by the status sweep so a batch of auto-closes costs one write call
 * instead of one per ticket. Each entry carries its own field mask, so only
 * the named fields are touched.
 */
export async function commitSubmissionUpdates(
  projectId: string,
  token: string,
  updates: { ref: string; fields: SubmissionUpdate }[],
): Promise<void> {
  const writes = updates
    .map(({ ref, fields }) => {
      const keys = Object.keys(fields).filter(k => fields[k as keyof SubmissionUpdate] !== undefined)
      if (keys.length === 0) return null
      const data: Record<string, unknown> = {}
      for (const k of keys) data[k] = fields[k as keyof SubmissionUpdate]
      return {
        update: toDoc(docName(projectId, 'submissions', ref), data),
        updateMask: { fieldPaths: keys },
      }
    })
    .filter(Boolean)
  if (writes.length === 0) return

  const res = await fetch(`${BASE}/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  })
  if (!res.ok) throw new Error(`Batch update failed: ${await res.text()}`)
}
