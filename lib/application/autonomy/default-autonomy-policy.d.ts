import type { CapabilityId } from '../../domain/adapter-types.js';
import type { ActionLevel, AutonomyPolicyPort } from '../../domain/ports/autonomy.port.js';
export interface DefaultAutonomyPolicyConfig {
    autoActions: string[];
    forbiddenActions: string[];
    guardEnabled: boolean;
}
export declare class DefaultAutonomyPolicy implements AutonomyPolicyPort {
    private readonly auto;
    private readonly forbidden;
    guardEnabled: boolean;
    constructor(cfg: DefaultAutonomyPolicyConfig);
    classify(app: string, capability: CapabilityId, method: string): ActionLevel;
}
