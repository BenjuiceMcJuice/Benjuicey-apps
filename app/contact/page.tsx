export default function Contact() {
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
        {/*
          Replace the action URL with your own endpoint.
          Easy options:
            - Formspree: https://formspree.io  (free tier available)
            - Resend:    https://resend.com
          Example Formspree action: "https://formspree.io/f/YOUR_FORM_ID"
        */}
        <form
          className="contact-form pixel-box"
          action="https://formspree.io/f/mdavveyq"
          method="POST"
        >
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
              <option value="request">i want to request something</option>
              <option value="bug">found a bug</option>
              <option value="collab">want to collab</option>
              <option value="hi">just saying hi</option>
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

          <button className="form-submit" type="submit">
            SEND IT →
          </button>
        </form>

      </div>
    </main>
  )
}
