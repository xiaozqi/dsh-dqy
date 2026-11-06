import type { AutonomyLoop, AutonomyTickResult } from './autonomy-loop.js';
import type { HeartbeatScheduler } from '../scheduler/heartbeat-scheduler.js';
export interface AutonomyDriverConfig {
    minWakeMs: number;
    maxWakeMs: number;
    fallbackWakeMs: number;
    wakeOnEvent: boolean;
}
export interface AutonomyDriverDeps {
    loop: Pick<AutonomyLoop, 'runOnce'>;
    scheduler: HeartbeatScheduler;
    config: AutonomyDriverConfig;
}
export declare class AutonomyDriver {
    private readonly deps;
    private busy;
    private pending;
    private lastResult;
    constructor(deps: AutonomyDriverDeps);
    get isBusy(): boolean;
    get lastWake(): AutonomyTickResult | null;
    start(): void;
    stop(): void;
    wake(reason: 'heartbeat' | 'event'): void;
    onAllowEvent(): void;
    private runLocked;
    private computeNextWakeMs;
}
