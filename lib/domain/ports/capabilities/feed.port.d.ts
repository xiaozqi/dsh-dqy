import type { AdapterResult } from '../../adapter-types.js';
export interface FeedInput {
    count?: number;
    watchMs?: number;
    likeKeywords?: string[];
}
export interface FeedCapability {
    readonly capability: 'feed';
    browseFeed(input: FeedInput): Promise<AdapterResult>;
}
