import { categories } from '@/data/categories'
import { AppCard } from '@/components/AppCard'

export default function Home() {
  return (
    <main className="page-wrapper">
      <div className="hero pixel-box">
        <h1 className="hero-title pixel-font">benjuicey&apos;s apps</h1>
        <p className="hero-sub retro-font">
          stuff i made, mostly for fun.<br />
          some of it works great. some of it... works.
        </p>
      </div>

      {categories.map((cat) => (
        <section key={cat.id} className="category-section">
          <div className="category-header">
            <h2 className="category-title pixel-font">
              {cat.emoji} {cat.name}
            </h2>
            <div className="category-line" style={{ backgroundColor: cat.color }} />
          </div>
          <div className="cards-grid">
            {cat.apps.map((app) => (
              <AppCard key={app.id} app={app} accentColor={cat.color} />
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
