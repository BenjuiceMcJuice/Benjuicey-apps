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
