import {
  DeviceTimeoutError,
} from '../../domain/errors.js'
import type { Point, Observation, Size, UiNode } from '../../domain/types.js'
import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js'

export interface SerialDeviceOptions {
  /** Deadline for one device call. */
  timeoutMs: number
  /** observe() captures a screenshot plus a UI dump, so it gets more room. */
  observeTimeoutMs?: number
  onTimeout?(label: string, timeoutMs: number): void
}

/**
 * Serializes every device call and gives each one a deadline.
 *
 * One phone is shared by the tools, the autonomy heartbeat, the notification
 * pipeline and the mirror panel. Without a mutex two flows interleave: the
 * concrete first casualty is the IME — two concurrent `inputChinese` calls both
 * read "previous IME", restore it twice, and the phone is left on ADBKeyBoard
 * with the user's keyboard gone.
 *
 * A timeout rejects the caller but cannot cancel the running adb child: the
 * queue advances so one wedged call cannot block the plugin forever, and the
 * timeout is reported so the caller re-observes instead of trusting its state.
 */
export class SerialDevice implements UiDriverPort {
  readonly kind: string
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly inner: UiDriverPort,
    private readonly options: SerialDeviceOptions,
  ) {
    this.kind = `serial(${inner.kind})`
  }

  connect(): Promise<void> {
    return this.run('connect', this.options.timeoutMs, () =>
      this.inner.connect(),
    )
  }

  isConnected(): Promise<boolean> {
    return this.run('isConnected', this.options.timeoutMs, () =>
      this.inner.isConnected(),
    )
  }

  screenSize(): Promise<Size> {
    return this.run('screenSize', this.options.timeoutMs, () =>
      this.inner.screenSize(),
    )
  }

  foregroundApp(): Promise<string> {
    return this.run('foregroundApp', this.options.timeoutMs, () =>
      this.inner.foregroundApp(),
    )
  }

  tap(point: Point): Promise<void> {
    return this.run('tap', this.options.timeoutMs, () => this.inner.tap(point))
  }

  longPress(point: Point, durationMs: number): Promise<void> {
    return this.run('longPress', this.options.timeoutMs, () =>
      this.inner.longPress(point, durationMs),
    )
  }

  swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    return this.run('swipe', this.options.timeoutMs, () =>
      this.inner.swipe(from, to, durationMs),
    )
  }

  inputText(text: string): Promise<void> {
    return this.run('inputText', this.options.timeoutMs, () =>
      this.inner.inputText(text),
    )
  }

  inputChinese(text: string): Promise<void> {
    return this.run('inputChinese', this.options.timeoutMs, () =>
      this.inner.inputChinese(text),
    )
  }

  pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void> {
    return this.run('pressKey', this.options.timeoutMs, () =>
      this.inner.pressKey(key),
    )
  }

  openApp(packageName: string): Promise<void> {
    return this.run('openApp', this.options.timeoutMs, () =>
      this.inner.openApp(packageName),
    )
  }

  observe(): Promise<Observation> {
    return this.run(
      'observe',
      this.options.observeTimeoutMs ?? this.options.timeoutMs,
      () => this.inner.observe(),
    )
  }

  findText(text: string): Promise<Point | null> {
    return this.run('findText', this.options.timeoutMs, () =>
      this.inner.findText(text),
    )
  }

  findNodes(matcher: UiMatcher): Promise<UiNode[]> {
    return this.run('findNodes', this.options.timeoutMs, () =>
      this.inner.findNodes(matcher),
    )
  }

  tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode> {
    return this.run('tapControl', this.options.timeoutMs, () =>
      this.inner.tapControl(matcher, templateHint),
    )
  }

  pushFile(localPath: string, remotePath: string): Promise<void> {
    return this.run('pushFile', this.options.timeoutMs, () =>
      this.inner.pushFile(localPath, remotePath),
    )
  }

  pullFile(remotePath: string, localPath: string): Promise<void> {
    return this.run('pullFile', this.options.timeoutMs, () =>
      this.inner.pullFile(remotePath, localPath),
    )
  }

  playAudio(remotePath: string): Promise<void> {
    return this.run('playAudio', this.options.timeoutMs, () =>
      this.inner.playAudio(remotePath),
    )
  }

  recordAudio(durationMs: number, remotePath: string): Promise<void> {
    return this.run('recordAudio', this.options.timeoutMs, () =>
      this.inner.recordAudio(durationMs, remotePath),
    )
  }

  /** Number of callers currently waiting for their turn, for diagnostics. */
  get queued(): number {
    return this.pending
  }

  private pending = 0

  private run<T>(
    label: string,
    timeoutMs: number,
    action: () => Promise<T>,
  ): Promise<T> {
    this.pending += 1
    const start = (): Promise<T> => {
      this.pending -= 1
      return this.withDeadline(label, timeoutMs, action)
    }
    // Chain on both outcomes so one rejection cannot poison the queue.
    const result = this.tail.then(start, start)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async withDeadline<T>(
    label: string,
    timeoutMs: number,
    action: () => Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.options.onTimeout?.(label, timeoutMs)
        reject(
          new DeviceTimeoutError(
            'DEVICE_TIMEOUT',
            `${label} exceeded ${timeoutMs}ms; the phone may be wedged, ` +
              're-observe before acting again',
          ),
        )
      }, timeoutMs)
      timer.unref?.()
    })
    try {
      return await Promise.race([action(), timeout])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }
}
