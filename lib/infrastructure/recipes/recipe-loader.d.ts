import type { PlatformRecipe } from '../../domain/recipe-types.js';
export declare class RecipeLoader {
    private readonly dir;
    constructor(dir: string);
    loadAll(): PlatformRecipe[];
    get(platform: string): PlatformRecipe;
    private parse;
}
