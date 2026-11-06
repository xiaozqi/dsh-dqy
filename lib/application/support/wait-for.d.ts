import type { DevicePort } from '../../domain/ports/device.port.js';
import type { Point, UiNode } from '../../domain/types.js';
export interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
}
export interface RetryOptions {
    attempts?: number;
    delayMs?: number;
}
export declare function sleep(ms: number): Promise<void>;
export declare function waitFor<T>(predicate: () => Promise<T | null>, options?: WaitOptions): Promise<T>;
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
export declare function waitForText(device: DevicePort, text: string, options?: WaitOptions): Promise<UiNode>;
export declare function waitForApp(device: DevicePort, packageName: string, options?: WaitOptions): Promise<boolean>;
export declare function findNode(nodes: UiNode[], predicate: (node: UiNode) => boolean): UiNode | null;
export declare function findNodes(nodes: UiNode[], predicate: (node: UiNode) => boolean): UiNode[];
export declare function centerOf(node: UiNode): Point;
