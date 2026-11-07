/**
 * Serializes whole UI flows, not just single driver calls.
 *
 * A QQ notification and a Douyin DM can arrive at the same moment. The phone
 * has one foreground, so interleaving the two flows makes each one tap into
 * the other's screen — the reply lands in the wrong place or times out. Every
 * outbound flow (QQ reply, Douyin DM send) runs through the same lock, so the
 * device is driven by one flow at a time.
 */
export class FlowLock {
  private tail: Promise<void> = Promise.resolve()
  private running = 0

  get busy(): boolean {
    return this.running > 0
  }

  /** Runs `task` after every previously queued flow has finished. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    this.running += 1
    try {
      return await task()
    } finally {
      this.running -= 1
      release()
    }
  }
}
