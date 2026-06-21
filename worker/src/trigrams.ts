export const TRIGRAMS: Record<string, string> = {
  portfolio: 'BEJ',
  betalog: 'BTL',
  ironlog: 'IRN',
  walkwithme: 'WLK',
  whatadisaster: 'WDA',
  'ai-literate': 'LIT',
  dungeonofmontor: 'DOM',
  benmed: 'MED',
}

export const APP_NAMES: Record<string, string> = {
  portfolio: 'Benjuicey Apps',
  betalog: 'BetaLog',
  ironlog: 'IronLog',
  walkwithme: 'Walk With Me',
  whatadisaster: 'What a Disaster',
  'ai-literate': 'AI-Literate',
  dungeonofmontor: 'Dungeon of Montor',
  benmed: 'BenMed',
}

export function getTrigram(appId: string): string | null {
  return TRIGRAMS[appId.toLowerCase()] ?? null
}
