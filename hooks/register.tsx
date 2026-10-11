import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { BandMode, WeatherReading, WeatherTurn } from '../types'
import {
  addRequest,
  chartCells,
  chartSvg,
  endTurn,
  fmtIn,
  fmtCount,
  fmtUsd,
  forecast,
  gaugeCells,
  gaugeSvg,
  limitName,
  meter,
  meterSvg,
  PALETTE,
  LEVEL_SPANS,
  panePx,
  scaleSvg,
  PX_PER_CELL,
  severity,
  stackCells,
  stackSvg,
  turnsPhrase,
} from './forecast'
import type { Forecast, Level, Slice } from './forecast'
import { SKY_COLUMNS, skyCells, skySvg } from './sky'
import { parseTranscript, transcriptPath } from './history'

const PANE = 'context-forecast'
const TITLE = 'Context Forecast'

const samples = atom({ plugin: 'context-forecast', key: 'samples' } as const, [])
const reading = atom({ plugin: 'context-forecast', key: 'reading' } as const, null)
const lastTurn = atom({ plugin: 'context-forecast', key: 'lastTurn' } as const, null)
const bandMode = atom({ plugin: 'context-forecast', key: 'bandMode' } as const, 'full' as BandMode)
const lastLevel = atom({ plugin: 'context-forecast', key: 'lastLevel' } as const, -1)

type Api = EngineInterface

// The terminal band's sky is repainted from a timer: where it is mounted and
// what it shows, as of its last drawing.
const sky: { site: string | null; level: Level | null; frame: number } = { site: null, level: null, frame: 0 }

async function tickSky($: Api): Promise<void> {
  try {
    await animateSky($)
  } catch {
    // A missed frame is harmless: the next tick repaints.
  }
}

async function animateSky($: Api): Promise<void> {
  if (!sky.site || !sky.level) return
  sky.frame += 1
  const r = await $.ui.blit({ requestId: sky.site, key: 'sky', cells: skyCells(sky.level, sky.frame) })
  if (r.deny) sky.site = null
}

// ---- gathering ------------------------------------------------------------------

// Rebuilds the history from this session's transcript, so a resumed session or
// a reload starts with its whole past instead of one point.
async function backfill($: Api): Promise<void> {
  try {
    const [id, cwd, root, configDir, home] = await Promise.all([
      $.session.id(),
      $.session.cwd(),
      $.session.root(),
      $.env.get('CLAUDE_CONFIG_DIR'),
      $.env.get('HOME'),
    ])
    const dir = configDir ?? (home ? `${home}/.claude` : null)
    if (!dir) return
    let path: string | null = null
    for (const base of [root, cwd]) {
      const p = transcriptPath(dir, base, id)
      if (await $.fs.exists(p)) {
        path = p
        break
      }
    }
    if (!path) return
    // A transcript over the 4 MiB read bound throws; the forecast then builds
    // from live readings instead of the past.
    const text = await $.fs.read(path)
    const history = parseTranscript(text)
    if (history.length > 0) await update($, samples, () => history)
  } catch {
    // No history to be had: the forecast builds from live readings instead.
  }
}

// Reads the session's figures (and the local /context estimate for the
// auto-compact point and the biggest categories) into state.
async function measure($: Api, isTurnEnd: boolean): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  const next: WeatherReading = {
    window: usage.context.window,
    threshold: b?.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : null,
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    usd: usage.cost?.usd ?? null,
    startedAt: usage.startedAt,
    measuredAt: await $.clock.now(),
    categories: (b?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((x, y) => y.tokens - x.tokens)
      .slice(0, 6)
      .map(c => ({ name: c.name, tokens: c.tokens })),
  }
  await update($, reading, () => next)
  const tokens = usage.context.tokens
  if (isTurnEnd && tokens !== undefined) {
    const at = await $.clock.now()
    await update($, samples, list => endTurn(list, tokens, at))
  }
  await afterMeasure($)
}

async function afterMeasure($: Api): Promise<void> {
  const f = forecast(await read($, samples), await read($, reading))
  if (!f) return
  const before = await read($, lastLevel)
  const rank = f.level.rank
  await update($, lastLevel, () => rank)
  if (rank >= 3 && rank <= 4 && rank > before && before !== -1) {
    const turns = turnsPhrase(f)
    $.ui.toast(`${f.level.icon} ${f.level.name} warning: context ${f.windowPercent}%${turns ? `, ${turns}` : ''}`, {
      timeoutMs: 8000,
    })
  }
}

