import type {
  SchedulePlan,
  ScheduleTick,
} from '../../domain/schedule-types.js'

export interface SchedulerDeps {
  plans: SchedulePlan[]
  run: (plan: SchedulePlan) => Promise<void>
  tickIntervalMs?: number
}

export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly fired = new Map<string, string>()
  private readonly history: ScheduleTick[] = []

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return
    const interval = this.deps.tickIntervalMs ?? 30000
    this.timer = setInterval(() => {
      void this.tick()
    }, interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  listHistory(): ScheduleTick[] {
    return [...this.history]
  }

  listPlans(): SchedulePlan[] {
    return [...this.deps.plans]
  }

  private async tick(): Promise<void> {
    const now = new Date()
    const dateKey = now.toISOString().slice(0, 10)
    for (const plan of this.deps.plans) {
      if (!plan.enabled) continue
      if (this.fired.get(plan.app) === dateKey) continue
      if (
        now.getHours() !== plan.hour ||
        now.getMinutes() !== plan.minute
      ) {
        continue
      }

      this.fired.set(plan.app, dateKey)
      try {
        await this.deps.run(plan)
        this.history.push({
          app: plan.app,
          ranAt: now.toISOString(),
          status: 'success',
          detail: 'scheduled run finished',
        })
      } catch (err) {
        this.history.push({
          app: plan.app,
          ranAt: now.toISOString(),
          status: 'failed',
          detail: (err as Error).message,
        })
      }
    }
  }
}
