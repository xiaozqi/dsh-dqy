import type { LlmPort } from '../../domain/ports/llm.port.js';
import type { MessageStatePort } from '../../domain/ports/message-state.port.js';
import type { RunModePort } from '../../domain/ports/run-mode.port.js';
import type { DirectMessageSender } from '../../domain/ports/dm-sender.port.js';
import type { NotificationEvent } from '../../domain/notification-types.js';
export interface DmWatchConfig {
    dedupeWindowMs: number;
    /** `${app}:${peer}` entries that belong to the phone owner. Tone only. */
    ownerPeers?: readonly string[];
}
export type DmWatchResult = 'duplicate' | 'ignored' | 'blocked' | 'dry-run' | 'sent';
export interface DmWatchOutcome {
    key: string;
    result: DmWatchResult;
    detail: string;
}
export declare class DmWatchPipeline {
    private readonly messageState;
    private readonly runMode;
    private readonly llm;
    private readonly sender;
    private readonly config;
    constructor(messageState: MessageStatePort, runMode: RunModePort, llm: LlmPort, sender: DirectMessageSender, config: DmWatchConfig);
    handle(event: NotificationEvent): Promise<DmWatchOutcome>;
    private sendWithRetry;
    private decideReply;
    private askForReply;
    private systemPrompt;
}
