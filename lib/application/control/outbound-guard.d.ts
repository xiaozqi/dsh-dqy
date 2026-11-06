import type { PolicySurface } from '../../domain/policy-types.js';
export interface OutboundGuardConfig {
    allowedPeers: ReadonlySet<string>;
    maxLength: number;
    blockUrl: boolean;
}
export interface OutboundContent {
    app: string;
    surface: PolicySurface;
    peer?: string;
    text: string;
}
export declare function peerKey(app: string, peer: string): string;
/** Parse one `control.allowedPeers` entry, or null when it is malformed. */
export declare function parsePeerEntry(entry: string): string | null;
export declare function buildPeerSet(entries: readonly string[]): Set<string>;
export declare class OutboundGuard {
    private readonly config;
    constructor(config: OutboundGuardConfig);
    inspect(content: OutboundContent): string[];
}
