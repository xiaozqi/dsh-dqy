import { type UiDriverPort, type UiMatcher } from '../../domain/ports/ui-driver.port.js';
import type { Observation, Point, Size, UiNode } from '../../domain/types.js';
/**
 * UI driver backed by a single-shot python uiautomator2 worker.
 * When the worker cannot start, cannot import uiautomator2, or cannot
 * reach the device, calls throw DriverUnavailableError('U2_UNAVAILABLE')
 * so the caller can degrade to the fallback chain instead of crashing.
 */
export declare class Uiautomator2Driver implements UiDriverPort {
    private readonly pythonPath;
    private readonly workerPath;
    private readonly adbPath;
    private readonly serial;
    private readonly captureDir;
    readonly kind = "uiautomator2";
    constructor(pythonPath: string, workerPath: string, adbPath: string, serial: string, captureDir: string);
    connect(): Promise<void>;
    isConnected(): Promise<boolean>;
    screenSize(): Promise<Size>;
    foregroundApp(): Promise<string>;
    tap(point: Point): Promise<void>;
    longPress(point: Point, durationMs: number): Promise<void>;
    swipe(from: Point, to: Point, durationMs: number): Promise<void>;
    inputText(text: string): Promise<void>;
    inputChinese(_text: string): Promise<void>;
    pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void>;
    openApp(packageName: string): Promise<void>;
    observe(): Promise<Observation>;
    findText(text: string): Promise<Point | null>;
    findNodes(matcher: UiMatcher): Promise<UiNode[]>;
    tapControl(matcher: UiMatcher, _templateHint?: string): Promise<UiNode>;
    pushFile(localPath: string, remotePath: string): Promise<void>;
    pullFile(remotePath: string, localPath: string): Promise<void>;
    playAudio(_remotePath: string): Promise<void>;
    recordAudio(_durationMs: number, _remotePath: string): Promise<void>;
    private call;
    private pruneCaptures;
}
