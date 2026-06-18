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
        id: 'dungeonofmontor',
        name: 'Dungeon of Montor',
        description: 'A roguelike dungeon crawler where you raid a hoarder\'s home.',
        url: 'https://benjuicemcjuice.github.io/dungeonofmontor',
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
        id: 'hometraining',
        name: 'HomeTraining McTrainingface',
        description: 'Home training app.',
        url: 'https://benjuicemcjuice.github.io/HomeTrainingMcTrainingface',
        status: 'live',
      },
      {
        id: 'benmed',
        name: 'BenMed',
        description: 'TODO: add description.',
        url: 'https://benjuicemcjuice.github.io/BenMed',
        status: 'live',
      },
      {
        id: 'walkwithme',
        name: 'Walk With Me',
        description: 'TODO: add description.',
        url: 'https://benjuicemcjuice.github.io/Walkwithme',
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
        id: 'ai-literate',
        name: 'AI Literate',
        description: 'A practical, no-nonsense guide to using AI tools well.',
        url: 'https://benjuicemcjuice.github.io/ai-literate',
        status: 'live',
      },
      {
        id: 'whatadisaster',
        name: 'What a Disaster',
        description: 'TODO: add description.',
        url: 'https://whatadisaster.uk',
        status: 'live',
      },
    ],
  },
]
