import { type UiDriverPort, type UiMatcher } from '../../domain/ports/ui-driver.port.js';
import type { Observation, Point, Size, UiNode } from '../../domain/types.js';
import type { VisionUiDriver } from './vision-ui-driver.js';
export interface FallbackUiDriverConfig {
    primary: UiDriverPort;
    fallback: UiDriverPort;
    vision?: VisionUiDriver | null;
}
/**
 * Routes every UI operation through a primary driver, then a fallback
 * driver. findNodes tolerates failure by returning []; tapControl also
 * consults template vision as a final locator. Both are wrapped in a
 * single retry for transient failures. The kind of the last driver that
 * performed a successful action is exposed as lastUsed.
 */
export declare class FallbackUiDriver implements UiDriverPort {
    private readonly config;
    readonly kind = "fallback";
    private lastUsedDriver;
    constructor(config: FallbackUiDriverConfig);
    get lastUsed(): string;
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
    private findNodesOnce;
    private locateAndTap;
    private tapPoint;
    private runChain;
    private parseHint;
    private retryOnce;
}
