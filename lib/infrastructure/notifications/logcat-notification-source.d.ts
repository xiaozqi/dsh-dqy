import type { NotificationEvent } from '../../domain/notification-types.js';
import type { NotificationSource } from '../../domain/ports/notification.port.js';
export declare class LogcatNotificationSource implements NotificationSource {
    private readonly adbPath;
    private readonly serial;
    private readonly defaultImportance;
    private child;
    private readonly listeners;
    private connectedFlag;
    private startedFlag;
    private seq;
    private restartAttempts;
    private stdoutBuffer;
    private readonly pending;
    private readonly postedAt;
    constructor(adbPath: string, serial: string, defaultImportance?: number);
    get connected(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    subscribe(listener: (e: NotificationEvent) => void): () => void;
    private spawnChild;
    private scheduleRestart;
    private handleLine;
    private handleEnqueue;
    private flush;
    private handleChannelInfo;
    private handlePosted;
    private emit;
}
