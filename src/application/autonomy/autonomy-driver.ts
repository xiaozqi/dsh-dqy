import type { AutonomyLoop, AutonomyTickResult } from './autonomy-loop.js'
import type { HeartbeatScheduler } from '../scheduler/heartbeat-scheduler.js'

// Orchestrates the autonomous loop: turns the loop's raw decision into a
// rescheduled wake-up. Unifies heartbeat and event triggers behind one wake()
// entry with a busy lock + single pending slot.
export interface AutonomyDriverConfig {
  // Lower bound on wake interval; LLM self-reports below this are clamped up.
  minWakeMs: number
  // Upper bound on wake interval; LLM self-reports above this are clamped down.
  maxWakeMs: number
  // Used when the LLM did not report a nextWakeMs or reported an illegal one.
  fallbackWakeMs: number
  // Allow notification events to trigger an immediate wake() when true.
  wakeOnEvent: boolean
}

export interface AutonomyDriverDeps {
  loop: Pick<AutonomyLoop, 'runOnce'>
  scheduler: HeartbeatScheduler
  config: AutonomyDriverConfig
}

export class AutonomyDriver {
  private busy = false
  private pending: 'heartbeat' | 'event' | null = null
  private lastResult: AutonomyTickResult | null = null

  constructor(private readonly deps: AutonomyDriverDeps) {}

  get isBusy(): boolean {
    return this.busy
  }

  get lastWake(): AutonomyTickResult | null {
    return this.lastResult
  }

  start(): void {
    this.deps.scheduler.start()
  }

  stop(): void {
    this.deps.scheduler.stop()
  }

  // Unified entry: heartbeat fires this, events fire this. If a tick is
  // already running we remember ONE pending wake (heartbeat preferred over
  // event) and run it again as soon as the current tick finishes.
  wake(reason: 'heartbeat' | 'event'): void {
    if (this.busy) {
      // Collapse: at most one queued wake. Heartbeat wins ties (it already
      // happened on its own clock; an extra heartbeat wake is noisier than
      // skipping a duplicate event).
      if (this.pending === null) this.pending = reason
      return
    }
    void this.runLocked()
  }

  // Notification event hook: only acts when wakeOnEvent is enabled.
  onAllowEvent(): void {
    if (!this.deps.config.wakeOnEvent) return
    this.wake('event')
  }

  private async runLocked(): Promise<void> {
    this.busy = true
    try {
      const result = await this.deps.loop.runOnce()
      this.lastResult = result
      const next = this.computeNextWakeMs(result)
      this.deps.scheduler.scheduleNext(next)
    } catch (err) {
      console.warn('[autonomy-driver] runOnce threw:', (err as Error).message)
      this.deps.scheduler.scheduleNext(this.deps.config.fallbackWakeMs)
    } finally {
      this.busy = false
      const queued = this.pending
      this.pending = null
      if (queued) {
        // Defer to next microtask so the current tick fully unwinds.
        queueMicrotask(() => this.wake(queued))
      }
    }
  }

  private computeNextWakeMs(result: AutonomyTickResult): number {
    const { minWakeMs, maxWakeMs, fallbackWakeMs } = this.deps.config
    const raw = result.nextWakeMs
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return fallbackWakeMs
    }
    // Clamp whatever the LLM reported (including 0 / negatives) into
    // [min, max]. Missing/non-numeric self-report falls back.
    return Math.min(maxWakeMs, Math.max(minWakeMs, raw))
  }
}
