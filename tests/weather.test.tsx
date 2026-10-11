import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { parseTranscript } from '../hooks/history'

const SURFACES = ['terminal', 'desktop'] as const

function usageAt(tokens: number): SessionUsage {
  return {
    startedAt: 0,
    context: {
      tokens,
      window: 200_000,
      percent: Math.round((tokens / 200_000) * 100),
      breakdown: {
        categories: [
          { name: 'Messages', tokens: tokens - 20_000, color: 'x', isDeferred: false, kind: 'used' },
          { name: 'System tools', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
        ],
        totalTokens: tokens,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        autocompactSource: 'model-default',
        percentage: 0,
        gridRows: [],
        model: 'claude',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        autoCompactThreshold: 160_000,
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
    rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    cost: { usd: 1.23 },
  }
}

test('band and forecast draw on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  let tokens = 40_000
  on('session.usage', () => ({ value: usageAt(tokens) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // The engine's own drawing, where the mod steps aside: nothing.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  for (const t of [40_000, 52_000, 66_000, 81_000]) {
    tokens = t
    await $.session.measure({ context: usageAt(t).context, rateLimits: [], changed: ['context'] })
  }

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'token-weather',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 140,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    // 81k of a 160k compaction point: about half way, "Fair".
    expect(await band.find({ type: 'Text', text: /Fair/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /~6 turns left/ })).toBeDefined()
    expect(await band.find({ key: 'forecast' })).toBeDefined()
    expect(await band.find({ key: 'hide' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /5h limit/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /per turn/ })).toBeDefined()
    // Minimized, the weather moves into the prompt footer beside the model
    // selector; its percentage brings the band back.
    await band.press({ key: 'mini' })
    expect(await band.find({ key: 'forecast' })).toBeUndefined()
    const footer = await $.ui.mount({ plugin: 'token-weather', surface, component: 'SessionMode', props: { modes: [] } })
    expect(await footer.find({ key: 'expand' })).toBeDefined()
    await footer.press({ key: 'expand' })
    expect(await footer.find({ key: 'expand' })).toBeUndefined()
    await footer.unmount()
    expect(await band.find({ key: 'forecast' })).toBeDefined()
    await band.unmount()

    // Narrow: one line of the essentials, the stat blocks dropped.
    const slim = await $.ui.mount({
      plugin: 'token-weather',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 50, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect(await slim.find({ type: 'Text', text: /per turn/ })).toBeUndefined()
    expect(await slim.find({ type: 'Text', text: /cache hit/ })).toBeUndefined()
    expect(await slim.find({ key: 'forecast' })).toBeDefined()
    await slim.unmount()

    const pane = await $.ui.mount({
      plugin: 'token-weather',
      surface,
      component: 'Pane',
      requestId: 'token-weather',
      props: {
        title: 'Token Weather',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await pane.find({ type: 'Text', text: /In 5 turns/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /est\. from 3 turns/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Weather scale' })).toBeDefined()
    if (surface === 'desktop') {
      expect((await pane.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(4)
    } else {
      expect(await pane.find({ type: 'Text', text: /Storm 85%\+/ })).toBeDefined()
    }
    expect(await pane.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
    await pane.unmount()
  }
})

test('history rebuilds from a transcript', async () => {
  const req = (id: string, cached: number, out = 100) =>
    JSON.stringify({
      type: 'assistant',
      requestId: id,
      timestamp: '2026-10-04T15:11:01.970Z',
      message: { usage: { input_tokens: 2, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: out } },
    })
  const prompt = JSON.stringify({ type: 'user', message: { content: 'hi' } })
  const result = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } })
  const lines = [
    prompt, req('a', 1000), req('a', 1000), result, req('b', 2000), prompt, req('c', 3000),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary' }), prompt, req('d', 500),
    JSON.stringify({ type: 'assistant', isSidechain: true, requestId: 'e', message: { usage: { input_tokens: 9 } } }),
  ]
  const s = parseTranscript(lines.join('\n'))
  expect(s.map(x => x.tokens)).toEqual([1002, 2002, 3002, 502])
  expect(s.map(x => x.isTurnEnd)).toEqual([false, true, true, false])
  expect(s.map(x => x.isCompaction)).toEqual([false, false, false, true])
})

test('every condition draws its sky on the terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  let tokens = 0
  on('session.usage', () => ({ value: usageAt(tokens) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // 160k is the compaction point: clear, fair, cloudy, showers, storm, then a
  // compaction (the clearing).
  const steps: [number, RegExp][] = [
    [40_000, /Clear/], [70_000, /Fair/], [100_000, /Cloudy/], [125_000, /Showers/], [150_000, /Storm/], [50_000, /Clearing/],
  ]
  for (const [t, name] of steps) {
    tokens = t
    await $.session.measure({ context: usageAt(t).context, rateLimits: [], changed: ['context'] })
    for (const surface of SURFACES) {
      const band = await $.ui.mount({
        plugin: 'token-weather',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
      })
      expect(await band.find({ type: 'Text', text: name })).toBeDefined()
      if (surface === 'terminal') {
        expect(await band.find({ type: 'Raster', key: 'sky' })).toBeDefined()
      } else {
        // The animated icon is the Svg that carries the condition's name.
        const svgs = await band.findAll({ type: 'Svg' })
        expect(svgs.some(svg => JSON.stringify(svg).includes('@keyframes'))).toBe(true)
      }
      await band.unmount()
    }
  }
})

test('/weather shows the band; /weather forecast opens the pane', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usageAt(60_000) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  // The engine's toast and panes, beneath the mod.
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.measure({ context: usageAt(60_000).context, rateLimits: [], changed: ['context'] })
  const presentation = { isFullscreen: false, columns: 140 } as never
  const run = (args: string) => $.command.run({ command: 'weather', args, origin: { kind: 'composer' } as never, presentation })
  await run('hide')
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  let band = await $.ui.mount({ plugin: 'token-weather', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ key: 'forecast' })).toBeUndefined()
  await band.unmount()
  expect((await run('')).text).toMatch(/band shown/)
  band = await $.ui.mount({ plugin: 'token-weather', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ key: 'forecast' })).toBeDefined()
  await band.unmount()
  expect((await run('forecast')).text).toMatch(/Forecast (opened|closed)/)
})
