import { atom, read, update } from 'claude-code'
import type { Register, ThemeKey } from 'claude-code'

import type { RateLimitReading, UsageSnapshot } from '../types'

const PANE = 'usage-meter'
const TITLE = 'Claude Usage'
const THRESHOLDS = [80, 95]
const BAR_WIDTH = 20

const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, { rateLimits: [] } as UsageSnapshot)
const warned = atom({ plugin: 'usage-meter', key: 'warned' } as const, [] as string[])

const LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  spend_limit: 'Spend limit',
}

export const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

export const bar = (percent: number) => {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

export const tone = (percent: number): ThemeKey =>
  percent >= 95 ? 'error' : percent >= 80 ? 'warning' : 'success'

export const untilReset = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resetting now'
  const mins = Math.round(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return 'resets in ' + (d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`)
}

// Thresholds a window has newly crossed, keyed by window and reset time so each fires once per window.
export const crossings = (limits: RateLimitReading[], already: string[]) =>
  limits.flatMap(l =>
    THRESHOLDS.filter(t => l.percentUsed >= t)
      .map(t => ({ key: `${l.kind}:${l.resetsAt ?? ''}:${t}`, limit: l, threshold: t }))
      .filter(c => !already.includes(c.key)),
  )

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage', description: 'Show Claude usage (plan limits, cost, context) in a pane' })
    const u = await $.session.usage()
    await update($, snapshot, () => ({ rateLimits: u.rateLimits, cost: u.cost, context: { tokens: u.context.tokens, window: u.context.window, percent: u.context.percent } }))
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'usage' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, snapshot, () => ({ rateLimits: e.rateLimits, cost: e.cost, context: e.context, measuredAt: now }))

    const fresh = crossings(e.rateLimits, await read($, warned))
    if (fresh.length > 0) {
      const top = fresh.reduce((a, b) => (b.threshold > a.threshold ? b : a))
      const reset = untilReset(top.limit.resetsAt, now)
      $.ui.toast(`${label(top.limit.kind)} at ${top.limit.percentUsed}%${reset ? ` (${reset})` : ''}`, { timeoutMs: 8000 })
      await update($, warned, list => [...list, ...fresh.map(c => c.key)].slice(-50))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const now = await $.clock.now()
    const ctx = s.context?.percent

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="bold">Plan limits</Text>
          {s.rateLimits.length === 0 && (
            <Text dimColor>No reading yet. Limits appear after the first reply on a Pro, Max or Team plan.</Text>
          )}
          {s.rateLimits.map(l => (
            <Box flexDirection="column">
              <Text>
                {label(l.kind)}: <Text color={tone(l.percentUsed)} tabular>{l.percentUsed}%</Text>
              </Text>
              <Text color={tone(l.percentUsed)}>{bar(l.percentUsed)}</Text>
              {l.resetsAt && <Text dimColor>{untilReset(l.resetsAt, now)}</Text>}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text weight="bold">This session</Text>
          <Text>
            Cost: <Text tabular>{s.cost ? `$${s.cost.usd.toFixed(2)}` : 'not tracked here'}</Text>
          </Text>
          <Text>
            Context: <Text color={tone(ctx ?? 0)} tabular>{ctx === undefined ? 'no reading yet' : `${ctx}%`}</Text>
          </Text>
          {ctx !== undefined && <Text color={tone(ctx)}>{bar(ctx)}</Text>}
        </Box>
      </Box>
    )
  })
}
