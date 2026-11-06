import type { DirectMessageSender, DirectMessageSendInput } from '../../domain/ports/dm-sender.port.js';
import type { PlatformRecipe } from '../../domain/recipe-types.js';
import type { RecipeExecutor } from '../../application/recipes/recipe-executor.js';
export declare class RecipeDirectMessageSender implements DirectMessageSender {
    private readonly executor;
    private readonly recipes;
    constructor(executor: RecipeExecutor, recipes: readonly PlatformRecipe[]);
    send(input: DirectMessageSendInput): Promise<void>;
}
