/**
 * Polls the phone's own notification store and reports new QQ notifications.
 *
 * Why not rely on the notification *event* pipeline: QQ only posts a
 * notification while it is in the background, the aggregated notification
 * carries no peer, and `NotificationListener` needs the bridge APK to be
 * alive. `dumpsys notification` is read-only, needs no foreground focus, and
 * shows the per-conversation title even when the shade groups them.
 */

export interface QqPing {
  key: string
  title: string
  text: string
}

export interface QqNotificationWatcherOptions {
  /** Runs `dumpsys notification --noredact` and returns the dump. */
  readNotifications(): Promise<string>
  /** Called for a notification key whose text is new or changed. */
  onPing(ping: QqPing): void | Promise<void>
  intervalMs?: number
  /** QQ package name; defaults to com.tencent.mobileqq. */
  packageName?: string
  logger?(message: string): void
}

// The dump is multi-line per record; match without `$` anchors so the title
// and text are found inside a block rather than only at the end of the dump.
const TITLE = /android\.title=String \((.*)\)/
const TEXT = /android\.text=String \((.*)\)/

/** Parse QQ records out of a `dumpsys notification` dump. */
export function parseQqNotifications(
  dump: string,
  packageName = 'com.tencent.mobileqq',
): QqPing[] {
  const out: QqPing[] = []
  const blocks = dump.split('NotificationRecord(')
  for (const block of blocks) {
    if (!block.includes(`pkg=${packageName}`)) {
      continue
    }
    const key = block.match(/key=([^\s]+)/)?.[1] ?? ''
    const title = block.match(TITLE)?.[1]?.trim() ?? ''
    const text = block.match(TEXT)?.[1]?.trim() ?? ''
    if (!key || (!title && !text)) {
      continue
    }
    out.push({ key, title, text })
  }
  return out
}

export class QqNotificationWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private tickBusy = false
  private readonly seen = new Map<string, string>()

  constructor(private readonly options: QqNotificationWatcherOptions) {}

  start(): void {
    if (this.timer) {
      return
    }
    const interval = Math.max(2000, this.options.intervalMs ?? 5000)
    // First read only primes the seen-set: existing notifications must not
    // fire a reply burst on startup.
    void this.tick(true)
    this.timer = setInterval(() => {
      void this.tick(false)
    }, interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get running(): boolean {
    return this.timer !== null
  }

  private async tick(primeOnly: boolean): Promise<void> {
    if (this.tickBusy) {
      return
    }
    this.tickBusy = true
    try {
      const dump = await this.options.readNotifications()
      const pings = parseQqNotifications(
        dump,
        this.options.packageName ?? 'com.tencent.mobileqq',
      )
      const alive = new Set<string>()
      for (const ping of pings) {
        alive.add(ping.key)
        const fingerprint = `${ping.title}\u0000${ping.text}`
        const previous = this.seen.get(ping.key)
        if (previous !== fingerprint) {
          this.seen.set(ping.key, fingerprint)
          if (!primeOnly) {
            this.options.logger?.(
              `new QQ notification: ${ping.title || '-'} / ${ping.text || '-'}`,
            )
            await this.options.onPing(ping)
          }
        }
      }
      // Drop entries whose notification is gone, so a later message reuses the
      // same key (QQ reuses ids) and still counts as new.
      for (const key of [...this.seen.keys()]) {
        if (!alive.has(key)) {
          this.seen.delete(key)
        }
      }
    } catch (err) {
      this.options.logger?.(
        `poll failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      this.tickBusy = false
    }
  }
}
