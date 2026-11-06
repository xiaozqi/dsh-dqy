import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

// Run an external command with a timeout. Never rejects: a start failure
// (ENOENT) or a timeout is folded into code -1 so callers only branch on
// code/stdout/stderr.
export function runCommand(
  cmd: string,
  args: readonly string[],
  timeoutMs = 8000,
): Promise<CommandResult> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (result: CommandResult): void => {
      if (done) return
      done = true
      resolve(result)
    }

    let proc
    try {
      proc = spawn(cmd, args, { windowsHide: true })
    } catch (e) {
      finish({
        code: -1,
        stdout,
        stderr: e instanceof Error ? e.message : String(e),
      })
      return
    }

    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
      finish({ code: -1, stdout, stderr: 'timeout' })
    }, timeoutMs)

    proc.stdout.on('data', d => {
      stdout += d
    })
    proc.stderr.on('data', d => {
      stderr += d
    })
    proc.on('error', e => {
      clearTimeout(timer)
      finish({ code: -1, stdout, stderr: e.message })
    })
    proc.on('close', code => {
      clearTimeout(timer)
      finish({ code: code ?? -1, stdout, stderr })
    })
  })
}
