import type { AgentAction } from '../domain/types.js';
export interface GuardrailConfig {
    allowedApps: string[];
    forbiddenPackages: string[];
    maxSteps: number;
}
export declare class Guardrails {
    private readonly config;
    constructor(config: GuardrailConfig);
    checkStep(step: number): void;
    checkAction(action: AgentAction): void;
}
