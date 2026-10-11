// One reading of the context: a model request's input side (`tokens`) and
// what it wrote (`output`). `isTurnEnd` marks the last request of a turn.
export type WeatherSample = {
  at: number
  tokens: number
  output: number
  isCompaction: boolean
  isTurnEnd: boolean
}

export type WeatherLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type WeatherCategory = { name: string; tokens: number }

export type WeatherReading = {
  window: number
  threshold: number | null
  limits: WeatherLimit[]
  usd: number | null
  startedAt: number
  measuredAt: number
  categories: WeatherCategory[]
}

// How the band above the prompt shows: both rows, one compact row, or not at all.
export type BandMode = 'full' | 'compact' | 'hidden'

export type WeatherTurn = { input: number; output: number; cacheRead: number; cacheWrite: number }

declare module 'claude-code' {
  interface PluginState {
    'context-forecast': {
      samples: WeatherSample[]
      reading: WeatherReading | null
      lastTurn: WeatherTurn | null
      bandMode: BandMode
      lastLevel: number
    }
  }
}
