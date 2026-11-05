import type { MemoryKind, MemoryRecord, TaskRecord } from '../types.js'

export interface MemoryPort {
  remember(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>
  recall(
    query: string,
    limit?: number,
    kind?: MemoryKind,
  ): Promise<MemoryRecord[]>
  recent(limit: number): Promise<MemoryRecord[]>
  saveTaskResult(record: TaskRecord): Promise<void>
  getTaskResult(app: string): Promise<TaskRecord | null>
  listTaskResults(): Promise<TaskRecord[]>
}