async function setBandMode($: Api, mode: BandMode): Promise<void> {
  await update($, bandMode, () => mode)
  if (mode === 'hidden') $.ui.toast('Context Forecast hidden · /weather brings it back')
}

async function refresh($: Api): Promise<void> {
  await backfill($)
  await measure($, false)
}

async function togglePane($: Api): Promise<string> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return 'Forecast closed.'
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return 'Forecast opened.'
}

// ---- figures both surfaces show -----------------------------------------------

type Facts = {
  f: Forecast
  r: WeatherReading
  turn: WeatherTurn | null
  now: number
  cacheHit: number | null
  perHour: number | null
  elapsed: number
}

async function facts($: Api): Promise<Facts | null> {
  const r = await read($, reading)
  const f = forecast(await read($, samples), r)
  if (!f || !r) return null
  const turn = await read($, lastTurn)
  const cacheTotal = turn ? turn.input + turn.cacheRead + turn.cacheWrite : 0
  // Cost per hour is taken at the moment of the reading, so the band and the
  // pane always agree.
  const elapsed = Math.max(0, r.measuredAt - r.startedAt)
  return {
    f,
    r,
    turn,
    now: await $.clock.now(),
    cacheHit: turn && cacheTotal > 0 ? Math.round((turn.cacheRead / cacheTotal) * 100) : null,
    perHour: r.usd !== null && elapsed > 5 * 60000 && elapsed < 7 * 86400000 ? r.usd / (elapsed / 3600000) : null,
    elapsed,
  }
}

function turnsLeftShort(f: Forecast): string | null {
  if (f.turnsLeft === null) return null
  return f.turnsLeft === 0 ? 'compacting' : `~${f.turnsLeft} turn${f.turnsLeft === 1 ? '' : 's'} left`
}

// Cells a string takes: emoji and wide characters count two.
function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c === 0xfe0f || c === 0x200d) continue
    n += c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf) || (c >= 0x2e80 && c <= 0xffdc) ? 2 : 1
  }
  return n
}

function resetIn(resetsAt: string | undefined, now: number): string | null {
  const ms = resetsAt ? Date.parse(resetsAt) - now : NaN
  return Number.isFinite(ms) ? fmtIn(ms) : null
}

