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
// Disaster). They're BCC'd — so they receive the email but their address is
// kept private (never shown in the header to Ben or anyone else) — and named
// by first name only in a "has also been notified" line, so it's visible they
// were looped in without exposing their email.
export async function sendAdminNotification(
  apiKey: string,
  adminEmail: string,
  sub: { ref: string; appName: string; type: string; name: string; email: string; message: string; contactConsent?: boolean },
  extraRecipients: { email: string; name: string }[] = [],
): Promise<void> {
  const key = resendKey(apiKey)
  if (!key || !adminEmail) return // Resend not configured — skip silently
  const from = sub.email ? escapeHtml(sub.name) + ' &lt;' + escapeHtml(sub.email) + '&gt;' : escapeHtml(sub.name) + ' (no email given)'
  // Tell the reader whether they're allowed to reply to this person.
  const consentLine = sub.email
    ? (sub.contactConsent
        ? `<p style="color:#16a34a">✓ Happy to be contacted — you may reply.</p>`
        : `<p style="color:#b45309">✕ Did not opt in to being contacted — please don't reply directly.</p>`)
    : ''
  const bcc = extraRecipients.map(r => r.email).filter(Boolean)
  const notifiedLine = extraRecipients.length
    ? `<p style="color:#555">🔔 ${extraRecipients.map(r => escapeHtml(r.name)).join(', ')} ${extraRecipients.length > 1 ? 'have' : 'has'} also been notified of this ${escapeHtml(sub.appName)} feedback.</p>`
    : ''
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Sends from the verified whatadisaster.uk domain on Resend, so mail
      // delivers to any recipient (ADMIN_EMAIL and BCC'd extras like Heather),
      // not just the Resend account owner.
      from: 'Benjuicey Feedback <feedback@whatadisaster.uk>',
      to: adminEmail,
      bcc: bcc.length ? bcc : undefined,
      // Only make one-tap reply available if they opted in to being contacted.
      reply_to: sub.contactConsent && sub.email ? sub.email : undefined,
      subject: `[${sub.ref}] New ${sub.type} feedback — ${sub.appName}`,
      html: `<p><strong>${escapeHtml(sub.appName)}</strong> — new <strong>${escapeHtml(sub.type)}</strong> feedback (${sub.ref})</p>
<p><strong>From:</strong> ${from}</p>
${consentLine}<p><strong>Message:</strong></p>
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
      from: 'Ben <feedback@whatadisaster.uk>',
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
