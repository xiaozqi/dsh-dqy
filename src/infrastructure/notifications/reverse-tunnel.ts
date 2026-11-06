import { ProcessSupervisor } from '../process-supervisor.js'

export class ReverseTunnelKeepAlive {
  lastError: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight = false

  constructor(
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly localPort = 14123,
    private readonly remotePort = 14123,
    private readonly checkIntervalMs = 60000,
    private readonly supervisor = new ProcessSupervisor(),
  ) {}

  async start(): Promise<void> {
    if (this.timer) {
      return
    }
    await this.ensureRule()
    this.timer = setInterval(() => {
      void this.ensureRule()
    }, this.checkIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async ensureRule(): Promise<void> {
    // A tick must never overlap the previous one: on a disconnected phone the
    // old code spawned one more adb.exe every minute, forever.
    if (this.inFlight) {
      return
    }
    this.inFlight = true
    try {
      const list = await this.runAdb(['reverse', '--list'])
      if (list.includes(`tcp:${this.localPort}`)) {
        return
      }
      await this.runAdb([
        'reverse',
        `tcp:${this.localPort}`,
        `tcp:${this.remotePort}`,
      ])
      this.lastError = null
    } catch (err) {
      this.lastError = (err as Error).message
    } finally {
      this.inFlight = false
    }
  }

  private async runAdb(args: string[]): Promise<string> {
    const full = this.serial ? ['-s', this.serial, ...args] : args
    const result = await this.supervisor.run(this.adbPath, full, {
      timeoutMs: 5000,
    })
    if (result.timedOut) {
      throw new Error(`adb ${args.join(' ')} 超时（5s），进程已被杀掉`)
    }
    if (result.code !== 0) {
      throw new Error(
        `adb ${args.join(' ')} exited with code ${result.code ?? -1}: ${result.stderr.trim()}`,
      )
    }
    return result.stdout
  }
}
