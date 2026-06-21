export type AppStatus = 'live' | 'wip' | 'broken'

export type App = {
  id: string
  name: string
  description: string
  url: string
  status?: AppStatus
}

export type Category = {
  id: string
  name: string
  emoji: string
  color: string
  apps: App[]
}

export const categories: Category[] = [
  {
    id: 'health',
    name: 'Health & Training',
    emoji: '💪',
    color: '#5bb8a8',
    apps: [
      {
        id: 'betalog',
        name: 'BetaLog',
        description: 'Climbing training PWA. Log sessions, track grade progression, run hangboard timers, and get AI coaching.',
        url: 'https://betalog.co.uk',
        status: 'live',
      },
      {
        id: 'whatadisaster',
        name: 'What a Disaster',
        description: 'Emergency exercise simulator for multi-agency fire and heatwave response training.',
        url: 'https://whatadisaster.uk',
        status: 'live',
      },
    ],
  },
  {
    id: 'tools',
    name: 'Actually Useful',
    emoji: '🔧',
    color: '#9b7dd4',
    apps: [
      {
        id: 'ai-literate',
        name: 'AI-Literate',
        description: 'A practical, no-nonsense guide to understanding AI. What it is, what it isn\'t, and how to use it.',
        url: 'https://ai-literate.uk',
        status: 'live',
      },
    ],
  },
  {
    id: 'games',
    name: 'Games & Fun',
    emoji: '🕹️',
    color: '#e8734a',
    apps: [
      {
        id: 'dungeonofmontor',
        name: 'Dungeon of Montor',
        description: 'A roguelike dungeon crawler where you raid a hoarder\'s home. Built in a weekend. Still works.',
        url: 'https://benjuicemcjuice.github.io/dungeonofmontor',
        status: 'live',
      },
    ],
  },
]
