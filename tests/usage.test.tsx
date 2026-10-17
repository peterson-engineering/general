import { test, expect, mock } from 'claude-code/testing'

import { bar, crossings, label, tone, untilReset } from '../hooks/register'

test('helpers format limits', async () => {
  expect(label('five_hour')).toBe('5-hour limit')
  expect(label('seven_day')).toBe('Weekly limit')
  expect(bar(50)).toBe('█'.repeat(10) + '░'.repeat(10))
  expect(bar(150)).toBe('█'.repeat(20))
  expect(tone(10)).toBe('success')
  expect(tone(85)).toBe('warning')
  expect(tone(97)).toBe('error')
  const now = Date.parse('2026-10-17T10:00:00Z')
  expect(untilReset('2026-10-17T12:30:00Z', now)).toBe('resets in 2h 30m')
  expect(untilReset('2026-10-20T13:00:00Z', now)).toBe('resets in 3d 3h')
})

test('warns once per threshold per window', async () => {
  const lim = [{ kind: 'five_hour', percentUsed: 96, resetsAt: 'R' }]
  const first = crossings(lim, [])
  expect(first.map(c => c.threshold)).toEqual([80, 95])
  expect(crossings(lim, first.map(c => c.key))).toEqual([])
  expect(crossings([{ kind: 'five_hour', percentUsed: 81, resetsAt: 'R2' }], first.map(c => c.key)).length).toBe(1)
})

test('pane draws limits, cost and context on each surface', async ($, on) => {
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2099-01-01T00:00:00Z' }],
    cost: { usd: 1.234 },
  } }))
  mock.clock(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'Pane', props: {} as never, requestId: 'usage-meter' })
    expect(await ui.find({ type: 'Text', text: /5-hour limit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /25%/ })).toBeDefined()
    await ui.unmount()
  }
})
