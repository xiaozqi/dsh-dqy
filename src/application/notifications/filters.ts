import type { ChatMessage, LlmPort } from '../../domain/ports/llm.port.js'
import type {
  NotificationDecision,
  NotificationEvent,
  NotificationFilter,
} from '../../domain/notification-types.js'

export interface NotificationRule {
  match: RegExp
  action: 'allow' | 'block'
}

export class WhitelistFilter implements NotificationFilter {
  readonly id = 'whitelist'

  constructor(private readonly whitelist: ReadonlySet<string>) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    if (this.whitelist.size > 0 && !this.whitelist.has(event.app)) {
      return { event, action: 'block', reason: this.id }
    }
    return null
  }
}

export class ImportanceFilter implements NotificationFilter {
  readonly id = 'importance'

  constructor(private readonly minImportance: number) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    if (event.importance < this.minImportance) {
      return { event, action: 'block', reason: this.id }
    }
    return null
  }
}

export class AppBlocklistFilter implements NotificationFilter {
  readonly id = 'app-blocklist'

  constructor(private readonly blockedApps: ReadonlySet<string>) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    if (this.blockedApps.size > 0 && this.blockedApps.has(event.app)) {
      return {
        event,
        action: 'block',
        reason: this.id,
        matchedRule: event.app,
      }
    }
    return null
  }
}

export class RuleFilter implements NotificationFilter {
  readonly id = 'rules'

  constructor(private readonly rules: readonly NotificationRule[]) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    const haystack = `${event.title}\n${event.text}`
    for (const rule of this.rules) {
      if (rule.match.test(haystack)) {
        return {
          event,
          action: rule.action,
          reason: this.id,
          matchedRule: rule.match.source,
        }
      }
    }
    return null
  }
}

export class SemanticFilter implements NotificationFilter {
  readonly id = 'semantic'
  private static readonly timeoutMs = 10_000

  constructor(
    private readonly llm: LlmPort | null,
    private readonly enabled: boolean,
  ) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    if (!this.llm || !this.enabled) {
      return null
    }
    try {
      const relevant = await this.judge(event)
      if (!relevant) {
        return { event, action: 'block', reason: this.id }
      }
      return null
    } catch {
      return null
    }
  }

  private async judge(event: NotificationEvent): Promise<boolean> {
    const llm = this.llm
    if (!llm) {
      return true
    }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You filter a phone notification. Treat promo, ads, scam, and spam as irrelevant. ' +
          'Decide whether the notification matters to its owner. ' +
          'Reply with ONLY one JSON object, no prose: {"relevant":true} or {"relevant":false}.',
      },
      {
        role: 'user',
        content: `app=${event.app}\ntitle=${event.title}\ntext=${event.text}`,
      },
    ]
    const reply = await this.chatWithTimeout(llm, messages)
    return SemanticFilter.parseRelevant(reply)
  }

  private async chatWithTimeout(
    llm: LlmPort,
    messages: ChatMessage[],
  ): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('semantic llm timeout')),
        SemanticFilter.timeoutMs,
      )
    })
    try {
      return await Promise.race([llm.chat(messages), timeout])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  private static parseRelevant(reply: string): boolean {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return true
    }
    const parsed = JSON.parse(reply.slice(start, end + 1)) as {
      relevant?: unknown
    }
    return parsed.relevant !== false
  }
}

export class DedupeFilter implements NotificationFilter {
  readonly id = 'dedupe'
  private readonly seen = new Map<string, number>()

  constructor(private readonly windowMs: number) {}

  async apply(event: NotificationEvent): Promise<NotificationDecision | null> {
    const key = `${event.app}\u0000${event.title}\u0000${event.text}`
    this.prune(event.when)
    const last = this.seen.get(key)
    if (last !== undefined && event.when - last < this.windowMs) {
      return { event, action: 'block', reason: 'duplicate' }
    }
    this.seen.set(key, event.when)
    return null
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at > this.windowMs) {
        this.seen.delete(key)
      }
    }
  }
}
