export type QqPeerKind = 'direct' | 'group' | 'service';
/**
 * Classifies a QQ notification into "a person", "a group" or "a service
 * account". Only `direct` should get an automatic reply: replying into a group
 * on every message would spam it, and service accounts never need an answer.
 */
export declare function classifyQqPeer(title: string, text: string): QqPeerKind;
/** Removes the group sender prefix before the text is used as message content. */
export declare function stripPeerPrefix(text: string): string;
