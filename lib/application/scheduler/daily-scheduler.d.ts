import type { SchedulePlan, ScheduleTick } from '../../domain/schedule-types.js';
export interface SchedulerDeps {
    plans: SchedulePlan[];
    run: (plan: SchedulePlan) => Promise<void>;
    tickIntervalMs?: number;
}
export declare class DailyScheduler {
    private readonly deps;
    private timer;
    private readonly fired;
    private readonly history;
    constructor(deps: SchedulerDeps);
    start(): void;
    stop(): void;
    listHistory(): ScheduleTick[];
    listPlans(): SchedulePlan[];
    private tick;
}
