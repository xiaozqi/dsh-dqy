import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import type { StateStorePort } from '../../domain/ports/state-store.port.js'

function fileName(key: string): string {
  const safe = key.replace(/[^a-z0-9_-]+/gi, '_')
  return `${safe}.json`
}

// Synchronous JSON store. Writes go through a temp file + rename so a crash
// mid-write can never leave a truncated state file that breaks startup.
export class FileStateStore implements StateStorePort {
  constructor(private readonly dir: string) {
    mkdirSync(this.dir, { recursive: true })
  }

  load<T>(key: string, fallback: T): T {
    const path = this.pathFor(key)
    if (!existsSync(path)) {
      return fallback
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
      // Corrupt state must not take the plugin down; start from the fallback.
      return fallback
    }
  }

  save<T>(key: string, value: T): void {
    const path = this.pathFor(key)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(value), 'utf8')
    renameSync(tmp, path)
  }

  private pathFor(key: string): string {
    return resolve(this.dir, fileName(key))
  }
}
