function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Notifies the admin (Ben) of every new submission. Fire-and-forget:
// caller wraps this so a failure never fails the submission.
export async function sendAdminNotification(
  apiKey: string,
  adminEmail: string,
  sub: { ref: string; appName: string; type: string; name: string; email: string; message: string },
): Promise<void> {
  if (!apiKey || !adminEmail) return // not configured yet — skip silently
  const from = sub.email ? escapeHtml(sub.name) + ' &lt;' + escapeHtml(sub.email) + '&gt;' : escapeHtml(sub.name) + ' (no email given)'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: swap to a verified domain once DNS is set up on Resend.
      // Until then, onboarding@resend.dev only delivers to the Resend
      // account owner's own email — so ADMIN_EMAIL must be that address.
      from: 'Benjuicey Feedback <onboarding@resend.dev>',
      to: adminEmail,
      reply_to: sub.email || undefined,
      subject: `[${sub.ref}] New ${sub.type} feedback — ${sub.appName}`,
      html: `<p><strong>${escapeHtml(sub.appName)}</strong> — new <strong>${escapeHtml(sub.type)}</strong> feedback (${sub.ref})</p>
<p><strong>From:</strong> ${from}</p>
<p><strong>Message:</strong></p>
<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333">${escapeHtml(sub.message)}</blockquote>
<p>Manage it in the admin dashboard.</p>`,
    }),
  })
  if (!res.ok) console.error(`Resend admin notify failed (${res.status}): ${await res.text()}`)
}

// Notifies the admin (Ben) via Formspree instead of Resend. This is the
// zero-setup path: Formspree needs no verified domain and no API-key secret —
// just the public form endpoint (https://formspree.io/f/xxxx), which Formspree
// emails to whatever address the form is configured to notify. Fire-and-forget:
// caller wraps this so a failure never fails the submission.
export async function sendFormspreeNotification(
  endpoint: string,
  sub: { ref: string; appName: string; type: string; name: string; email: string; message: string },
): Promise<void> {
  if (!endpoint) return // not configured yet — skip silently

  // Formspree treats a field literally named `email` as the reply-to and
  // VALIDATES it as an address — so only include it when the submitter
  // actually gave one, otherwise Formspree rejects the whole submission and
  // no notification is sent (exactly when anonymous feedback comes in). For
  // anonymous submissions we record the fact in a non-special field instead.
  const payload: Record<string, unknown> = {
    _subject: `[${sub.ref}] New ${sub.type} feedback — ${sub.appName}`,
    ref: sub.ref,
    app: sub.appName,
    type: sub.type,
    name: sub.name,
    message: sub.message,
  }
  if (sub.email) payload.email = sub.email // Formspree uses this as reply-to
  else payload.submitter_email = '(none given)'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) console.error(`Formspree notify failed (${res.status}): ${await res.text()}`)
}

export async function sendConfirmation(
  apiKey: string,
  to: string,
  name: string,
  ref: string,
  appName: string,
): Promise<void> {
  if (!apiKey) return // not configured yet — skip silently
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: replace with a verified domain once DNS is set up on Resend
      from: 'Ben <onboarding@resend.dev>',
      to,
      subject: `[${ref}] Got your message`,
      html: `<p>Hi ${escapeHtml(name)},</p>
<p>Thanks for getting in touch. Your message has been logged as <strong>${ref}</strong> on ${escapeHtml(appName)}.</p>
<p>I'll take a look and get back to you if needed.</p>
<p>— Ben</p>`,
    }),
  })
  // Email failure is logged but doesn't break the submission
  if (!res.ok) console.error(`Resend failed (${res.status}): ${await res.text()}`)
}
