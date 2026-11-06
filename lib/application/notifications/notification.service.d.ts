import type { NotificationCancelSink, NotificationPort, NotificationSource, NotificationStats } from '../../domain/ports/notification.port.js';
import type { NotificationDecision, NotificationEvent } from '../../domain/notification-types.js';
import type { NotificationPipeline } from './pipeline.js';
export declare class NotificationService implements NotificationPort {
    private readonly sources;
    private readonly pipeline;
    private readonly recentCapacity;
    private readonly cancelSink?;
    private readonly cancelLogPath?;
    private readonly allowListener?;
    /**
     * A filter that throws must block instead of delivering the event. An
     * allowed event can wake the autonomy loop, so failing open here would let
     * a broken filter turn into an autonomous action.
     */
    private readonly failClosed;
    private received;
    private allowed;
    private blocked;
    private canceled;
    private readonly droppedBy;
    private readonly buffer;
    private readonly listeners;
    private queue;
    private unsubscribes;
    private startedFlag;
    constructor(sources: NotificationSource[], pipeline: NotificationPipeline, recentCapacity?: number, cancelSink?: NotificationCancelSink | undefined, cancelLogPath?: string | undefined, allowListener?: ((event: NotificationEvent) => void) | undefined, 
    /**
     * A filter that throws must block instead of delivering the event. An
     * allowed event can wake the autonomy loop, so failing open here would let
     * a broken filter turn into an autonomous action.
     */
    failClosed?: boolean);
    get started(): boolean;
    get connected(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    onEvent(cb: (d: NotificationDecision) => void): () => void;
    recent(limit?: number): NotificationDecision[];
    stats(): NotificationStats;
    private enqueue;
    private handle;
    private pushRecent;
    private appendCancelLog;
}
