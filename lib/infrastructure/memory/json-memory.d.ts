import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { MemoryKind, MemoryRecord, TaskRecord } from '../../domain/types.js';
export declare class JsonMemory implements MemoryPort {
    private readonly file;
    private cache;
    constructor(file: string);
    remember(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>;
    recall(query: string, limit?: number, kind?: MemoryKind): Promise<MemoryRecord[]>;
    recent(limit: number): Promise<MemoryRecord[]>;
    saveTaskResult(record: TaskRecord): Promise<void>;
    getTaskResult(app: string): Promise<TaskRecord | null>;
    listTaskResults(): Promise<TaskRecord[]>;
    private load;
    private persist;
}
