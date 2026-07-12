'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export default function Contact() {
  const [status, setStatus] = useState<Status>('idle')
  const [ref, setRef] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')

    const form = e.currentTarget
    const data = {
      appId: 'portfolio',
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      type: (form.elements.namedItem('type') as HTMLSelectElement).value,
      message: (form.elements.namedItem('message') as HTMLTextAreaElement).value,
    }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_FEEDBACK_API_URL}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      )
      const json = (await res.json()) as { success?: boolean; ref?: string }
      if (res.ok && json.success) {
        setRef(json.ref ?? '')
        setStatus('success')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <main className="page-wrapper">
        <div className="hero pixel-box">
          <h1 className="hero-title pixel-font">got it!</h1>
          <p className="hero-sub retro-font">
            your message has been logged as <strong>{ref}</strong>.<br />
            i&apos;ll take a look and get back to you if needed.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="page-wrapper">
      <div className="hero pixel-box">
        <h1 className="hero-title pixel-font">got a request?</h1>
        <p className="hero-sub retro-font">
          want to see something built? found a bug? just wanna say hi?<br />
          drop a message below and i&apos;ll get back to you.
        </p>
      </div>

      <div className="contact-form-wrapper">
        <form className="contact-form pixel-box" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label pixel-font" htmlFor="name">
              YOUR NAME
            </label>
            <input
              className="form-input"
              type="text"
              id="name"
              name="name"
              placeholder="what do i call you"
              required
              autoComplete="name"
            />
          </div>

          <div className="form-field">
            <label className="form-label pixel-font" htmlFor="email">
              YOUR EMAIL (optional)
            </label>
            <input
              className="form-input"
              type="email"
              id="email"
              name="email"
              placeholder="if you want a reply"
              autoComplete="email"
            />
          </div>

          <div className="form-field">
            <label className="form-label pixel-font" htmlFor="type">
              WHAT&apos;S THIS ABOUT
            </label>
            <select className="form-select" id="type" name="type">
              <option value="bug">found a bug</option>
              <option value="content">something&apos;s wrong / unclear</option>
              <option value="request">i want to request something</option>
              <option value="general">just saying hi</option>
            </select>
          </div>

          <div className="form-field">
            <label className="form-label pixel-font" htmlFor="message">
              MESSAGE
            </label>
            <textarea
              className="form-textarea"
              id="message"
              name="message"
              placeholder="go ahead..."
              required
            />
          </div>

          {status === 'error' && (
            <p className="retro-font" style={{ color: 'red', fontSize: '0.9rem' }}>
              something went wrong — try again in a moment.
            </p>
          )}

          <button
            className="form-submit"
            type="submit"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'SENDING...' : 'SEND IT →'}
          </button>
        </form>
      </div>
    </main>
  )
}
