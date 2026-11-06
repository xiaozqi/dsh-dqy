import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { load } from 'js-yaml';
import { DeviceError } from '../../domain/errors.js';
// Loads declarative platform recipes from a directory of YAML files. Parsing
// and validation live here; the application layer only sees typed recipes.
export class RecipeLoader {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    loadAll() {
        const files = readdirSync(this.dir)
            .filter(file => /\.ya?ml$/i.test(extname(file)));
        return files.map(file => this.parse(resolve(this.dir, file)));
    }
    get(platform) {
        const match = this.loadAll().find(recipe => recipe.platform === platform);
        if (!match) {
            throw new DeviceError('RECIPE_NOT_FOUND', `no recipe for platform: ${platform}`);
        }
        return match;
    }
    parse(path) {
        const doc = load(readFileSync(path, 'utf8'));
        if (!doc || typeof doc !== 'object') {
            throw new DeviceError('RECIPE_INVALID', `${path}: document is not an object`);
        }
        if (!doc.platform || !doc.packageName || !Array.isArray(doc.steps)) {
            throw new DeviceError('RECIPE_INVALID', `${path}: platform, packageName and steps are required`);
        }
        return doc;
    }
}
