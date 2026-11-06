export interface HeartbeatDeps {
    initialIntervalMs: number;
    onTick: () => Promise<void> | void;
}
export declare class HeartbeatScheduler {
    private readonly deps;
    private timer;
    private nextDelayMs;
    constructor(deps: HeartbeatDeps);
    start(): void;
    stop(): void;
    get running(): boolean;
    scheduleNext(ms: number): void;
    private arm;
    private safeTick;
}
