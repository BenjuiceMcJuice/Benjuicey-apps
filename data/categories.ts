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
    id: 'games',
    name: 'Games & Fun',
    emoji: '🕹️',
    color: '#e8734a',
    apps: [
      {
        id: 'game-1',
        name: 'App Name Here',
        description: 'A quick description of what this does. Keep it honest and short.',
        url: '#',
        status: 'live',
      },
      {
        id: 'game-2',
        name: 'Another Thing',
        description: 'This one is a bit experimental. Works on desktop, probably not mobile.',
        url: '#',
        status: 'wip',
      },
      {
        id: 'game-3',
        name: 'Third One',
        description: "Built this in a weekend. Surprisingly it still works.",
        url: '#',
        status: 'live',
      },
    ],
  },
  {
    id: 'tools',
    name: 'Actually Useful',
    emoji: '🔧',
    color: '#5bb8a8',
    apps: [
      {
        id: 'tool-1',
        name: 'Some Tool',
        description: 'Made this to solve a problem I had. Maybe it helps you too.',
        url: '#',
        status: 'live',
      },
      {
        id: 'tool-2',
        name: 'Another Tool',
        description: 'Does one thing and does it well. Or at least that was the idea.',
        url: '#',
        status: 'live',
      },
    ],
  },
  {
    id: 'projects',
    name: 'Side Projects',
    emoji: '🌱',
    color: '#9b7dd4',
    apps: [
      {
        id: 'proj-1',
        name: 'WIP Thing',
        description: "Still building this. About 60% done, 40% sure about the idea.",
        url: '#',
        status: 'wip',
      },
      {
        id: 'proj-2',
        name: 'Placeholder Project',
        description: 'This one has a longer description to fill space while I figure out what to write.',
        url: '#',
        status: 'live',
      },
    ],
  },
]
