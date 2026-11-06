import type { PlatformRecipe, RecipeContext } from '../../domain/recipe-types.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
export declare class RecipeExecutor {
    private readonly driver;
    constructor(driver: UiDriverPort);
    execute(recipe: PlatformRecipe, context: RecipeContext): Promise<void>;
    private runStep;
    private resolveSelector;
    private findControl;
    private tapControl;
    private input;
}
