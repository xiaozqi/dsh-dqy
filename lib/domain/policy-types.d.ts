export type PolicySurface = 'message' | 'image' | 'voice' | 'share' | 'moment' | 'comment' | 'mention' | 'device';
export interface PolicyRequest {
    app: string;
    surface: PolicySurface;
    peer?: string;
    text?: string;
}
export type PolicyVerdict = 'allow' | 'dry-run' | 'block';
export interface PolicyDecision {
    verdict: PolicyVerdict;
    reasons: string[];
}
export interface PolicyOptions {
    /**
     * Set only by an owner-approved confirmation (`/confirm approve`).
     *
     * It bypasses the master switch and dry run, never the content rules and
     * never the emergency halt: an approval proves intent, not safety.
     */
    humanApproved?: boolean;
}
export declare function isOutbound(surface: PolicySurface): boolean;
export declare function targetsPerson(surface: PolicySurface): boolean;
export declare function needsText(surface: PolicySurface): boolean;
