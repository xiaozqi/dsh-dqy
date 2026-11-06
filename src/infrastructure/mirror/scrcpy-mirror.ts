import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MirrorConfig, MirrorStatus } from '../../domain/mirror-types.js'
import type { MirrorPort } from '../../domain/ports/mirror.port.js'
import { runCommand } from '../command-runner.js'
import { MIRROR_WINDOW_TITLE as WINDOW_TITLE } from '../../domain/mirror-defaults.js'
import { buildScrcpyArgs } from './scrcpy-args.js'
import { ScrcpySession } from './scrcpy-session.js'

export interface ScrcpyMirrorDeps {
  resolveAdb: (configured: string) => string
  resolveScrcpy: (configured: string) => string
  onExit: (code: number, byUser: boolean) => void
}

// Manages the scrcpy process only. Device discovery and reconnect scheduling
// belong to the application service; this adapter reports exits through the
// injected callback and never mutates configuration.
export class ScrcpyMirror implements MirrorPort {
  private session: ScrcpySession | null = null

  constructor(private readonly deps: ScrcpyMirrorDeps) {}

  async launch(
    config: MirrorConfig,
    serial: string,
  ): Promise<{ ok: boolean; error?: string; already?: boolean }> {
    const state = this.session?.getState()
    if (state === 'running' || state === 'starting') {
      return { ok: true, already: true }
    }
    const scrcpy = this.deps.resolveScrcpy(config.scrcpy)
    if (scrcpy !== 'scrcpy' && !existsSync(scrcpy)) {
      return {
        ok: false,
        error: '找不到 scrcpy：请先安装 scrcpy，或在配置里填绝对路径',
      }
    }

    await this.killStrayScrcpy()

    this.session = new ScrcpySession({
      scrcpy,
      args: buildScrcpyArgs(config, serial),
      graceMs: config.graceMs,
      onExit: (code, byUser) => this.deps.onExit(code, byUser),
    })
    const result = this.session.start()
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  }

  async stop(): Promise<{ ok: boolean; already?: boolean }> {
    if (!this.session) return { ok: true, already: true }
    return this.session.stop()
  }

  status(): MirrorStatus {
    const state = this.session?.getState() ?? 'idle'
    return {
      state,
      running: state === 'running',
      busy: state === 'starting' || state === 'stopping',
      error: this.session?.getError() ?? '',
      since: this.session?.getSince() ?? 0,
      serial: '',
      scrcpy: '',
    }
  }

  // Remove only scrcpy windows whose title matches ours; a generic image kill
  // would also terminate scrcpy processes started by the user.
  private async killStrayScrcpy(): Promise<void> {
    if (process.platform !== 'win32') return
    const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    const powershell = join(
      root,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const script =
      'Get-Process -Name scrcpy -ErrorAction SilentlyContinue | ' +
      `Where-Object { $_.MainWindowTitle -eq '${WINDOW_TITLE}' } | ` +
      'ForEach-Object { $_.Kill() }'
    await runCommand(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      5000,
    ).catch(() => {})
  }
}
