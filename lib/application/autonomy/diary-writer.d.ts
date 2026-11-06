import type { DiaryPort } from '../../domain/ports/autonomy.port.js';
import type { LlmPort } from '../../domain/ports/llm.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
export interface DiaryWriterConfig {
    maxEvents?: number;
    minEvents?: number;
}
/**
 * Writes one first-person diary per calendar day plus the strategies distilled
 * from that day's records. Idempotent: a day that already has a diary record
 * (tagged with its day key) is skipped, so this is safe to call every tick.
 * LLM or parse failures degrade to a raw-text diary and never throw, so a
 * broken model can not stall the autonomy loop.
 */
export declare class DiaryWriter implements DiaryPort {
    private readonly deps;
    private readonly maxEvents;
    private readonly minEvents;
    constructor(deps: {
        llm: LlmPort;
        memory: MemoryPort;
    }, config?: DiaryWriterConfig);
    writeIfDue(now?: Date): Promise<boolean>;
}
export declare function localDayKey(date: Date): string;
