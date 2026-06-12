import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['var(--font-pixel)', 'monospace'],
        retro: ['var(--font-retro)', 'monospace'],
      },
      colors: {
        cream: '#f4ede0',
        'card-bg': '#fefcf5',
        dark: '#2c2c3a',
      },
    },
  },
  plugins: [],
}

export default config
