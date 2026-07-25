import { getAccessToken } from './auth'
import { createSubmission, listSubmissions, updateSubmission, SubmissionUpdate } from './firestore'
import { sendConfirmation, sendAdminNotification } from './email'
import { getTrigram, APP_NAMES } from './trigrams'
import { WIDGET_JS } from './widget'
import { runStatusSweep } from './sweep'
import {
  AUTO_CLOSE_DAYS, SELECTABLE_CLOSURE_CODES, SETTABLE_STATUSES,
  isClosureCode, isStatus, normaliseClosureNote,
} from '../../lib/status'

export interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string
  RESEND_API_KEY: string
  FIRESTORE_PROJECT_ID: string
  ALLOWED_ORIGINS: string
  ADMIN_PASSWORD: string
  ADMIN_EMAIL: string
}

function corsHeaders(origin: string, allowedOriginsEnv: string): HeadersInit {
  const allowed = allowedOriginsEnv.split(',').map(o => o.trim())
  const allowedOrigin = allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
  }
}

function authToken(env: Env): Promise<string> {
  return getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON.replace(/^﻿/, ''))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS)
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // ── GET /widget.js ──────────────────────────────────────────────
    // Public embeddable script — any app's origin may load it, so this
    // isn't gated by ALLOWED_ORIGINS the way fetch()/XHR calls are.
    if (request.method === 'GET' && url.pathname === '/widget.js') {
      return new Response(WIDGET_JS, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      })
    }

    // ── POST /submit ──────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/submit') {
      try {
        const body = (await request.json()) as {
          appId?: string; name?: string; email?: string; type?: string; message?: string
        }
        const { appId, name, email, type, message } = body

        if (!appId || !name?.trim() || !message?.trim()) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

        const trigram = getTrigram(appId)
        if (!trigram) {
          return new Response(JSON.stringify({ error: 'Unknown appId' }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
          })
        }

        const token = await authToken(env)
        // Every ticket starts at `new` — the first state of the status
        // workflow (new → in-progress/pending → resolved → closed).
        const ref = await createSubmission(env.FIRESTORE_PROJECT_ID, token, trigram, {
          appId, trigram, type: type ?? 'general', status: 'new',
          name: name.trim(), email: email?.trim() ?? '', message: message.trim(),
          timestamp: new Date(), notes: '',
          closureCode: null, closureNote: null,
          resolvedAt: null, closedAt: null, autoClosed: null,
        })

        // Emails are best-effort — a failure here must NOT fail a submission
        // that has already been written to Firestore.
        try {
          const notify = {
            ref, appName: APP_NAMES[appId] ?? appId, type: type ?? 'general',
            name: name.trim(), email: email?.trim() ?? '', message: message.trim(),
          }
          // Resend is the admin-notification channel: an email API built for
          // server-side sending, so it doesn't spam-filter our own mail the
          // way Formspree did (see DEVLOG 2026-07-14 session 2). Dormant until
          // a real `re_` RESEND_API_KEY secret is set.
          await sendAdminNotification(env.RESEND_API_KEY, env.ADMIN_EMAIL, notify)
          if (email?.trim()) {
            await sendConfirmation(env.RESEND_API_KEY, email.trim(), name.trim(), ref, APP_NAMES[appId] ?? appId)
          }
        } catch (emailErr) {
          console.error('email send failed (submission still saved)', emailErr)
        }

        return new Response(JSON.stringify({ success: true, ref }), {
          status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        console.error(err)
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Admin auth check ──────────────────────────────────────────
    if (url.pathname.startsWith('/admin/')) {
      if (request.headers.get('x-admin-password') !== env.ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── GET /admin/submissions ─────────────────────────────────────
    // Sweeps before returning, so the dashboard never shows a ticket that
    // should already have auto-closed (and so legacy statuses get rewritten
    // the first time they're read). The sweep works off the list we just
    // fetched — no extra reads, and no writes at all unless something is due.
    if (request.method === 'GET' && url.pathname === '/admin/submissions') {
      try {
        const token = await authToken(env)
        const listed = await listSubmissions(env.FIRESTORE_PROJECT_ID, token)
        const { submissions, plan } = await runStatusSweep(env.FIRESTORE_PROJECT_ID, token, listed)
        if (plan.length) console.log(`status sweep: ${plan.map(p => `${p.ref}=${p.reason}`).join(', ')}`)
        return new Response(JSON.stringify(submissions), {
          status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        console.error(err)
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── PATCH /admin/submissions/:ref ──────────────────────────────
    // Status transitions are policed here: `closed` is not settable — a
    // ticket is marked `resolved` and closes itself AUTO_CLOSE_DAYS later
    // (see ./sweep.ts), which leaves a window to test the fix.
    if (request.method === 'PATCH' && url.pathname.startsWith('/admin/submissions/')) {
      try {
        const ref = url.pathname.split('/').pop()!
        const body = (await request.json()) as {
          status?: string; notes?: string; closureCode?: string; closureNote?: string
        }
        const patch: SubmissionUpdate = {}
        const bad = (error: string) => new Response(JSON.stringify({ error }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        })

        if (body.notes !== undefined) patch.notes = String(body.notes)

        // A closure code (or note) on its own is how you correct the "why" of
        // an already-resolved (or closed) ticket without touching its status
        // or restarting the auto-close clock.
        if (body.closureCode !== undefined && !isClosureCode(body.closureCode)) {
          return bad(`Unknown closure code "${body.closureCode}". Valid values: ${SELECTABLE_CLOSURE_CODES.join(', ')}.`)
        }
        if (body.closureCode !== undefined) patch.closureCode = body.closureCode
        // Optional free text; blank means "no note", and it's length-capped.
        if (body.closureNote !== undefined) patch.closureNote = normaliseClosureNote(body.closureNote)

        if (body.status !== undefined) {
          const status = body.status
          // The two ends of the lifecycle are the system's to assign.
          if (status === 'new') {
            return bad('Cannot set "new" — it marks a ticket nobody has looked at yet, and is stamped on arrival. Use "in-progress" or "pending" instead.')
          }
          if (status === 'closed') {
            return bad(`Cannot set "closed" directly — mark the ticket "resolved" and it auto-closes after ${AUTO_CLOSE_DAYS} days.`)
          }
          if (!isStatus(status) || !SETTABLE_STATUSES.includes(status)) {
            return bad(`Unknown status "${status}". Valid values: ${SETTABLE_STATUSES.join(', ')}.`)
          }
          // Resolving must say why, in the same request — otherwise a ticket
          // could end up finished with no explanation, which is the whole
          // point of the field.
          if (status === 'resolved' && patch.closureCode == null) {
            return bad(`Resolving needs a closure code. Send one of: ${SELECTABLE_CLOSURE_CODES.join(', ')}.`)
          }
          patch.status = status
          // Resolving (re-resolving too) starts the auto-close clock;
          // moving back to any other state clears it, so a reopened ticket
          // isn't closed by a stale timestamp — and loses a closure code
          // that no longer applies.
          if (status === 'resolved') {
            patch.resolvedAt = new Date()
          } else {
            patch.resolvedAt = null
            patch.closureCode = null
            patch.closureNote = null
          }
          patch.closedAt = null
          patch.autoClosed = null
        }

        if (patch.status === undefined && patch.notes === undefined
          && patch.closureCode === undefined && patch.closureNote === undefined) {
          return bad('Nothing to update')
        }

        const token = await authToken(env)
        await updateSubmission(env.FIRESTORE_PROJECT_ID, token, ref, patch)
        return new Response(JSON.stringify({
          success: true,
          status: patch.status,
          closureCode: patch.closureCode,
          // Echoed back trimmed/capped, so the UI shows what was stored.
          closureNote: patch.closureNote,
          // Lets the dashboard show the auto-close countdown without a refetch.
          resolvedAt: patch.resolvedAt instanceof Date ? patch.resolvedAt.toISOString() : null,
        }), {
          status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        console.error(err)
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not found', { status: 404, headers: cors })
  },

  // ── Cron: nightly status sweep ─────────────────────────────────────
  // Auto-close doesn't depend on anyone opening the dashboard. The GET
  // handler sweeps too, so this is a safety net rather than the only path;
  // both share one implementation, so a ticket can't be closed twice.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const token = await authToken(env)
    const listed = await listSubmissions(env.FIRESTORE_PROJECT_ID, token)
    const { plan } = await runStatusSweep(env.FIRESTORE_PROJECT_ID, token, listed)
    console.log(plan.length
      ? `scheduled status sweep: ${plan.map(p => `${p.ref}=${p.reason}`).join(', ')}`
      : 'scheduled status sweep: nothing due')
  },
}
