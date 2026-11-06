import type { GameStep } from '../../domain/app-types.js';
import type { MatchTarget } from '../../domain/vision-types.js';
import type { Observation } from '../../domain/types.js';
export interface GamePolicy {
    decide(round: number, matches: MatchTarget[], observation: Observation): GameStep | null;
}
export declare class PriorityTapPolicy implements GamePolicy {
    private readonly priority;
    constructor(priority?: string[]);
    decide(_round: number, matches: MatchTarget[]): GameStep | null;
    private rank;
}
