import { ProcessSupervisor } from '../process-supervisor.js'

// One supervisor for every worker call: each python worker gets a deadline and
// its child tree is killed on timeout, so a wedged atx-agent fails fast instead
// of hanging a tool call until the harness gives up.
const workerSupervisor = new ProcessSupervisor()
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  CapabilityNotImplementedError,
  DeviceError,
  DriverUnavailableError,
  UiNotFoundError,
} from '../../domain/errors.js'
import {
  center,
  matches,
  type UiDriverPort,
  type UiMatcher,
} from '../../domain/ports/ui-driver.port.js'
import type {
  Observation,
  Point,
  Size,
  UiNode,
} from '../../domain/types.js'
import { parseUiDump } from '../adb/ui-dump-parser.js'

const MAX_CAPTURES = 5

interface WorkerResponse {
  ok: boolean
  unavailable?: boolean
  data?: unknown
  error?: string
}

interface RawScreenSize {
  width: number
  height: number
}

interface RawObserve {
  xml: string
  screenSize: RawScreenSize
  foreground: string
}

/**
 * UI driver backed by a single-shot python uiautomator2 worker.
 * When the worker cannot start, cannot import uiautomator2, or cannot
 * reach the device, calls throw DriverUnavailableError('U2_UNAVAILABLE')
 * so the caller can degrade to the fallback chain instead of crashing.
 */
export class Uiautomator2Driver implements UiDriverPort {
  readonly kind = 'uiautomator2'

  constructor(
    private readonly pythonPath: string,
    private readonly workerPath: string,
    private readonly adbPath: string,
    private readonly serial: string,
    private readonly captureDir: string,
  ) {
    mkdirSync(captureDir, { recursive: true })
  }

  async connect(): Promise<void> {
    await this.call({ mode: 'ping' })
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.call({ mode: 'ping' })
      return true
    } catch {
      return false
    }
  }

  async screenSize(): Promise<Size> {
    const data = (await this.call({ mode: 'screen_size' })) as RawScreenSize
    return { width: data.width, height: data.height }
  }

  async foregroundApp(): Promise<string> {
    return (await this.call({ mode: 'foreground' })) as string
  }

  async tap(point: Point): Promise<void> {
    await this.call({ mode: 'tap', x: point.x, y: point.y })
  }

  async longPress(point: Point, durationMs: number): Promise<void> {
    await this.call({
      mode: 'long_press',
      x: point.x,
      y: point.y,
      durationMs,
    })
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.call({
      mode: 'swipe',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      durationMs,
    })
  }

  async inputText(text: string): Promise<void> {
    await this.call({ mode: 'input_text', text })
  }

  async inputChinese(_text: string): Promise<void> {
    throw new CapabilityNotImplementedError(
      'NOT_SUPPORTED',
      'uiautomator2 driver does not implement inputChinese; use the adb fallback',
    )
  }

  async pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void> {
    await this.call({ mode: 'press_key', key })
  }

  async openApp(packageName: string): Promise<void> {
    await this.call({ mode: 'open_app', packageName })
  }

  async observe(): Promise<Observation> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const pngPath = join(this.captureDir, `screen-${stamp}.png`)
    const data = (await this.call({
      mode: 'observe',
      pngPath,
    })) as RawObserve
    this.pruneCaptures()
    return {
      screenshotPath: pngPath,
      foregroundApp: data.foreground,
      screenSize: {
        width: data.screenSize.width,
        height: data.screenSize.height,
      },
      roots: parseUiDump(data.xml),
      capturedAt: new Date().toISOString(),
    }
  }

  async findText(text: string): Promise<Point | null> {
    const observation = await this.observe()
    const found = findNode(
      observation.roots,
      node =>
        node.text.includes(text) || node.resourceId.includes(text),
    )
    return found ? center(found) : null
  }

  async findNodes(matcher: UiMatcher): Promise<UiNode[]> {
    const observation = await this.observe()
    const hits: UiNode[] = []
    const walk = (nodes: UiNode[]): void => {
      for (const node of nodes) {
        if (matches(node, matcher)) hits.push(node)
        walk(node.children)
      }
    }
    walk(observation.roots)
    return hits
  }

  async tapControl(
    matcher: UiMatcher,
    _templateHint?: string,
  ): Promise<UiNode> {
    const nodes = await this.findNodes(matcher)
    if (nodes.length === 0) {
      throw new UiNotFoundError(
        'UI_NOT_FOUND',
        `no ui node matched ${JSON.stringify(matcher)}`,
      )
    }
    const found = nodes[0]
    await this.tap(center(found))
    return found
  }

  async pushFile(localPath: string, remotePath: string): Promise<void> {
    await this.call({ mode: 'push', local: localPath, remote: remotePath })
  }

  async pullFile(remotePath: string, localPath: string): Promise<void> {
    await this.call({ mode: 'pull', remote: remotePath, local: localPath })
  }

  async playAudio(_remotePath: string): Promise<void> {
    throw new CapabilityNotImplementedError(
      'NOT_SUPPORTED',
      'uiautomator2 driver does not implement playAudio',
    )
  }

  async recordAudio(_durationMs: number, _remotePath: string): Promise<void> {
    throw new CapabilityNotImplementedError(
      'NOT_SUPPORTED',
      'uiautomator2 driver does not implement recordAudio',
    )
  }

  private async call(command: Record<string, unknown>): Promise<unknown> {
    const payload = {
      ...command,
      adb: this.adbPath,
      serial: this.serial,
    }
    const result = await workerSupervisor.run(
      this.pythonPath,
      [this.workerPath, JSON.stringify(payload)],
      { timeoutMs: 20000 },
    )
    if (result.timedOut) {
      throw new DriverUnavailableError(
        'U2_TIMEOUT',
        'uiautomator2 worker exceeded 20s; the phone may be wedged',
      )
    }
    let parsed: WorkerResponse
    try {
      parsed = JSON.parse(result.stdout) as WorkerResponse
    } catch {
      throw new DeviceError(
        'U2_BAD_JSON',
        result.stderr || result.stdout || `worker exit ${result.code}`,
      )
    }
    const message = parsed.error || `worker exit ${result.code}`
    if (parsed.unavailable) {
      throw new DriverUnavailableError('U2_UNAVAILABLE', message)
    }
    if (!parsed.ok) {
      throw new DeviceError('U2_OP_FAILED', message)
    }
    return parsed.data
  }

  private pruneCaptures(): void {
    const files = readdirSync(this.captureDir)
      .filter(f => f.startsWith('screen-') && f.endsWith('.png'))
      .sort()
    const stale = files.slice(0, Math.max(0, files.length - MAX_CAPTURES))
    for (const f of stale) {
      rmSync(join(this.captureDir, f), { force: true })
    }
  }
}

function findNode(
  nodes: UiNode[],
  predicate: (node: UiNode) => boolean,
): UiNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node
    const hit = findNode(node.children, predicate)
    if (hit) return hit
  }
  return null
}
