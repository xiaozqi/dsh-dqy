import { type UiDriverPort, type UiMatcher } from '../../domain/ports/ui-driver.port.js';
import type { Observation, Point, Size, UiNode } from '../../domain/types.js';
import type { AdbClient } from './adb-client.js';
export declare class AndroidDevice implements UiDriverPort {
    private readonly adb;
    private readonly captureDir;
    /** Re-resolve the serial after a wireless reconnect; returns '' when unknown. */
    private readonly refreshSerial?;
    readonly kind = "adb";
    private cachedSize;
    constructor(adb: AdbClient, captureDir: string, 
    /** Re-resolve the serial after a wireless reconnect; returns '' when unknown. */
    refreshSerial?: (() => string) | undefined);
    connect(): Promise<void>;
    private requireDevice;
    /** Refresh the serial once; false when there is nothing new to try. */
    private tryRefresh;
    isConnected(): Promise<boolean>;
    screenSize(): Promise<Size>;
    foregroundApp(): Promise<string>;
    tap(point: Point): Promise<void>;
    longPress(point: Point, durationMs: number): Promise<void>;
    swipe(from: Point, to: Point, durationMs: number): Promise<void>;
    inputText(text: string): Promise<void>;
    inputChinese(text: string): Promise<void>;
    pressKey(key: 'back' | 'home' | 'recents' | 'enter' | 'wakeup'): Promise<void>;
    openApp(packageName: string): Promise<void>;
    observe(): Promise<Observation>;
    private observeOnce;
    findText(text: string): Promise<Point | null>;
    findNodes(matcher: UiMatcher): Promise<UiNode[]>;
    tapControl(matcher: UiMatcher, _templateHint?: string): Promise<UiNode>;
    pushFile(localPath: string, remotePath: string): Promise<void>;
    pullFile(remotePath: string, localPath: string): Promise<void>;
    playAudio(remotePath: string): Promise<void>;
    recordAudio(durationMs: number, remotePath: string): Promise<void>;
    private search;
    private pruneCaptures;
}
