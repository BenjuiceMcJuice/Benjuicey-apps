export async function sendStatusUpdate(
  apiKey: string,
  to: string,
  name: string,
  ref: string,
  status: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: replace with a verified domain once DNS is set up on Resend
      from: 'Ben <onboarding@resend.dev>',
      to,
      subject: `[${ref}] Update: ${status}`,
      html: `<p>Hi ${name},</p>
<p>Your submission <strong>${ref}</strong> has been updated to <strong>${status}</strong>.</p>
<p>— Ben</p>`,
    }),
  })
  // Email failure is logged but doesn't break the update
  if (!res.ok) console.error(`Resend failed (${res.status}): ${await res.text()}`)
}
