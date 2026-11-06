import { existsSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Vision-only locator (not a UiDriverPort). Resolves a template image at
 * <templateRoot>/apps/<appId>/<label>.png against a fresh screenshot and
 * returns the matched center point.
 *
 * Failure policy: any failure (missing template, no screenshot provider,
 * below-threshold match, or vision worker error) resolves to null. This
 * keeps vision a safe last resort inside the fallback chain instead of
 * crashing it.
 */
export class VisionUiDriver {
    vision;
    templateRoot;
    screenshot;
    constructor(vision, templateRoot, screenshot) {
        this.vision = vision;
        this.templateRoot = templateRoot;
        this.screenshot = screenshot;
    }
    async findTemplate(appId, label, threshold) {
        try {
            const templatePath = join(this.templateRoot, 'apps', appId, `${label}.png`);
            if (!existsSync(templatePath))
                return null;
            if (!this.screenshot)
                return null;
            const screenshotPath = await this.screenshot();
            return await this.vision.findTemplate(screenshotPath, templatePath, threshold);
        }
        catch {
            return null;
        }
    }
}
