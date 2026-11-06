import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js';
import type { CommentCapability, CommentInput, CommentItem } from '../../domain/ports/capabilities/comment.port.js';
import type { FeedCapability, FeedInput } from '../../domain/ports/capabilities/feed.port.js';
import type { MessageCapability, ConversationPreview, SendImageInput, SendMessageInput } from '../../domain/ports/capabilities/message.port.js';
import type { MentionInput, SocialCapability } from '../../domain/ports/capabilities/social.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
export declare const WEIBO_PACKAGE = "com.sina.weibo";
export declare class WeiboAdapter implements AppAdapter, FeedCapability, CommentCapability, SocialCapability, MessageCapability {
    private readonly driver;
    private readonly memory;
    readonly id = "weibo";
    readonly displayName = "\u5FAE\u535A";
    readonly packageName = "com.sina.weibo";
    readonly capabilities: ReadonlySet<CapabilityId>;
    readonly todos: readonly AdapterTodo[];
    readonly capability: never;
    constructor(driver: UiDriverPort, memory: MemoryPort);
    initialize(): Promise<void>;
    browseFeed(input?: FeedInput): Promise<AdapterResult>;
    comment(input: CommentInput): Promise<AdapterResult>;
    replyComment(input: CommentInput): Promise<AdapterResult>;
    browseComments(limit?: number): Promise<{
        items: CommentItem[];
    }>;
    mention(input: MentionInput): Promise<AdapterResult>;
    sendMessage(input: SendMessageInput): Promise<AdapterResult>;
    sendImage(input: SendImageInput): Promise<AdapterResult>;
    readConversation(peer?: string, limit?: number): Promise<ConversationPreview>;
    private openWeibo;
    private tapAny;
    private containsKeyword;
    private likeCurrent;
    private swipeUp;
    private remember;
    private errText;
}
