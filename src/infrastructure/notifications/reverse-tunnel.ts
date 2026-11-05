import { spawn } from 'node:child_process'

export class ReverseTunnelKeepAlive {
  lastError: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly localPort = 14123,
    private readonly remotePort = 14123,
    private readonly checkIntervalMs = 60000,
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
    }
  }

  private runAdb(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const full = this.serial ? ['-s', this.serial, ...args] : args
      const child = spawn(this.adbPath, full, { windowsHide: true })
      const chunks: Buffer[] = []
      child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk as Buffer)))
      child.on('error', err => {
        reject(err)
      })
      child.on('close', code => {
        const out = Buffer.concat(chunks).toString('utf8')
        if (code !== 0) {
          reject(new Error(`adb ${args.join(' ')} exited with code ${code ?? -1}`))
        } else {
          resolve(out)
        }
      })
    })
  }
}
