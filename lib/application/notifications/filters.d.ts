import type { LlmPort } from '../../domain/ports/llm.port.js';
import type { NotificationDecision, NotificationEvent, NotificationFilter } from '../../domain/notification-types.js';
export interface NotificationRule {
    match: RegExp;
    action: 'allow' | 'block';
}
export declare class WhitelistFilter implements NotificationFilter {
    private readonly whitelist;
    readonly id = "whitelist";
    constructor(whitelist: ReadonlySet<string>);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
}
export declare class ImportanceFilter implements NotificationFilter {
    private readonly minImportance;
    readonly id = "importance";
    constructor(minImportance: number);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
}
export declare class AppBlocklistFilter implements NotificationFilter {
    private readonly blockedApps;
    readonly id = "app-blocklist";
    constructor(blockedApps: ReadonlySet<string>);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
}
export declare class RuleFilter implements NotificationFilter {
    private readonly rules;
    readonly id = "rules";
    constructor(rules: readonly NotificationRule[]);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
}
export declare class SemanticFilter implements NotificationFilter {
    private readonly llm;
    private readonly enabled;
    readonly id = "semantic";
    private static readonly timeoutMs;
    constructor(llm: LlmPort | null, enabled: boolean);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
    private judge;
    private chatWithTimeout;
    private static parseRelevant;
}
export declare class DedupeFilter implements NotificationFilter {
    private readonly windowMs;
    readonly id = "dedupe";
    private readonly seen;
    constructor(windowMs: number);
    apply(event: NotificationEvent): Promise<NotificationDecision | null>;
    private prune;
}
