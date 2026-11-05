import {
  DriverUnavailableError,
  UiNotFoundError,
} from '../../domain/errors.js'
import {
  center,
  type UiDriverPort,
  type UiMatcher,
} from '../../domain/ports/ui-driver.port.js'
import type {
  Observation,
  Point,
  Size,
  UiNode,
} from '../../domain/types.js'
import type { VisionUiDriver } from './vision-ui-driver.js'

export interface FallbackUiDriverConfig {
  primary: UiDriverPort
  fallback: UiDriverPort
  vision?: VisionUiDriver | null
}

/**
 * Routes every UI operation through a primary driver, then a fallback
 * driver. findNodes tolerates failure by returning []; tapControl also
 * consults template vision as a final locator. Both are wrapped in a
 * single retry for transient failures. The kind of the last driver that
 * performed a successful action is exposed as lastUsed.
 */
export class FallbackUiDriver implements UiDriverPort {
  readonly kind = 'fallback'
  private lastUsedDriver = ''

  constructor(private readonly config: FallbackUiDriverConfig) {}

  get lastUsed(): string {
    return this.lastUsedDriver
  }

  async connect(): Promise<void> {
    await this.runChain(d => d.connect(), 'connect')
  }

  async isConnected(): Promise<boolean> {
    for (const driver of [this.config.primary, this.config.fallback]) {
      try {
        if (await driver.isConnected()) return true
      } catch {
        // try the next chain
      }
    }
    return false
  }

  async screenSize(): Promise<Size> {
    return this.runChain(d => d.screenSize(), 'screenSize')
  }

  async foregroundApp(): Promise<string> {
    return this.runChain(d => d.foregroundApp(), 'foregroundApp')
  }

  async tap(point: Point): Promise<void> {
    await this.runChain(d => d.tap(point), 'tap')
  }

  async longPress(point: Point, durationMs: number): Promise<void> {
    await this.runChain(d => d.longPress(point, durationMs), 'longPress')
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.runChain(d => d.swipe(from, to, durationMs), 'swipe')
  }

  async inputText(text: string): Promise<void> {
    await this.runChain(d => d.inputText(text), 'inputText')
  }

  async inputChinese(text: string): Promise<void> {
    await this.runChain(d => d.inputChinese(text), 'inputChinese')
  }

  async pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void> {
    await this.runChain(d => d.pressKey(key), 'pressKey')
  }

  async openApp(packageName: string): Promise<void> {
    await this.runChain(d => d.openApp(packageName), 'openApp')
  }

  async observe(): Promise<Observation> {
    return this.runChain(d => d.observe(), 'observe')
  }

  async findText(text: string): Promise<Point | null> {
    return this.runChain(d => d.findText(text), 'findText')
  }

  async pushFile(localPath: string, remotePath: string): Promise<void> {
    await this.runChain(d => d.pushFile(localPath, remotePath), 'pushFile')
  }

  async pullFile(remotePath: string, localPath: string): Promise<void> {
    await this.runChain(d => d.pullFile(remotePath, localPath), 'pullFile')
  }

  async playAudio(remotePath: string): Promise<void> {
    await this.runChain(d => d.playAudio(remotePath), 'playAudio')
  }

  async recordAudio(durationMs: number, remotePath: string): Promise<void> {
    await this.runChain(
      d => d.recordAudio(durationMs, remotePath),
      'recordAudio',
    )
  }

  async findNodes(matcher: UiMatcher): Promise<UiNode[]> {
    return this.retryOnce(() => this.findNodesOnce(matcher))
  }

  async tapControl(
    matcher: UiMatcher,
    templateHint?: string,
  ): Promise<UiNode> {
    return this.retryOnce(() => this.locateAndTap(matcher, templateHint))
  }

  private async findNodesOnce(matcher: UiMatcher): Promise<UiNode[]> {
    for (const driver of [this.config.primary, this.config.fallback]) {
      try {
        const nodes = await driver.findNodes(matcher)
        if (nodes.length > 0) {
          this.lastUsedDriver = driver.kind
          return nodes
        }
      } catch {
        // try the next chain
      }
    }
    return []
  }

  private async locateAndTap(
    matcher: UiMatcher,
    templateHint?: string,
  ): Promise<UiNode> {
    const reasons: string[] = []

    for (const driver of [this.config.primary, this.config.fallback]) {
      try {
        const nodes = await driver.findNodes(matcher)
        if (nodes.length > 0) {
          const node = nodes[0]
          await this.tapPoint(center(node))
          return node
        }
        reasons.push(`${driver.kind}: no matching nodes`)
      } catch (err) {
        reasons.push(`${driver.kind}: ${(err as Error).message}`)
      }
    }

    if (templateHint && this.config.vision) {
      const { appId, label } = this.parseHint(templateHint)
      const point = await this.config.vision.findTemplate(appId, label)
      if (point) {
        await this.tapPoint(point)
        return syntheticNode(point)
      }
      reasons.push('vision: template not matched')
    } else if (templateHint) {
      reasons.push('vision: not configured')
    }

    throw new UiNotFoundError(
      'UI_NOT_FOUND',
      `no control found for ${JSON.stringify(matcher)}: ${reasons.join(' | ')}`,
    )
  }

  private async tapPoint(point: Point): Promise<void> {
    const errors: string[] = []
    for (const driver of [this.config.primary, this.config.fallback]) {
      try {
        await driver.tap(point)
        this.lastUsedDriver = driver.kind
        return
      } catch (err) {
        errors.push(`${driver.kind}: ${(err as Error).message}`)
      }
    }
    throw new DriverUnavailableError(
      'DRIVER_FAILED',
      `tap failed on all drivers: ${errors.join(' | ')}`,
    )
  }

  private async runChain<T>(
    op: (driver: UiDriverPort) => Promise<T>,
    opName: string,
  ): Promise<T> {
    const errors: string[] = []
    for (const driver of [this.config.primary, this.config.fallback]) {
      try {
        const result = await op(driver)
        this.lastUsedDriver = driver.kind
        return result
      } catch (err) {
        errors.push(`${driver.kind}: ${(err as Error).message}`)
      }
    }
    throw new DriverUnavailableError(
      'DRIVER_FAILED',
      `${opName} failed: ${errors.join(' | ')}`,
    )
  }

  private parseHint(hint: string): { appId: string; label: string } {
    const idx = hint.lastIndexOf('/')
    if (idx > 0) {
      return { appId: hint.slice(0, idx), label: hint.slice(idx + 1) }
    }
    return { appId: '', label: hint }
  }

  private async retryOnce<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch {
      return await fn()
    }
  }
}

function syntheticNode(point: Point): UiNode {
  return {
    text: '',
    desc: '',
    resourceId: '',
    className: '',
    packageName: '',
    bounds: {
      left: point.x,
      top: point.y,
      right: point.x,
      bottom: point.y,
    },
    clickable: true,
    enabled: true,
    children: [],
  }
}
