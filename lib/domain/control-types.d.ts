export interface OutboundMessage {
    app: string;
    conversationId: string;
    peer: string;
    text: string;
}
export type GateVerdict = 'send' | 'dry-run' | 'block';
export interface GateDecision {
    verdict: GateVerdict;
    reasons: string[];
}
export type MessagePhase = 'pending' | 'filtered' | 'decided' | 'acting' | 'sent' | 'verified' | 'failed';
export declare const PHASE_TRANSITIONS: Record<MessagePhase, readonly MessagePhase[]>;
