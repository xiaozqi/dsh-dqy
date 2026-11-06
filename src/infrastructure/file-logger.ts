import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'

export type LogFn = (msg: string) => void

// Create a logger that appends timestamped lines to a file with simple
// size-based rotation. Write failures are swallowed so logging can never break
// the main flow.
export function createFileLogger(
  path: string,
  maxBytes = 1024 * 1024,
): LogFn {
  return (msg: string): void => {
    const line = `${new Date().toISOString()} ${msg}`
    try {
      mkdirSync(dirname(path), { recursive: true })
      if (existsSync(path) && statSync(path).size > maxBytes) {
        renameSync(path, `${path}.1`)
      }
      appendFileSync(path, `${line}\n`)
    } catch {
      /* logging is best-effort */
    }
  }
}
