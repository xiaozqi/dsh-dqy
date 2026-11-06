import { DeviceError } from '../../domain/errors.js'
import type {
  PlatformRecipe,
  RecipeContext,
  RecipeSelector,
  RecipeStep,
} from '../../domain/recipe-types.js'
import type {
  UiDriverPort,
  UiMatcher,
} from '../../domain/ports/ui-driver.port.js'
import type { UiNode } from '../../domain/types.js'
import {
  centerOf,
  sleep,
  waitFor,
  waitForApp,
} from '../support/wait-for.js'

const DEFAULT_SEND: RecipeSelector = {
  regex: true,
  text: '^发送$|^回复$|^发布$|^提交$',
}
const DEFAULT_INPUT: RecipeSelector = {
  regex: true,
  className: 'EditText',
}

function toMatcher(selector: RecipeSelector): UiMatcher {
  const regex = selector.regex ?? false
  const compile = (value: string | undefined): string | RegExp | undefined => {
    if (value === undefined) return undefined
    return regex ? new RegExp(value) : value
  }
  return {
    text: compile(selector.text),
    desc: compile(selector.desc),
    resourceId: compile(selector.resourceId),
    className: compile(selector.className),
  }
}

function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text)
}

export class RecipeExecutor {
  constructor(private readonly driver: UiDriverPort) {}

  async execute(
    recipe: PlatformRecipe,
    context: RecipeContext,
  ): Promise<void> {
    await this.driver.connect()
    for (const step of recipe.steps) {
      await this.runStep(recipe, step, context)
    }
  }

  private async runStep(
    recipe: PlatformRecipe,
    step: RecipeStep,
    context: RecipeContext,
  ): Promise<void> {
    const current: RecipeStep = step.selector
      ? { ...step, selector: this.resolveSelector(step.selector, context) }
      : step
    const timeoutMs = current.timeoutMs ?? 10000

    switch (current.action) {
      case 'open_app':
        await this.driver.openApp(recipe.packageName)
        await waitForApp(this.driver, recipe.packageName, { timeoutMs })
        await sleep(2000)
        break

      case 'wait_for':
      case 'verify':
        if (!current.selector) {
          throw new DeviceError('RECIPE_BAD_STEP', `${current.action} needs a selector`)
        }
        await this.findControl(current.selector, timeoutMs)
        break

      case 'tap':
        if (!current.selector) {
          throw new DeviceError('RECIPE_BAD_STEP', 'tap needs a selector')
        }
        await this.tapControl(current.selector, timeoutMs)
        break

      case 'input':
        await this.input(current, context)
        break

      case 'send':
        await this.tapControl(current.selector ?? DEFAULT_SEND, timeoutMs)
        await sleep(600)
        break

      case 'press_key':
        if (!current.key) {
          throw new DeviceError('RECIPE_BAD_STEP', 'press_key needs a key')
        }
        await this.driver.pressKey(current.key)
        break
    }
  }

  private resolveSelector(
    selector: RecipeSelector,
    context: RecipeContext,
  ): RecipeSelector {
    const fill = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined
      return value.replace(/\{(\w+)\}/g, (_, key: string) => context[key] ?? '')
    }
    return {
      ...selector,
      text: fill(selector.text),
      desc: fill(selector.desc),
      resourceId: fill(selector.resourceId),
      className: fill(selector.className),
    }
  }

  private async findControl(
    selector: RecipeSelector,
    timeoutMs: number,
  ): Promise<UiNode> {
    const matcher = toMatcher(selector)
    return waitFor(async () => {
      const nodes = await this.driver.findNodes(matcher)
      return nodes[0] ?? null
    }, { timeoutMs })
  }

  private async tapControl(
    selector: RecipeSelector,
    timeoutMs: number,
  ): Promise<void> {
    const node = await this.findControl(selector, timeoutMs)
    await this.driver.tap(centerOf(node))
  }

  private async input(
    step: RecipeStep,
    context: RecipeContext,
  ): Promise<void> {
    const text = step.from ? context[step.from] : step.value
    if (!text) {
      throw new DeviceError('RECIPE_BAD_STEP', 'input resolved to empty text')
    }
    const selector = step.selector ?? DEFAULT_INPUT
    const node = await this.findControl(selector, step.timeoutMs ?? 10000)
    await this.driver.tap(centerOf(node))
    await sleep(600)
    if (hasNonAscii(text)) {
      await this.driver.inputChinese(text)
    } else {
      await this.driver.inputText(text)
    }
    await sleep(400)
  }
}
