export async function sendConfirmation(
  apiKey: string,
  to: string,
  name: string,
  ref: string,
  appName: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // TODO: replace with a verified domain once DNS is set up on Resend
      from: 'Ben <onboarding@resend.dev>',
      to,
      subject: `[${ref}] Got your message`,
      html: `<p>Hi ${name},</p>
<p>Thanks for getting in touch. Your message has been logged as <strong>${ref}</strong> on ${appName}.</p>
<p>I'll take a look and get back to you if needed.</p>
<p>— Ben</p>`,
    }),
  })
  // Email failure is logged but doesn't break the submission
  if (!res.ok) console.error(`Resend failed (${res.status}): ${await res.text()}`)
}
