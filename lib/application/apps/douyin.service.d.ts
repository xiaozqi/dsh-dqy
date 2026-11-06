import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { FeedSession } from '../../domain/app-types.js';
import type { FeedCapability, FeedInput } from '../../domain/ports/capabilities/feed.port.js';
import type { CommentCapability, CommentInput, CommentItem } from '../../domain/ports/capabilities/comment.port.js';
import type { MentionInput, SocialCapability } from '../../domain/ports/capabilities/social.port.js';
import type { LiveCapability, WatchLiveInput } from '../../domain/ports/capabilities/live.port.js';
import type { PetCapability } from '../../domain/ports/capabilities/pet.port.js';
export declare const DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
type CapabilityTag = FeedCapability['capability'] & CommentCapability['capability'] & SocialCapability['capability'] & LiveCapability['capability'] & PetCapability['capability'];
export interface DouyinOptions {
    videos?: number;
    watchMs?: number;
    likeProbability?: number;
    likeKeywords?: string[];
}
export interface InteractResult {
    action: string;
    detail: string;
    sent: boolean;
}
export declare class DouyinService implements AppAdapter, FeedCapability, CommentCapability, SocialCapability, LiveCapability, PetCapability {
    private readonly driver;
    private readonly memory;
    readonly id = "douyin";
    readonly displayName = "\u6296\u97F3";
    readonly packageName = "com.ss.android.ugc.aweme";
    readonly capabilities: ReadonlySet<CapabilityId>;
    readonly todos: readonly AdapterTodo[];
    readonly capability: CapabilityTag;
    constructor(driver: UiDriverPort, memory: MemoryPort);
    initialize(): Promise<void>;
    browseFeed(options?: DouyinOptions): Promise<FeedSession>;
    browseFeed(input: FeedInput): Promise<AdapterResult>;
    likeCurrentVideo(): Promise<InteractResult>;
    comment(text: string): Promise<InteractResult>;
    comment(input: CommentInput): Promise<AdapterResult>;
    browseComments(limit?: number): Promise<{
        items: CommentItem[];
    }>;
    replyComment(input: CommentInput): Promise<AdapterResult>;
    forward(target: string): Promise<InteractResult>;
    mention(friend: string, text?: string): Promise<InteractResult>;
    mention(input: MentionInput): Promise<AdapterResult>;
    watchLive(input: WatchLiveInput): Promise<AdapterResult>;
    feedPet(): Promise<AdapterResult>;
    private runFeedPet;
    private shouldLike;
    private likeCurrent;
    private nextVideo;
    private openCommentPanel;
    private waitInput;
    private typeTextIntoCurrentInput;
    private tapSend;
    private logEvent;
}
export {};
