// Chained-setTimeout heartbeat: each tick reschedules itself with a fresh
// interval, so the next wake delay can be recomputed after every run. Errors
// inside a tick are swallowed and logged so the loop never crashes.
export interface HeartbeatDeps {
  // Initial interval used by start(); subsequent ticks call scheduleNext().
  initialIntervalMs: number
  onTick: () => Promise<void> | void
}

export class HeartbeatScheduler {
  private timer: NodeJS.Timeout | null = null
  private nextDelayMs: number

  constructor(private readonly deps: HeartbeatDeps) {
    this.nextDelayMs = deps.initialIntervalMs
  }

  start(): void {
    if (this.timer) return
    this.arm(this.nextDelayMs)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  get running(): boolean {
    return this.timer !== null
  }

  // Re-arm the next wake after `ms`. Safe to call while running; cancels the
  // pending timer and schedules a fresh one.
  scheduleNext(ms: number): void {
    this.nextDelayMs = ms
    if (!this.timer) return
    clearTimeout(this.timer)
    this.arm(ms)
  }

  private arm(ms: number): void {
    this.timer = setTimeout(() => {
      void this.safeTick()
    }, ms)
  }

  private async safeTick(): Promise<void> {
    // If we were stopped between firing and running, bail out.
    if (!this.timer) return
    try {
      await this.deps.onTick()
    } catch (err) {
      console.warn('[heartbeat] tick failed:', (err as Error).message)
    }
    // Re-arm with the current configured delay. The onTick handler (the
    // AutonomyDriver) should have called scheduleNext() already with the
    // post-tick delay; if it didn't, we keep the previous delay.
    if (this.timer) {
      this.arm(this.nextDelayMs)
    }
  }
}
