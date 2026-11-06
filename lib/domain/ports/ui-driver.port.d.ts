import type { DevicePort } from './device.port.js';
import type { Point, UiNode } from '../types.js';
export interface UiMatcher {
    text?: string | RegExp;
    desc?: string | RegExp;
    resourceId?: string | RegExp;
    className?: string | RegExp;
}
export declare function matches(node: UiNode, matcher: UiMatcher): boolean;
export interface UiDriverPort extends DevicePort {
    readonly kind: string;
    findNodes(matcher: UiMatcher): Promise<UiNode[]>;
    tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode>;
}
export declare function center(node: UiNode): Point;
