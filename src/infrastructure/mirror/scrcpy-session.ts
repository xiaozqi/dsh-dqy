import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { MirrorState } from '../../domain/mirror-types.js'

// On Windows proc.kill() only terminates the parent process; the adb child of
// scrcpy would survive, so the whole tree is killed with taskkill /T. The
// absolute System32 path is used because a stripped PATH may not expose
// taskkill, and the child error event is swallowed to avoid an unhandled crash.
function killTree(pid: number): void {
  if (!pid) return
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    return
  }
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const taskkill = join(root, 'System32', 'taskkill.exe')
  try {
    const child = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
  } catch {
    /* already gone */
  }
}

export interface SessionDeps {
  scrcpy: string
  args: string[]
  graceMs: number
  onExit: (code: number, byUser: boolean) => void
}

// Owns a single scrcpy process. The process exit event is the only source of
// truth: there is no "process dead but state still running" intermediate state.
export class ScrcpySession {
  private proc: ChildProcess | null = null
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private exitTimer: ReturnType<typeof setTimeout> | null = null
  private state: MirrorState = 'idle'
  private error = ''
  private since = 0
  private stderrTail: string[] = []

  constructor(private readonly deps: SessionDeps) {}

  start(): { ok: boolean; error?: string; already?: boolean } {
    if (this.state === 'running' || this.state === 'starting') {
      return { ok: true, already: true }
    }
    this.error = ''
    this.since = Date.now()
    this.stderrTail = []
    this.state = 'starting'

    let proc: ChildProcess
    try {
      proc = spawn(this.deps.scrcpy, this.deps.args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      this.error = `spawn scrcpy failed: ${e instanceof Error ? e.message : String(e)}`
      this.state = 'error'
      return { ok: false, error: this.error }
    }
    this.proc = proc

    const collect = (data: Buffer) => {
      const text = String(data).trim()
      if (!text) return
      this.stderrTail.push(text)
      if (this.stderrTail.length > 60) this.stderrTail.shift()
    }
    proc.stdout?.on('data', collect)
    proc.stderr?.on('data', collect)
    proc.on('error', e => {
      this.error = `spawn scrcpy failed: ${e.message}`
      this.state = 'error'
    })
    proc.on('exit', code => this.handleExit(code ?? -1))

    // Surviving graceMs means the window is up; scrcpy failures exit earlier.
    this.graceTimer = setTimeout(() => {
      if (this.state === 'starting') this.state = 'running'
    }, this.deps.graceMs)

    return { ok: true }
  }

  private handleExit(code: number): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
    if (this.exitTimer) {
      clearTimeout(this.exitTimer)
      this.exitTimer = null
    }
    const byUser = this.state === 'stopping'
    this.proc = null
    if (byUser) {
      this.state = 'idle'
      this.deps.onExit(0, true)
      return
    }
    if (code === 0) {
      this.state = 'idle'
      this.error = ''
    } else {
      this.state = 'error'
      this.error = `scrcpy exited with ${code}${this.tail() ? `: ${this.tail()}` : ''}`
    }
    this.deps.onExit(code, false)
  }

  stop(): { ok: boolean; already?: boolean } {
    if (!this.proc) {
      this.state = 'idle'
      return { ok: true, already: true }
    }
    this.state = 'stopping'
    const pid = this.proc.pid ?? 0
    try {
      this.proc.kill()
    } catch {
      /* already gone */
    }
    killTree(pid)
    this.exitTimer = setTimeout(() => {
      if (this.state !== 'stopping') {
        return
      }
      // Escalate once, then tell the truth. The old code nulled the handle and
      // claimed "idle" after 3s regardless: a survived process became
      // unkillable (no handle left) and the panel never learned it was stuck.
      killTree(pid)
      try {
        this.proc?.kill()
      } catch {
        /* already gone */
      }
      this.error = `scrcpy (pid ${pid}) 未在 5s 内退出，请手动结束该进程`
      this.state = 'error'
      this.deps.onExit(-1, true)
    }, 5000)
    return { ok: true }
  }

  getState(): MirrorState {
    return this.state
  }

  getSince(): number {
    return this.since
  }

  getError(): string {
    return this.error
  }

  private tail(): string {
    return this.stderrTail.slice(-3).join(' | ').slice(0, 300)
  }
}
