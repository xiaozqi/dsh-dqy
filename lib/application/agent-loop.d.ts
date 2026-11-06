import type { LlmPort } from '../domain/ports/llm.port.js';
import type { DevicePort } from '../domain/ports/device.port.js';
import type { MemoryPort } from '../domain/ports/memory.port.js';
import type { VoicePort } from '../domain/ports/voice.port.js';
import type { RunResult } from '../domain/types.js';
import type { Guardrails } from './guardrails.js';
export declare class AgentLoop {
    private readonly device;
    private readonly memory;
    private readonly llm;
    private readonly guardrails;
    private readonly persona;
    private readonly voice?;
    constructor(device: DevicePort, memory: MemoryPort, llm: LlmPort, guardrails: Guardrails, persona: string, voice?: VoicePort | undefined);
    run(goal: string): Promise<RunResult>;
    private runInner;
    private recallLessons;
    private learnFromSuccess;
    private learnFromFailure;
    private reflect;
    private executeDeviceAction;
    private systemPrompt;
    private describe;
    private compactNodes;
}
