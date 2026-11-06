import type { AdapterResult } from '../../adapter-types.js';
export interface GameInput {
    game: string;
    rounds?: number;
    threshold?: number;
}
export interface GameCapability {
    readonly capability: 'game';
    runGame(input: GameInput): Promise<AdapterResult>;
}
