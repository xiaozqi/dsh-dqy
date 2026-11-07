/**
 * Polls the phone's own notification store and reports new QQ notifications.
 *
 * Why not rely on the notification *event* pipeline: QQ only posts a
 * notification while it is in the background, the aggregated notification
 * carries no peer, and `NotificationListener` needs the bridge APK to be
 * alive. `dumpsys notification` is read-only, needs no foreground focus, and
 * shows the per-conversation title even when the shade groups them.
 */
export interface QqPing {
    key: string;
    title: string;
    text: string;
}
export interface QqNotificationWatcherOptions {
    /** Runs `dumpsys notification --noredact` and returns the dump. */
    readNotifications(): Promise<string>;
    /** Called for a notification key whose text is new or changed. */
    onPing(ping: QqPing): void | Promise<void>;
    intervalMs?: number;
    /** QQ package name; defaults to com.tencent.mobileqq. */
    packageName?: string;
    logger?(message: string): void;
}
/** Parse QQ records out of a `dumpsys notification` dump. */
export declare function parseQqNotifications(dump: string, packageName?: string): QqPing[];
export declare class QqNotificationWatcher {
    private readonly options;
    private timer;
    private tickBusy;
    private readonly seen;
    constructor(options: QqNotificationWatcherOptions);
    start(): void;
    stop(): void;
    get running(): boolean;
    private tick;
}
