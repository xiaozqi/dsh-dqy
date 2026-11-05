import { appendFileSync } from 'node:fs'
import type {
  NotificationCancelSink,
  NotificationPort,
  NotificationSource,
  NotificationStats,
} from '../../domain/ports/notification.port.js'
import type {
  NotificationDecision,
  NotificationEvent,
} from '../../domain/notification-types.js'
import type { NotificationPipeline } from './pipeline.js'

export class NotificationService implements NotificationPort {
  private received = 0
  private allowed = 0
  private blocked = 0
  private canceled = 0
  private readonly droppedBy: Record<string, number> = {}
  private readonly buffer: NotificationDecision[] = []
  private readonly listeners = new Set<(d: NotificationDecision) => void>()
  private queue: Promise<void> = Promise.resolve()
  private unsubscribes: Array<() => void> = []
  private startedFlag = false

  constructor(
    private readonly sources: NotificationSource[],
    private readonly pipeline: NotificationPipeline,
    private readonly recentCapacity = 100,
    private readonly cancelSink?: NotificationCancelSink,
    private readonly cancelLogPath?: string,
    // Optional side-channel: invoked exactly once per decision whose action
    // is 'allow'. Used by the autonomy loop to wake on new incoming messages.
    // Keeping this as a plain callback (not a domain port) avoids widening
    // NotificationPort for a single consumer.
    private readonly allowListener?: (event: NotificationEvent) => void,
  ) {}

  get started(): boolean {
    return this.startedFlag
  }

  get connected(): boolean {
    return this.sources.some(source => source.connected)
  }

  async start(): Promise<void> {
    if (this.startedFlag) {
      return
    }
    this.startedFlag = true
    for (const source of this.sources) {
      this.unsubscribes.push(source.subscribe(event => this.enqueue(event)))
      await source.start()
    }
  }

  async stop(): Promise<void> {
    this.startedFlag = false
    const unsubs = this.unsubscribes
    this.unsubscribes = []
    for (const unsub of unsubs) {
      try {
        unsub()
      } catch {
        /* unsubscribing a source must not block the others */
      }
    }
    for (const source of this.sources) {
      try {
        await source.stop()
      } catch {
        /* one source failing to stop must not block the others */
      }
    }
  }

  onEvent(cb: (d: NotificationDecision) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  recent(limit: number = this.recentCapacity): NotificationDecision[] {
    return this.buffer.slice(-limit)
  }

  stats(): NotificationStats {
    return {
      received: this.received,
      allowed: this.allowed,
      blocked: this.blocked,
      canceled: this.canceled,
      droppedBy: { ...this.droppedBy },
    }
  }

  private enqueue(event: NotificationEvent): void {
    this.queue = this.queue
      .then(() => this.handle(event))
      .catch(() => {})
  }

  private async handle(event: NotificationEvent): Promise<void> {
    this.received += 1
    let decision: NotificationDecision
    try {
      decision = await this.pipeline.decide(event)
    } catch {
      decision = { event, action: 'allow', reason: 'pipeline error' }
    }
    if (decision.action === 'allow') {
      this.allowed += 1
      this.pushRecent(decision)
      if (this.allowListener) {
        try {
          this.allowListener(decision.event)
        } catch {
          // A listener failure must not break the notification pipeline.
        }
      }
    } else {
      this.blocked += 1
      this.droppedBy[decision.reason] =
        (this.droppedBy[decision.reason] ?? 0) + 1
      if (decision.event.id) {
        this.cancelSink?.pushCancel(decision.event.id)
        this.canceled += 1
        this.appendCancelLog(decision)
      }
    }
    for (const cb of this.listeners) {
      try {
        cb(decision)
      } catch {
        /* a listener failure must not break the pipeline */
      }
    }
  }

  private pushRecent(decision: NotificationDecision): void {
    this.buffer.push(decision)
    if (this.buffer.length > this.recentCapacity) {
      this.buffer.shift()
    }
  }

  private appendCancelLog(decision: NotificationDecision): void {
    if (!this.cancelLogPath) {
      return
    }
    try {
      appendFileSync(
        this.cancelLogPath,
        JSON.stringify({
          actor: 'plugin',
          key: decision.event.id,
          app: decision.event.app,
          title: decision.event.title,
          reason: decision.reason,
          matchedRule: decision.matchedRule ?? null,
          when: Date.now(),
        }) + '\n',
        'utf8',
      )
    } catch {
      /* logging a cancel must never break the pipeline */
    }
  }
}
