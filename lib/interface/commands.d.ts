import type { Context } from '@deepseek-ai/cordis';
import type { PendingAction } from '../application/control/confirmation-queue.js';
import type { FishServices } from './tools.js';
export interface FishCommands extends FishServices {
    /** Owner-only execution of one approved confirmation. */
    approveAction(action: PendingAction): Promise<string>;
}
export declare function registerCommands(ctx: Context, services: FishCommands): void;
