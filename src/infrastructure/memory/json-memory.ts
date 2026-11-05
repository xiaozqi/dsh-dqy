import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MemoryPort } from '../../domain/ports/memory.port.js'
import type { MemoryKind, MemoryRecord, TaskRecord } from '../../domain/types.js'

interface MemoryFile {
  records: MemoryRecord[]
  tasks: Record<string, TaskRecord>
}

const EMPTY: MemoryFile = { records: [], tasks: {} }

export class JsonMemory implements MemoryPort {
  private cache: MemoryFile | null = null

  constructor(private readonly file: string) {
    mkdir(dirname(file), { recursive: true })
  }

  async remember(
    record: Omit<MemoryRecord, 'id' | 'createdAt'>,
  ): Promise<MemoryRecord> {
    const db = await this.load()
    const full: MemoryRecord = {
      ...record,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    db.records.push(full)
    await this.persist()
    return full
  }

  async recall(
    query: string,
    limit = 5,
    kind?: MemoryKind,
  ): Promise<MemoryRecord[]> {
    const db = await this.load()
    const terms = tokenize(query)
    return db.records
      .filter(record => kind === undefined || record.kind === kind)
      .map(record => ({ record, score: scoreRecord(record, terms) }))
      .filter(item => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.record.createdAt.localeCompare(a.record.createdAt),
      )
      .slice(0, limit)
      .map(item => item.record)
  }

  async recent(limit: number): Promise<MemoryRecord[]> {
    const db = await this.load()
    return [...db.records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async saveTaskResult(record: TaskRecord): Promise<void> {
    const db = await this.load()
    db.tasks[record.app] = record
    await this.persist()
  }

  async getTaskResult(app: string): Promise<TaskRecord | null> {
    const db = await this.load()
    return db.tasks[app] ?? null
  }

  async listTaskResults(): Promise<TaskRecord[]> {
    const db = await this.load()
    return Object.values(db.tasks)
  }

  private async load(): Promise<MemoryFile> {
    if (this.cache) return this.cache
    let db: MemoryFile
    try {
      const raw = await readFile(this.file, 'utf8')
      db = JSON.parse(raw) as MemoryFile
    } catch {
      db = structuredClone(EMPTY)
    }
    this.cache = db
    return db
  }

  private async persist(): Promise<void> {
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.cache), 'utf8')
    await rename(tmp, this.file)
  }
}

function tokenize(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) ?? []
}

function scoreRecord(record: MemoryRecord, terms: string[]): number {
  const haystack = record.content.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) score += 1
    if (record.tags.some(tag => tag.toLowerCase() === term)) score += 2
  }
  return score
}
