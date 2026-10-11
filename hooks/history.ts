import type { WeatherSample } from '../types'

type Entry = {
  type?: string
  subtype?: string
  isSidechain?: boolean
  isMeta?: boolean
  requestId?: string
  timestamp?: string
  message?: {
    content?: unknown
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

function isPrompt(entry: Entry): boolean {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return false
  const content = entry.message?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.some(b => (b as { type?: string })?.type === 'tool_result')
}

// Rebuilds the context history from a session transcript (JSONL): one sample
// per main-thread model request, the last before each prompt marked a turn's
// end, the first after a compaction boundary marked as the compaction.
export function parseTranscript(text: string): WeatherSample[] {
  const out: WeatherSample[] = []
  const seen = new Set<string>()
  let isAfterCompaction = false
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      isAfterCompaction = true
      continue
    }
    if (isPrompt(entry)) {
      const last = out[out.length - 1]
      if (last) last.isTurnEnd = true
      continue
    }
    const u = entry.message?.usage
    if (entry.type !== 'assistant' || entry.isSidechain || !u) continue
    const id = entry.requestId ?? ''
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    if (tokens <= 0) continue
    const prev = out[out.length - 1]
    out.push({
      at: entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0,
      tokens,
      output: u.output_tokens ?? 0,
      isCompaction: isAfterCompaction || (prev !== undefined && tokens < prev.tokens * 0.7),
      isTurnEnd: false,
    })
    isAfterCompaction = false
  }
  return out.slice(-400)
}

// Where Claude Code keeps a session's transcript.
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sessionId}.jsonl`
}
