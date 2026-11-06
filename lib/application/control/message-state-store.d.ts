import { type MessagePhase } from '../../domain/control-types.js';
import type { StateStorePort } from '../../domain/ports/state-store.port.js';
import type { MessageStatePort, MessageStateRecord, NewMessageClaim } from '../../domain/ports/message-state.port.js';
export declare class MessageStateStore implements MessageStatePort {
    private readonly store;
    private readonly records;
    constructor(store: StateStorePort);
    seen(key: string): boolean;
    claim(input: NewMessageClaim): MessageStateRecord;
    get(key: string): MessageStateRecord | undefined;
    transition(key: string, phase: MessagePhase, lastError?: string): MessageStateRecord;
    list(): MessageStateRecord[];
    private persist;
}