export function register(on: Parameters<Register>[0]): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'weather',
      description: 'Context Forecast: show the band; `forecast` opens the forecast, `mini` minimizes, `hide` hides',
      argumentHint: '[forecast|mini|hide]',
      immediate: true,
    })
    const ran = await next(e)
    $.ui.status(undefined)
    $.clock.every(450, () => tickSky($))
    await backfill($)
    await measure($, true)
    return ran
  })

  // Every main-thread model request is a reading: the band moves while a long
  // turn runs, not only when it ends.
  on('turn.step', async function* ($, e, next) {
    const ran = yield* next(e)
    const u = ran.usage
    if (e.agentId === undefined && u) {
      const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const at = await $.clock.now()
      await update($, samples, list => addRequest(list, tokens, u.output_tokens, at))
    }
    return ran
  })

  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    await measure($, e.changed.includes('context'))
    return ran
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, samples, () => [])
      await update($, lastTurn, () => null)
      await update($, lastLevel, () => -1)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && e.usage) {
      const u = e.usage
      const turn: WeatherTurn = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      await update($, lastTurn, () => turn)
    }
    return ran
  })

  on('command.run', { command: 'weather' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'forecast') {
      await measure($, false)
      return { text: await togglePane($) }
    }
    if (arg === 'hide') {
      await setBandMode($, 'hidden')
      return { text: 'Context Forecast hidden.' }
    }
    if (arg === 'mini') {
      await setBandMode($, 'compact')
      return { text: 'Context Forecast minimized to the footer.' }
    }
    // Bare /weather brings the band back, whatever state it was in.
    await measure($, false)
    await setBandMode($, 'full')
    return { text: 'Context Forecast band shown.' }
  })

  // ---- the band above the prompt ----------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mode = await read($, bandMode)
    if (e.props.hasSurvey || e.props.view.agentId !== undefined || mode !== 'full') {
      return next(e)
    }
    const x = await facts($)
    const isTerminal = e.surface === 'terminal'
    const openPane = () => void togglePane($)
    const setMode = (m: BandMode) => () => void setBandMode($, m)
    const cols = e.props.bodyColumns

    const { Box, Text, Button } = $.ui.resolve(e)
    const hideButton = (
      <Button key="hide" label="×" role="dismiss" plain onPress={setMode('hidden')} />
    )
    // Minimal controls drawn like the footer's model selector (bare text, a
    // frame only under the pointer): Forecast, a minus that tucks the weather
    // into the footer, a cross that hides it.
    const controls = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Button key="forecast" label="Forecast" plain hotkey={isTerminal ? 'f' : undefined} onPress={openPane} />
        <Button key="mini" label="−" plain hotkey={isTerminal ? 'm' : undefined} onPress={setMode('compact')} />
        {hideButton}
      </Box>
    )

    if (!x) {
      return (
        <Box flexDirection="row" gap={2} alignItems="center">
          <Text>☀️ Context Forecast · the forecast starts with Claude's first reply</Text>
          <Box flexGrow={1} />
          {hideButton}
        </Box>
      )
    }
    const { f, r, now } = x
    const isAlert = f.level.rank >= 3 && f.level.rank <= 4
    const left = turnsLeftShort(f)

    const gauge = (cells: number) => {
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)
        return <Raster key="gauge" {...gaugeCells(f, cells)} />
      }
      const { Svg } = $.ui.resolve(e)
      return (
        <Svg
          source={gaugeSvg(f, cells * PX_PER_CELL)}
          alt={`${Math.round(f.fraction * 100)}% of the way to auto-compact`}
          width={cells * PX_PER_CELL}
          height={20}
        />
      )
    }

    const skyIcon = (size: number) => {
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)
        sky.site = e.requestId
        sky.level = f.level
        return <Raster key="sky" columns={SKY_COLUMNS} rows={1} cells={skyCells(f.level, sky.frame)} />
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg key="sky" source={skySvg(f.level, size)} alt={f.level.name} width={size} height={size} />
    }

    // ---- one line: compact mode, or a band too narrow for the blocks
    if (cols < 60) {
      const head = `${f.windowPercent}% ${f.level.name}`
      const tail = left ? (isAlert ? `⚠ ${left}` : left) : ''
      // The gauge takes whatever the line leaves, so the row spans the band.
      const fixed = SKY_COLUMNS + cellWidth(head) + cellWidth(tail) + (isTerminal ? 16 : 18) + 4 * 3
      const gaugeCells = Math.max(8, Math.min(90, cols - fixed))
      return (
        <Box flexDirection="row" columnGap={3} alignItems="center">
          <Box flexDirection="row" columnGap={1} alignItems="center">
            {skyIcon(20)}
            <Text>
              <Text bold>{f.windowPercent}%</Text>
              <Text> {f.level.name}</Text>
            </Text>
          </Box>
          {cols >= 44 && gauge(gaugeCells)}
          {tail && <Text>{tail}</Text>}
          <Box flexGrow={1} />
          {controls}
        </Box>
      )
    }

    // ---- full: aligned stat blocks, a value over its label, the buttons in a
    // reserved column of their own so the figures never crowd them.
    type Block = { key: string; width: number; node: RenderElement }
    const block = (key: string, value: string, label: string, isStrong = true): Block => ({
      key,
      width: Math.max(cellWidth(value), cellWidth(label)),
      node: (
        <Box key={key} flexDirection="column">
          <Text bold={isStrong}>{value}</Text>
          <Text>{label}</Text>
        </Box>
      ),
    })
    const gaugeWidth = cols >= 110 ? 22 : 16
    const gaugeLabel = left ? `${isAlert ? '⚠ ' : ''}${left}` : 'to auto-compact'
    const head = block('head', `${f.windowPercent}%  ${f.level.name}`, `${fmtCount(f.tokens)} of ${fmtCount(f.window)}`)
    const gaugeBlock: Block = {
      key: 'gauge',
      width: Math.max(gaugeWidth, cellWidth(gaugeLabel)),
      node: (
        <Box key="gauge" flexDirection="column">
          <Box height={1} alignItems="center">
            {gauge(gaugeWidth)}
          </Box>
          <Text>{gaugeLabel}</Text>
        </Box>
      ),
    }
    // Optional blocks, most telling first; each shows only if it fits.
    const optional: Block[] = []
    const limits = [...r.limits].sort((a, b) => b.percentUsed - a.percentUsed)
    for (const l of limits) {
      const reset = resetIn(l.resetsAt, now)
      const warn = l.percentUsed >= 75 ? '⚠ ' : ''
      optional.push(block(`limit-${l.kind}`, `${warn}${Math.round(l.percentUsed)}%`, `${limitName(l.kind)} limit${reset && l.percentUsed >= 50 ? ` · ${reset}` : ''}`))
    }
    if (f.rate !== null) optional.push(block('rate', `+${fmtCount(f.rate)}`, 'per turn'))
    if (r.usd !== null) optional.push(block('cost', fmtUsd(r.usd), x.perHour !== null ? `${fmtUsd(x.perHour)}/h` : 'session'))
    if (x.cacheHit !== null) optional.push(block('cache', `${x.cacheHit}%`, 'cache hit'))

    const GAP = 3
    const buttons = isTerminal ? 16 : 18
    let budget = cols - buttons - SKY_COLUMNS - 2 - head.width - GAP - gaugeBlock.width
    const shown = new Set<string>()
    for (const b of optional) {
      if (b.width + GAP > budget) continue
      shown.add(b.key)
      budget -= b.width + GAP
    }

    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        {skyIcon(28)}
        <Box flexDirection="row" columnGap={GAP} alignItems="flex-start">
          {head.node}
          {gaugeBlock.node}
          {optional.filter(b => shown.has(b.key)).map(b => b.node)}
        </Box>
        <Box flexGrow={1} />
        {controls}
      </Box>
    )
  })

  // ---- minimized: the weather in the prompt footer -----------------------------

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if ((await read($, bandMode)) !== 'compact') return next(e)
    const r = await read($, reading)
    const f = forecast(await read($, samples), r)
    if (!f) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const expand = () => void setBandMode($, 'full')
    // The desktop draws this slot as a mode chip and draws only its text, so
    // the weather rides in the label there; the terminal animates its cells.
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      sky.site = e.requestId
      sky.level = f.level
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Raster key="sky" columns={SKY_COLUMNS} rows={1} cells={skyCells(f.level, sky.frame)} />
          <Button key="expand" label={`${f.windowPercent}%`} plain onPress={expand} />
          {e.props.modes.length > 0 && <Text dimColor> {e.props.modes.join(' & ')}</Text>}
        </Box>
      )
    }
    // Two thin spaces (U+2009, about 0.4 of a cell each) on each side give the
    // chip the model selector's reach; the margin pulls it toward the selector
    // by the measured 2.5px surplus plus the added trailing pad, so the gap
    // between the texts stays the selector-to-effort gap.
    const PAD = '\u2009\u2009'
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1} marginRight={-1.15}>
        <Button key="expand" label={`${PAD}${f.level.icon} ${f.windowPercent}%${PAD}`} plain onPress={expand} />
        {e.props.modes.length > 0 && <Text dimColor> {e.props.modes.join(' & ')}</Text>}
      </Box>
    )
  })

  // ---- the forecast pane ------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const x = await facts($)
    const list = await read($, samples)
    const mode = await read($, bandMode)
    const cols = e.props.bodyColumns
    const isTerminal = e.surface === 'terminal'
    const { Box, Text, Button } = $.ui.resolve(e)
    const close = () => void $.ui.close({ id: PANE })
    const refreshPane = () => void refresh($)
    const nextMode: BandMode = mode === 'full' ? 'compact' : mode === 'compact' ? 'hidden' : 'full'
    const cycleBand = () => void setBandMode($, nextMode)

    const actions = (
      <Box flexDirection="row" gap={1}>
        <Button key="refresh" label="Refresh" plain hotkey={isTerminal ? 'r' : undefined} onPress={refreshPane} />
        <Button key="band" label={`Band: ${mode === 'full' ? 'Full' : mode === 'compact' ? 'Compact' : 'Hidden'}`} plain hotkey={isTerminal ? 'b' : undefined} onPress={cycleBand} />
        {isTerminal && <Button key="close" label="Close" hotkey="x" role="dismiss" onPress={close} />}
      </Box>
    )
    const section = (title: string, ...children: unknown[]) => (
      <Box flexDirection="column" gap={0}>
        <Text bold>{title}</Text>
        {children as RenderElement[]}
      </Box>
    )
    // A label left, its figures right, across the pane.
    const row = (key: string, label: RenderElement | string, value: string, note?: string) => (
      <Box key={key} flexDirection="row">
        {typeof label === 'string' ? <Text dimColor>{label}</Text> : label}
        <Box flexGrow={1} />
        <Text>
          <Text bold>{value}</Text>
          {note ? <Text dimColor> · {note}</Text> : ''}
        </Text>
      </Box>
    )

    if (!x) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={2} alignItems="center">
            <Text bold>☀️ Context Forecast</Text>
            <Box flexGrow={1} />
            {actions}
          </Box>
          <Text dimColor>No reading yet: the forecast starts with Claude's first reply.</Text>
        </Box>
      )
    }
    const { f, r, now } = x
    const px = panePx(cols)

    // Stat tiles on a fixed grid: three across when the pane is wide enough.
    const perRow = cols >= 54 ? 3 : 2
    const tileWidth = Math.floor((cols - (perRow - 1) * 2) / perRow)
    const tile = (key: string, label: string, value: string, sub: string) => (
      <Box key={key} flexDirection="column" width={tileWidth}>
        <Text dimColor>{label}</Text>
        <Text bold>{value}</Text>
        <Text dimColor wrap="truncate">
          {sub}
        </Text>
      </Box>
    )
    const estimate = f.rateBasis > 0 ? `from ${f.rateBasis} turn${f.rateBasis === 1 ? '' : 's'}` : 'needs a turn of growth'
    const tiles = [
      tile('ctx', 'Context', `${f.windowPercent}%`, `${fmtCount(f.tokens)} of ${fmtCount(f.window)}`),
      tile(
        'left',
        f.isCompactionLimit ? 'Until auto-compact' : 'Until full',
        f.turnsLeft !== null ? `~${f.turnsLeft} turns` : fmtCount(Math.max(0, f.limit - f.tokens)),
        f.turnsLeft !== null ? `${fmtCount(Math.max(0, f.limit - f.tokens))} · est. ${estimate}` : estimate,
      ),
      tile('rate', 'Average growth', f.rate !== null ? `+${fmtCount(f.rate)}/turn` : '—', f.perRequest !== null ? `+${fmtCount(f.perRequest)} per request` : ''),
      f.lastTurn
        ? tile('turn', 'Last turn', `${f.lastTurn.growth >= 0 ? '+' : ''}${fmtCount(f.lastTurn.growth)}`, `${f.lastTurn.requests} requests · ${fmtCount(f.lastTurn.output)} out`)
        : null,
      x.cacheHit !== null ? tile('cache', 'Cache hit', `${x.cacheHit}%`, 'last turn') : null,
      r.usd !== null
        ? tile('cost', 'Session cost', fmtUsd(r.usd), x.perHour !== null ? `${fmtUsd(x.perHour)}/h over ${fmtIn(x.elapsed)}` : fmtIn(x.elapsed))
        : null,
    ].filter(t => t !== null)
    const tileRows: RenderElement[][] = []
    for (let i = 0; i < tiles.length; i += perRow) tileRows.push(tiles.slice(i, i + perRow))

    const last = f.outlook[f.outlook.length - 1]
    const ahead = last
      ? last.isPast
        ? `⚠ Auto-compact expected within ${f.turnsLeft ?? 5} turn${f.turnsLeft === 1 ? '' : 's'} at this pace`
        : `In 5 turns: ~${Math.round(last.fraction * 100)}% of the way to auto-compact · ${last.level.name}`
      : 'A projection appears once the context has grown across a turn'

    const used = r.categories.reduce((a, c) => a + c.tokens, 0)
    const slices: Slice[] = r.categories.map((c, i) => ({ name: c.name, tokens: c.tokens, color: PALETTE[i % PALETTE.length]! }))

    let chart: RenderElement
    const bar = (key: string, fraction: number, color: string): RenderElement => {
      if (e.surface === 'terminal') {
        const [full, empty] = meter(fraction, Math.max(10, cols - 2))
        return (
          <Text key={key}>
            <Text color={color}>{full}</Text>
            <Text dimColor>{empty}</Text>
          </Text>
        )
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg key={key} source={meterSvg(fraction, color, px)} alt={`${Math.round(fraction * 100)}%`} />
    }
    let stack: RenderElement | null = null
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      chart = <Raster key="chart" {...chartCells(list, f.limit, Math.max(10, Math.min(80, cols - 2)), 7)} />
      if (slices.length > 0) stack = <Raster key="stack" {...stackCells(slices, used, Math.max(10, cols - 2))} />
    } else {
      const { Svg } = $.ui.resolve(e)
      chart = (
        <Svg
          key="chart"
          source={chartSvg(list, f, px)}
          alt={`Context over ${f.turns} turns with a five-turn projection; now ${Math.round(f.fraction * 100)}% of the way to auto-compact`}
        />
      )
      if (slices.length > 0) {
        stack = <Svg key="stack" source={stackSvg(slices, used, px)} alt={slices.map(sl => `${sl.name} ${fmtCount(sl.tokens)}`).join(', ')} />
      }
    }

    const scaleText = (
      <Text key="scale-text">
        {LEVEL_SPANS.map((span, i) => (
          <Text key={span.level.name}>
            {i > 0 ? <Text dimColor> · </Text> : ''}
            <Text bold={span.level.rank === f.level.rank} dimColor={span.level.rank !== f.level.rank}>
              {span.level.icon} {span.level.name} {span.range}
            </Text>
          </Text>
        ))}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {e.surface === 'terminal' ? (
            <Text>{f.level.icon}</Text>
          ) : (
            (() => {
              const { Svg } = $.ui.resolve(e)
              return <Svg key="sky" source={skySvg(f.level, 32)} alt={f.level.name} width={32} height={32} />
            })()
          )}
          <Text>
            <Text bold>{f.level.name}</Text>
            <Text dimColor> · {f.level.tag}</Text>
          </Text>
          <Box flexGrow={1} />
          {actions}
        </Box>

        <Box flexDirection="column" gap={1}>
          {tileRows.map((tr, i) => (
            <Box key={`tiles${i}`} flexDirection="row" columnGap={2}>
              {tr}
            </Box>
          ))}
        </Box>

        {section('Context forecast', chart, <Text key="ahead" dimColor>{ahead}</Text>)}

        {r.limits.length > 0 &&
          section(
            'Plan usage',
            ...r.limits.map(l => {
              const reset = resetIn(l.resetsAt, now)
              return (
                <Box key={l.kind} flexDirection="column" marginBottom={1}>
                  {row(`${l.kind}-row`, limitName(l.kind, true), `${l.percentUsed >= 75 ? '⚠ ' : ''}${Math.round(l.percentUsed)}%`, reset ? `resets in ${reset}` : undefined)}
                  {bar(`${l.kind}-bar`, l.percentUsed / 100, severity(l.percentUsed))}
                </Box>
              )
            }),
          )}

        {slices.length > 0 &&
          section(
            "What's in the context",
            stack,
            <Box key="gap" height={1} />,
            ...slices.map(sl =>
              row(
                sl.name,
                <Text>
                  <Text color={sl.color}>■</Text>
                  <Text dimColor> {sl.name}</Text>
                </Text>,
                fmtCount(sl.tokens),
                `${Math.round((sl.tokens / used) * 100)}%`,
              ),
            ),
          )}

        {section(
          'Weather scale',
          e.surface === 'terminal'
            ? scaleText
            : (() => {
                const { Svg } = $.ui.resolve(e)
                return (
                  <Svg
                    key="scale"
                    source={scaleSvg(f, px)}
                    alt="Clear under 35% of the way to auto-compact, Fair to 55%, Cloudy to 70%, Showers to 85%, Storm beyond"
                  />
                )
              })(),
          <Text key="scale-note" dimColor>
            At auto-compact, Claude Code summarizes the older conversation to free room; a rainbow follows a compaction.
            Turn estimates use the average growth of recent turns.
          </Text>,
        )}
      </Box>
    )
  })
}
