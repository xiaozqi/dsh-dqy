import type { CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapterRegistry } from '../../domain/ports/app-adapter.port.js';
import type { LlmPort } from '../../domain/ports/llm.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { AutonomyDecision, AutonomyPolicyPort, AutonomySignalSource, ConfirmHook, DiaryPort } from '../../domain/ports/autonomy.port.js';
export declare const DEFAULT_CAPABILITY_METHOD_MAP: Record<CapabilityId, string>;
export interface AutonomyTickResult {
    decided: boolean;
    executed: boolean;
    confirmed: boolean;
    skipped: boolean;
    decision?: AutonomyDecision;
    error?: string;
    nextWakeMs?: number;
}
export interface AutonomyLoopDeps {
    memory: MemoryPort;
    llm: LlmPort;
    registry: AppAdapterRegistry;
    signals: AutonomySignalSource;
    policy: AutonomyPolicyPort;
    confirm?: ConfirmHook;
    capabilityMethodMap?: Record<CapabilityId, string>;
    diary?: DiaryPort;
}
export declare class AutonomyLoop {
    private readonly deps;
    private readonly methodMap;
    constructor(deps: AutonomyLoopDeps);
    runOnce(): Promise<AutonomyTickResult>;
    private writeDiaryIfDue;
    private tick;
    private validate;
    private execute;
    private rememberSelfGoal;
    private runConfirm;
    private learn;
    private systemPrompt;
    private renderBundle;
}
