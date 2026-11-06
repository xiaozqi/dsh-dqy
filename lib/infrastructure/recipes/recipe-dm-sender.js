import { DeviceError } from '../../domain/errors.js';
// DirectMessageSender backed by declarative recipes. Recipes are keyed by
// package name because notification events carry the source package.
export class RecipeDirectMessageSender {
    executor;
    recipes;
    constructor(executor, recipes) {
        this.executor = executor;
        this.recipes = new Map(recipes.map(recipe => [recipe.packageName, recipe]));
    }
    async send(input) {
        const recipe = this.recipes.get(input.app);
        if (!recipe) {
            throw new DeviceError('RECIPE_NOT_FOUND', `no recipe for package: ${input.app}`);
        }
        await this.executor.execute(recipe, {
            peer: input.peer,
            reply: input.reply,
        });
    }
}
