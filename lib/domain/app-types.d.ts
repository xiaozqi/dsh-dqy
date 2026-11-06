import type { Point } from './types.js';
export interface ConversationMessage {
    sender: string;
    content: string;
    isSelf: boolean;
    time: string;
}
export interface ConversationReply {
    peer: string;
    incoming: ConversationMessage[];
    reply: string;
    sent: boolean;
}
export interface FeedSession {
    app: string;
    watched: number;
    liked: number;
    finishedAt: string;
}
export interface GameStep {
    action: string;
    target?: string;
    point?: Point;
    reason: string;
}
export interface GameRun {
    game: string;
    rounds: number;
    steps: GameStep[];
    finishedAt: string;
}
