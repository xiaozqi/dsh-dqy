import type { DevicePort } from '../../domain/ports/device.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { TaskRecord, UiNode } from '../../domain/types.js';
import type { SignInPlan } from './task-types.js';
export declare function flattenUiText(roots: UiNode[]): string;
export declare class SignInService {
    private readonly device;
    private readonly memory;
    private readonly plans;
    constructor(device: DevicePort, memory: MemoryPort, plans: SignInPlan[]);
    listPlans(): SignInPlan[];
    runByApp(app: string): Promise<TaskRecord>;
    run(plan: SignInPlan): Promise<TaskRecord>;
    private executeStep;
}
