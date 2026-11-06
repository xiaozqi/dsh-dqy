import { DeviceError } from '../../domain/errors.js'
import type {
  DirectMessageSender,
  DirectMessageSendInput,
} from '../../domain/ports/dm-sender.port.js'
import type { PlatformRecipe } from '../../domain/recipe-types.js'
import type { RecipeExecutor } from '../../application/recipes/recipe-executor.js'

// DirectMessageSender backed by declarative recipes. Recipes are keyed by
// package name because notification events carry the source package.
export class RecipeDirectMessageSender implements DirectMessageSender {
  private readonly recipes: ReadonlyMap<string, PlatformRecipe>

  constructor(
    private readonly executor: RecipeExecutor,
    recipes: readonly PlatformRecipe[],
  ) {
    this.recipes = new Map(
      recipes.map(recipe => [recipe.packageName, recipe]),
    )
  }

  async send(input: DirectMessageSendInput): Promise<void> {
    const recipe = this.recipes.get(input.app)
    if (!recipe) {
      throw new DeviceError(
        'RECIPE_NOT_FOUND',
        `no recipe for package: ${input.app}`,
      )
    }
    await this.executor.execute(recipe, {
      peer: input.peer,
      reply: input.reply,
    })
  }
}
