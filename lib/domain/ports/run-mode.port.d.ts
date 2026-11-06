import type { GateDecision, OutboundMessage } from '../control-types.js';
import type { PolicyDecision, PolicyOptions, PolicyRequest } from '../policy-types.js';
export interface RunModeSnapshot {
    enabled: boolean;
    dryRun: boolean;
    halted: boolean;
}
export interface RunModePort {
    snapshot(): RunModeSnapshot;
    /**
     * Single policy entry point. Every outbound effect (tool, autonomy, DM
     * pipeline, approved confirmation) goes through here, so the emergency halt
     * and the content guard cannot be bypassed by choosing another caller.
     */
    decide(request: PolicyRequest, options?: PolicyOptions): PolicyDecision;
    gate(message: OutboundMessage): GateDecision;
    enable(): void;
    disable(): void;
    setDryRun(on: boolean): void;
    halt(): void;
    resume(): void;
}
