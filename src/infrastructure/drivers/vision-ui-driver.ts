import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { VisionPort } from '../../domain/ports/vision.port.js'
import type { Point } from '../../domain/types.js'

/**
 * Supplies a fresh screenshot path whenever template matching needs one.
 * Wired by the composition root (e.g. capture via the active device's
 * observe()). When absent, findTemplate returns null instead of throwing.
 */
export type ScreenshotProvider = () => Promise<string>

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
  constructor(
    private readonly vision: VisionPort,
    private readonly templateRoot: string,
    private readonly screenshot?: ScreenshotProvider,
  ) {}

  async findTemplate(
    appId: string,
    label: string,
    threshold?: number,
  ): Promise<Point | null> {
    try {
      const templatePath = join(
        this.templateRoot,
        'apps',
        appId,
        `${label}.png`,
      )
      if (!existsSync(templatePath)) return null
      if (!this.screenshot) return null
      const screenshotPath = await this.screenshot()
      return await this.vision.findTemplate(
        screenshotPath,
        templatePath,
        threshold,
      )
    } catch {
      return null
    }
  }
}
