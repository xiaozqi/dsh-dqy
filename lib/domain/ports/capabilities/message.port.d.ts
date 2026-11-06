import type { AdapterResult } from '../../adapter-types.js';
export interface SendMessageInput {
    peer: string;
    text: string;
}
export interface SendImageInput {
    peer: string;
    localImagePath: string;
    caption?: string;
}
export interface ConversationPreview {
    peer: string;
    incoming: string[];
}
export interface MessageCapability {
    readonly capability: 'message';
    sendMessage(input: SendMessageInput): Promise<AdapterResult>;
    sendImage(input: SendImageInput): Promise<AdapterResult>;
    readConversation(peer?: string, limit?: number): Promise<ConversationPreview>;
}
