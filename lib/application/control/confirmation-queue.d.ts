import type { StateStorePort } from '../../domain/ports/state-store.port.js';
export interface PendingAction {
    id: string;
    app: string;
    capability: string;
    method: string;
    args: Record<string, unknown>;
    reason: string;
    createdAt: number;
    expiresAt: number;
}
/**
 * Durable inbox of actions the autonomy loop refused to execute on its own.
 *
 * The model can read it, but only the owner can approve it: approvals are
 * exposed as a slash command, never as a tool, so a prompt-injected model
 * cannot talk itself through the gate it just hit.
 */
export declare class ConfirmationQueue {
    private readonly store;
    private readonly ttlMs;
    constructor(store: StateStorePort, ttlMs: number);
    enqueue(input: {
        app: string;
        capability: string;
        method: string;
        args: Record<string, unknown>;
        reason: string;
    }): PendingAction;
    list(): PendingAction[];
    /** Remove and return one action, or null when it is gone or expired. */
    take(id: string): PendingAction | null;
    deny(id: string): boolean;
    private load;
    private save;
    private prune;
}
