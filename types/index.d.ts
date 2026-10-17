export type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type UsageSnapshot = {
  rateLimits: RateLimitReading[]
  cost?: { usd: number }
  context?: { tokens?: number; window: number; percent?: number }
  measuredAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { snapshot: UsageSnapshot; warned: string[] }
  }
}
