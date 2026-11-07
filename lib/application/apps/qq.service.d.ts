import type { AppAdapter } from '../../domain/ports/app-adapter.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
import type { ConversationPreview, MessageCapability, SendImageInput, SendMessageInput } from '../../domain/ports/capabilities/message.port.js';
import type { MentionInput, SocialCapability } from '../../domain/ports/capabilities/social.port.js';
import type { MomentCapability, MomentInput } from '../../domain/ports/capabilities/moment.port.js';
import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { LlmPort } from '../../domain/ports/llm.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { MessageStatePort } from '../../domain/ports/message-state.port.js';
import type { PolicyDecision } from '../../domain/policy-types.js';
import type { VoicePort } from '../../domain/ports/voice.port.js';
import type { ConversationReply } from '../../domain/app-types.js';
export declare const QQ_PACKAGE = "com.tencent.mobileqq";
export interface QqOptions {
    maxConversations?: number;
    /**
     * Called before a reply is transmitted. The caller wires this to the single
     * outbound policy gate; a blocked/dry-run verdict means nothing is sent.
     */
    authorize?: (input: {
        peer: string;
        text: string;
    }) => PolicyDecision;
}
export interface VoiceTextResult {
    text: string;
    audioPath: string;
    remotePath: string;
    durationMs: number;
    sent: boolean;
}
export declare class QqService implements AppAdapter, MessageCapability, SocialCapability, MomentCapability {
    private readonly driver;
    private readonly llm;
    private readonly memory;
    private readonly voice;
    private readonly messageState?;
    readonly id = "qq";
    readonly displayName = "QQ";
    readonly packageName = "com.tencent.mobileqq";
    readonly capabilities: ReadonlySet<CapabilityId>;
    readonly todos: readonly AdapterTodo[];
    readonly capability: any;
    constructor(driver: UiDriverPort, llm: LlmPort, memory: MemoryPort, voice: VoicePort, messageState?: MessageStatePort | undefined);
    initialize(): Promise<void>;
    sendMessage(input: SendMessageInput): Promise<AdapterResult>;
    sendImage(input: SendImageInput): Promise<AdapterResult>;
    readConversation(peer?: string, limit?: number): Promise<ConversationPreview>;
    mention(input: MentionInput): Promise<AdapterResult>;
    publishMoment(input: MomentInput): Promise<AdapterResult>;
    sendVoiceWithText(input: {
        peer: string;
        text: string;
        voice?: string;
        authorize?: (input: {
            peer: string;
            text: string;
        }) => PolicyDecision;
    }): Promise<VoiceTextResult>;
    /** True when the screen already is this peer's chat and the input bar exists. */
    private isPeerChatOpen;
    /**
     * Reply to one named peer, driven by the notification that just arrived.
     *
     * Unread-badge scanning is unreliable in practice: QQ clears the badge as
     * soon as the notification is handled, so a reply that arrives "now" has no
     * row to find. The notification already carries the peer name, so open that
     * conversation directly and answer the last inbound message.
     */
    replyToPeer(peer: string, authorize: (input: {
        peer: string;
        text: string;
    }) => PolicyDecision, message?: {
        text: string;
        when?: number;
    }): Promise<ConversationReply | null>;
    replyToUnread(options?: QqOptions): Promise<ConversationReply[]>;
    private enterPeerConversation;
    private focusChatInput;
    private submitSend;
    private dismissStaleEditor;
    private enterQzoneFeed;
    private openMomentEditor;
    private composeAndPublishMoment;
    private locateHoldButton;
    /**
     * QQ resumes into the last opened chat, where the conversation list and its
     * search entry are both absent. Both send and reply need the list (reply
     * needs the unread rows, send needs the search box), so back out once when
     * neither marker is on screen. Without this a message arriving while a chat
     * is open makes the reply loop report "no unread" — a false negative.
     */
    private ensureConversationList;
    private collectUnreadRows;
    private readMessages;
    private composeReply;
    private sendReply;
    private peerName;
}
