import type { CapabilityId } from '../adapter-types.js';
export interface AutonomySignalBundle {
    notifications: string[];
    now: string;
    memory: string[];
}
export interface AutonomySignalSource {
    collect(): Promise<AutonomySignalBundle>;
}
export interface AutonomyDecision {
    intent: 'act' | 'idle';
    app?: string;
    capability?: CapabilityId;
    method?: string;
    args?: Record<string, unknown>;
    reason: string;
    nextWakeMs?: number;
    newGoal?: string;
}
export interface DiaryPort {
    writeIfDue(now?: Date): Promise<boolean>;
}
export type ActionLevel = 'auto' | 'confirm';
export interface AutonomyPolicyPort {
    classify(app: string, capability: CapabilityId, method: string): ActionLevel;
}
export interface ConfirmHook {
    confirmRequired(decision: AutonomyDecision, reason: string): Promise<void>;
}
