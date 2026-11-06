import type { AdapterResult } from '../../adapter-types.js';
export interface MentionInput {
    friend: string;
    text?: string;
    context?: string;
}
export interface SocialCapability {
    readonly capability: 'social';
    mention(input: MentionInput): Promise<AdapterResult>;
}
