import type { Point, Observation, Size, UiNode } from '../../domain/types.js';
import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js';
export interface SerialDeviceOptions {
    /** Deadline for one device call. */
    timeoutMs: number;
    /** observe() captures a screenshot plus a UI dump, so it gets more room. */
    observeTimeoutMs?: number;
    onTimeout?(label: string, timeoutMs: number): void;
}
/**
 * Serializes every device call and gives each one a deadline.
 *
 * One phone is shared by the tools, the autonomy heartbeat, the notification
 * pipeline and the mirror panel. Without a mutex two flows interleave: the
 * concrete first casualty is the IME — two concurrent `inputChinese` calls both
 * read "previous IME", restore it twice, and the phone is left on ADBKeyBoard
 * with the user's keyboard gone.
 *
 * A timeout rejects the caller but cannot cancel the running adb child: the
 * queue advances so one wedged call cannot block the plugin forever, and the
 * timeout is reported so the caller re-observes instead of trusting its state.
 */
export declare class SerialDevice implements UiDriverPort {
    private readonly inner;
    private readonly options;
    readonly kind: string;
    private tail;
    constructor(inner: UiDriverPort, options: SerialDeviceOptions);
    connect(): Promise<void>;
    isConnected(): Promise<boolean>;
    screenSize(): Promise<Size>;
    foregroundApp(): Promise<string>;
    tap(point: Point): Promise<void>;
    longPress(point: Point, durationMs: number): Promise<void>;
    swipe(from: Point, to: Point, durationMs: number): Promise<void>;
    inputText(text: string): Promise<void>;
    inputChinese(text: string): Promise<void>;
    pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void>;
    openApp(packageName: string): Promise<void>;
    observe(): Promise<Observation>;
    findText(text: string): Promise<Point | null>;
    findNodes(matcher: UiMatcher): Promise<UiNode[]>;
    tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode>;
    pushFile(localPath: string, remotePath: string): Promise<void>;
    pullFile(remotePath: string, localPath: string): Promise<void>;
    playAudio(remotePath: string): Promise<void>;
    recordAudio(durationMs: number, remotePath: string): Promise<void>;
    /** Number of callers currently waiting for their turn, for diagnostics. */
    get queued(): number;
    private pending;
    private run;
    private withDeadline;
}
