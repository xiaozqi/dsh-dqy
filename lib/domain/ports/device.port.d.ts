import type { Observation, Point, Size } from '../types.js';
export interface DevicePort {
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
}
