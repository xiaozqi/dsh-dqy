import type { NotificationEvent } from '../../domain/notification-types.js';
import type { NotificationCancelSink, NotificationSource } from '../../domain/ports/notification.port.js';
import { type LogFn } from '../file-logger.js';
export interface HttpNotificationOptions {
    /**
     * Interface to bind. Loopback by default: `adb reverse` already forwards the
     * phone to the host loopback, so a wider bind only lets the LAN forge
     * notifications into an agent that can send messages.
     */
    bindHost?: string;
    /** When set, the bridge must send `x-fish-token` with the same value. */
    token?: string;
    maxBodyBytes?: number;
    /** App names allowed to inject events; empty means "any". */
    allowedApps?: readonly string[];
    logger?: LogFn;
}
export declare class HttpNotificationSource implements NotificationSource, NotificationCancelSink {
    private readonly port;
    lastError: string | null;
    private server;
    private readonly listeners;
    private readonly pendingCancels;
    private readonly logger;
    private readonly bindHost;
    private readonly token;
    private readonly maxBodyBytes;
    private readonly allowedApps;
    private seq;
    constructor(port: number | undefined, logPath: string, options?: HttpNotificationOptions);
    get connected(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    subscribe(listener: (e: NotificationEvent) => void): () => void;
    pushCancel(key: string): void;
    private handle;
    private toEvent;
    private appendLog;
}
