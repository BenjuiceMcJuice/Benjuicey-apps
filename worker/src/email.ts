function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Returns a usable Resend key, or null if Resend isn't really configured.
// Real Resend keys start with "re_"; anything else — unset, a "skip"
// placeholder, or a value with a stray BOM/whitespace — is treated as OFF so
// we don't fire (and log) doomed 400s when only Formspree is in use.
function resendKey(apiKey: string): string | null {
  const k = (apiKey ?? '').replace(/^﻿/, '').trim()
  return k.startsWith('re_') ? k : null
}

// Notifies the admin (Ben) of every new submission. Fire-and-forget:
// caller wraps this so a failure never fails the submission.
//
// `extraRecipients` are per-app additional notifiers (e.g. Heather for What a
// Disaster). They're CC'd on the same email, and — so everyone can see the
// feedback wasn't only sent to Ben — named in a "has also been notified" line.
//
// ⚠️ Delivery caveat: while Resend is in test mode (onboarding@resend.dev
// sender), Resend only delivers to the account owner's own address, so any
// extra recipient is silently dropped by Resend until a domain is verified.
export async function sendAdminNotification(
  apiKey: string,
  adminEmail: string,
  sub: { ref: string; appName: string; type: string; name: string; email: string; message: string },
  extraRecipients: { email: string; name: string }[] = [],
): Promise<void> {
  const key = resendKey(apiKey)
  if (!key || !adminEmail) return // Resend not configured — skip silently
  const from = sub.email ? escapeHtml(sub.name) + ' &lt;' + escapeHtml(sub.email) + '&gt;' : escapeHtml(sub.name) + ' (no email given)'
  const cc = extraRecipients.map(r => r.email).filter(Boolean)
  const notifiedLine = extraRecipients.length
    ? `<p style="color:#555">🔔 ${extraRecipients.map(r => escapeHtml(r.name)).join(', ')} ${extraRecipients.length > 1 ? 'have' : 'has'} also been notified of this ${escapeHtml(sub.appName)} feedback.</p>`
    : ''
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: swap to a verified domain once DNS is set up on Resend.
      // Until then, onboarding@resend.dev only delivers to the Resend
      // account owner's own email — so ADMIN_EMAIL must be that address, and
      // `cc` recipients (e.g. Heather) won't actually receive mail yet.
      from: 'Benjuicey Feedback <onboarding@resend.dev>',
      to: adminEmail,
      cc: cc.length ? cc : undefined,
      reply_to: sub.email || undefined,
      subject: `[${sub.ref}] New ${sub.type} feedback — ${sub.appName}`,
      html: `<p><strong>${escapeHtml(sub.appName)}</strong> — new <strong>${escapeHtml(sub.type)}</strong> feedback (${sub.ref})</p>
<p><strong>From:</strong> ${from}</p>
<p><strong>Message:</strong></p>
<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333">${escapeHtml(sub.message)}</blockquote>
${notifiedLine}<p>Manage it in the admin dashboard.</p>`,
    }),
  })
  if (!res.ok) console.error(`Resend admin notify failed (${res.status}): ${await res.text()}`)
}

export async function sendConfirmation(
  apiKey: string,
  to: string,
  name: string,
  ref: string,
  appName: string,
  // Names of anyone besides Ben who's been looped in (e.g. Heather for What a
  // Disaster). Lets the submitter know who else has seen their feedback.
  alsoNotified: string[] = [],
): Promise<void> {
  const key = resendKey(apiKey)
  if (!key) return // Resend not configured — skip silently
  const notifiedLine = alsoNotified.length
    ? `<p>${alsoNotified.map(escapeHtml).join(' and ')}, who ${alsoNotified.length > 1 ? 'help' : 'helps'} run ${escapeHtml(appName)}, ${alsoNotified.length > 1 ? 'have' : 'has'} also been notified.</p>`
    : ''
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: replace with a verified domain once DNS is set up on Resend
      from: 'Ben <onboarding@resend.dev>',
      to,
      subject: `[${ref}] Got your message`,
      html: `<p>Hi ${escapeHtml(name)},</p>
<p>Thanks for getting in touch. Your message has been logged as <strong>${ref}</strong> on ${escapeHtml(appName)}.</p>
${notifiedLine}<p>I'll take a look and get back to you if needed.</p>
<p>— Ben</p>`,
    }),
  })
  // Email failure is logged but doesn't break the submission
  if (!res.ok) console.error(`Resend failed (${res.status}): ${await res.text()}`)
}
