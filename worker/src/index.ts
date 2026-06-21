import { getAccessToken } from './auth'
import { createSubmission, listSubmissions, updateSubmission } from './firestore'
import { sendConfirmation } from './email'
import { getTrigram, APP_NAMES } from './trigrams'

export interface Env {
  GOOGLE_SERVICE_ACCOUNT_JSON: string
  RESEND_API_KEY: string
  FIRESTORE_PROJECT_ID: string
  ALLOWED_ORIGINS: string
  ADMIN_PASSWORD: string
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
        const ref = await createSubmission(env.FIRESTORE_PROJECT_ID, token, trigram, {
          appId, trigram, type: type ?? 'general', status: 'open',
          name: name.trim(), email: email?.trim() ?? '', message: message.trim(),
          timestamp: new Date(), notes: '',
        })

        if (email?.trim()) {
          await sendConfirmation(env.RESEND_API_KEY, email.trim(), name.trim(), ref, APP_NAMES[appId] ?? appId)
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
    if (request.method === 'GET' && url.pathname === '/admin/submissions') {
      try {
        const token = await authToken(env)
        const submissions = await listSubmissions(env.FIRESTORE_PROJECT_ID, token)
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
    if (request.method === 'PATCH' && url.pathname.startsWith('/admin/submissions/')) {
      try {
        const ref = url.pathname.split('/').pop()!
        const updates = (await request.json()) as { status?: string; notes?: string }
        const token = await authToken(env)
        await updateSubmission(env.FIRESTORE_PROJECT_ID, token, ref, updates)
        return new Response(JSON.stringify({ success: true }), {
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
}
