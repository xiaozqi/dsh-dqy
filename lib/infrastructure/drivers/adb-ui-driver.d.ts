import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js';
import type { Observation, Point, Size, UiNode } from '../../domain/types.js';
import type { AndroidDevice } from '../adb/android-device.js';
/**
 * Thin UiDriverPort adapter around an already-built AndroidDevice.
 * Every method, including findNodes/tapControl, delegates straight through.
 */
export declare class AdbUiDriver implements UiDriverPort {
    private readonly device;
    readonly kind = "adb";
    constructor(device: AndroidDevice);
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
    pushFile(localPath: string, remotePath: string): Promise<void>;
    pullFile(remotePath: string, localPath: string): Promise<void>;
    playAudio(remotePath: string): Promise<void>;
    recordAudio(durationMs: number, remotePath: string): Promise<void>;
    findNodes(matcher: UiMatcher): Promise<UiNode[]>;
    tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode>;
}
