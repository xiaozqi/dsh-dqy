import type { GateDecision, OutboundMessage } from '../../domain/control-types.js';
import type { PolicyDecision, PolicyOptions, PolicyRequest } from '../../domain/policy-types.js';
import type { StateStorePort } from '../../domain/ports/state-store.port.js';
import type { RunModePort, RunModeSnapshot } from '../../domain/ports/run-mode.port.js';
import type { OutboundGuard } from './outbound-guard.js';
export declare class RunMode implements RunModePort {
    private readonly store;
    private readonly guard;
    private state;
    constructor(store: StateStorePort, guard: OutboundGuard, initial?: RunModeSnapshot);
    snapshot(): RunModeSnapshot;
    decide(request: PolicyRequest, options?: PolicyOptions): PolicyDecision;
    gate(message: OutboundMessage): GateDecision;
    enable(): void;
    disable(): void;
    setDryRun(on: boolean): void;
    halt(): void;
    resume(): void;
    private update;
}
