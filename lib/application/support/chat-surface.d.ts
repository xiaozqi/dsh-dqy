import type { Observation, Size, UiNode } from '../../domain/types.js';
export declare function headerShowsPeer(observation: Observation, peer: string, size: Size): boolean;
export declare function findBottomInput(observation: Observation, size: Size, matches: (node: UiNode) => boolean): UiNode | null;
