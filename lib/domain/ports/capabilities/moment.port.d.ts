import type { AdapterResult } from '../../adapter-types.js';
export interface MomentInput {
    text: string;
    content?: string;
    visibleTo?: string;
}
export interface MomentCapability {
    readonly capability: 'moment';
    publishMoment(input: MomentInput): Promise<AdapterResult>;
}
