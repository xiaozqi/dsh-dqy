import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { GameRun } from '../../domain/app-types.js';
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js';
import type { GameCapability, GameInput } from '../../domain/ports/capabilities/game.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
import type { VisionPort } from '../../domain/ports/vision.port.js';
import type { GamePolicy } from './game-policy.js';
export interface GameOptions {
    game: string;
    rounds?: number;
    threshold?: number;
    settleMs?: number;
    finishLabels?: string[];
}
export declare class GameService implements AppAdapter, GameCapability {
    private readonly driver;
    private readonly vision;
    private readonly templateRoot;
    private readonly policy;
    readonly id = "game";
    readonly displayName = "\u6E38\u620F";
    readonly packageName = "";
    readonly capabilities: ReadonlySet<CapabilityId>;
    readonly todos: readonly AdapterTodo[];
    readonly capability: never;
    constructor(driver: UiDriverPort, vision: VisionPort, templateRoot: string, policy: GamePolicy);
    initialize(): Promise<void>;
    runGame(input: GameInput): Promise<AdapterResult>;
    run(options: GameOptions): Promise<GameRun>;
    private listTemplates;
    private execute;
}
