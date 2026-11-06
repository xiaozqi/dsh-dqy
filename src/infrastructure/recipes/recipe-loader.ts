import { readdirSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { load } from 'js-yaml'
import { DeviceError } from '../../domain/errors.js'
import type { PlatformRecipe } from '../../domain/recipe-types.js'

// Loads declarative platform recipes from a directory of YAML files. Parsing
// and validation live here; the application layer only sees typed recipes.
export class RecipeLoader {
  constructor(private readonly dir: string) {}

  loadAll(): PlatformRecipe[] {
    const files = readdirSync(this.dir)
      .filter(file => /\.ya?ml$/i.test(extname(file)))
    return files.map(file => this.parse(resolve(this.dir, file)))
  }

  get(platform: string): PlatformRecipe {
    const match = this.loadAll().find(recipe => recipe.platform === platform)
    if (!match) {
      throw new DeviceError('RECIPE_NOT_FOUND', `no recipe for platform: ${platform}`)
    }
    return match
  }

  private parse(path: string): PlatformRecipe {
    const doc = load(readFileSync(path, 'utf8')) as Partial<PlatformRecipe>
    if (!doc || typeof doc !== 'object') {
      throw new DeviceError('RECIPE_INVALID', `${path}: document is not an object`)
    }
    if (!doc.platform || !doc.packageName || !Array.isArray(doc.steps)) {
      throw new DeviceError(
        'RECIPE_INVALID',
        `${path}: platform, packageName and steps are required`,
      )
    }
    return doc as PlatformRecipe
  }
}
