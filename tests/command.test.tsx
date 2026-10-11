import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

const usage = (tokens: number): SessionUsage =>
  ({
    startedAt: 0,
    context: {
      tokens,
      window: 200_000,
      percent: Math.round((tokens / 200_000) * 100),
      breakdown: {
        categories: [{ name: 'Messages', tokens, color: 'x', isDeferred: false, kind: 'used' }],
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
    rateLimits: [],
    cost: { usd: 0.5 },
  }) as SessionUsage

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('/weather hide, mini, and bare restore the band', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usage(60_000) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.session.measure({ context: usage(60_000).context, rateLimits: [], changed: ['context'] })
  const presentation = { isFullscreen: false, columns: 140 } as never
  const run = (args: string) => $.command.run({ command: 'weather', args, origin: { kind: 'composer' } as never, presentation })
  const mount = () => $.ui.mount({ plugin: 'token-weather', surface: 'terminal', component: 'AbovePrompt', props })

  expect((await run('hide')).text).toMatch(/hidden/)
  let band = await mount()
  expect(await band.find({ key: 'forecast' })).toBeUndefined()
  await band.unmount()

  expect((await run('mini')).text).toMatch(/minimized/)
  band = await mount()
  expect(await band.find({ key: 'forecast' })).toBeUndefined()
  await band.unmount()

  // Arguments are case-insensitive and padded input is tolerated.
  expect((await run('  HIDE ')).text).toMatch(/hidden/)

  expect((await run('')).text).toMatch(/band shown/)
  band = await mount()
  expect(await band.find({ key: 'forecast' })).toBeDefined()
  await band.unmount()
})

test('before the first reply the band invites rather than guesses', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: undefined }))
  const band = await $.ui.mount({ plugin: 'token-weather', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ type: 'Text', text: /first reply/ })).toBeDefined()
  await band.unmount()
})
