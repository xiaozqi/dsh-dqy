import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DeviceError, UiNotFoundError } from '../../domain/errors.js'
import {
  assertPackageName,
  encodeAdbInputText,
  sanitizeShellText,
  shQuote,
  toBase64,
} from './shell-quote.js'
import {
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
import type { AdbClient } from './adb-client.js'
import { parseUiDump } from './ui-dump-parser.js'

const KEY_CODES: Record<string, number> = {
  back: 4,
  home: 3,
  recents: 187,
  enter: 66,
}

const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME'
const REMOTE_DUMP_PATH = '/sdcard/dqy-dump.xml'
const MAX_CAPTURES = 5

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function encodeInput(text: string): string {
  // Delegated to the shared quoting helper: the old inline version escaped
  // `" & < > ; |` but left `$`, backticks, quotes and newlines live, which the
  // device shell then expanded. Input is single-quoted and `input text`'s own
  // `%s`/`%25` escapes are applied inside the quotes.
  return encodeAdbInputText(sanitizeShellText(text))
}

function looksLikeDeviceGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /offline|device not found|no devices|not found|unauthorized|closed/i.test(
    message,
  )
}

export class AndroidDevice implements UiDriverPort {
  readonly kind = 'adb'
  private cachedSize: Size | null = null

  constructor(
    private readonly adb: AdbClient,
    private readonly captureDir: string,
    /** Re-resolve the serial after a wireless reconnect; returns '' when unknown. */
    private readonly refreshSerial?: () => string,
  ) {
    mkdirSync(captureDir, { recursive: true })
  }

  async connect(): Promise<void> {
    try {
      await this.requireDevice()
    } catch (err) {
      if (!this.tryRefresh()) {
        throw err
      }
      await this.requireDevice()
    }
  }

  private async requireDevice(): Promise<void> {
    const devices = await this.adb.listDevices()
    if (devices.length === 0) {
      throw new DeviceError(
        'NO_DEVICE',
        'no android device found; connect the phone and enable USB debugging',
      )
    }
  }

  /** Refresh the serial once; false when there is nothing new to try. */
  private tryRefresh(): boolean {
    const next = this.refreshSerial?.() ?? ''
    if (!next || next === this.adb.currentSerial) {
      return false
    }
    this.adb.setSerial(next)
    console.log(`[device] serial refreshed to ${next}`)
    return true
  }

  async isConnected(): Promise<boolean> {
    try {
      const devices = await this.adb.listDevices()
      return devices.length > 0
    } catch {
      return false
    }
  }

  async screenSize(): Promise<Size> {
    if (this.cachedSize) return this.cachedSize
    const out = await this.adb.run(['shell', 'wm', 'size'])
    const m = out.match(/(\d+)x(\d+)/)
    if (!m) throw new DeviceError('BAD_SCREEN_SIZE', out)
    this.cachedSize = { width: Number(m[1]), height: Number(m[2]) }
    return this.cachedSize
  }

  async foregroundApp(): Promise<string> {
    const out = await this.adb.run([
      'shell',
      'dumpsys',
      'activity',
      'activities',
    ])
    const resumed = out.match(/mResumedActivity[^\n]*?([a-zA-Z][\w.]*)\//)
    if (resumed) return resumed[1]
    const focus = out.match(/mCurrentFocus[^\n]*?([a-zA-Z][\w.]*)\//)
    if (focus) return focus[1]
    return 'unknown'
  }

  async tap(point: Point): Promise<void> {
    await this.adb.run([
      'shell',
      'input',
      'tap',
      String(point.x),
      String(point.y),
    ])
  }

  async longPress(point: Point, durationMs: number): Promise<void> {
    await this.adb.run([
      'shell',
      'input',
      'swipe',
      String(point.x),
      String(point.y),
      String(point.x),
      String(point.y),
      String(durationMs),
    ])
  }

  async swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    await this.adb.run([
      'shell',
      'input',
      'swipe',
      String(from.x),
      String(from.y),
      String(to.x),
      String(to.y),
      String(durationMs),
    ])
  }

  async inputText(text: string): Promise<void> {
    await this.adb.run(['shell', 'input', 'text', encodeInput(text)])
  }

  // Chinese / non-ASCII injection via the ADBKeyBoard input method: switch
  // to it, broadcast the text into the focused field, then always restore
  // the previously active IME so the user's keyboard is untouched.
  async inputChinese(text: string): Promise<void> {
    const previous = (
      await this.adb.run([
        'shell',
        'settings',
        'get',
        'secure',
        'default_input_method',
      ])
    ).trim()
    try {
      await this.adb.run(['shell', 'ime', 'enable', ADB_KEYBOARD_IME])
      await this.adb.run(['shell', 'ime', 'set', ADB_KEYBOARD_IME])
      // Some OEMs (Huawei EMUI) switch IMEs slowly; the input broadcast is
      // silently dropped if the keyboard is not yet active. Poll until the
      // active IME is really ADBKeyBoard before injecting anything.
      let ready = false
      for (let i = 0; i < 16; i++) {
        const active = (
          await this.adb.run([
            'shell',
            'settings',
            'get',
            'secure',
            'default_input_method',
          ])
        ).trim()
        if (active === ADB_KEYBOARD_IME) {
          ready = true
          break
        }
        await delay(300)
      }
      if (!ready) {
        throw new Error(
          `inputChinese: ADBKeyBoard IME did not activate within 5s (active=${previous || 'none'})`,
        )
      }
      await delay(400)
      // Wipe any restored draft first so we replace, not append.
      await this.adb.run(['shell', 'am', 'broadcast', '-a', 'ADB_CLEAR_TEXT'])
      await delay(400)
      // Base64 is shell-safe by construction and ADBKeyBoard decodes it back
      // to the exact UTF-8 text, spaces and punctuation included. The previous
      // `--es msg <text>` form was unquoted: spaces split into separate argv
      // entries (only the first word arrived) and shell metacharacters ran.
      await this.adb.run([
        'shell',
        'am',
        'broadcast',
        '-a',
        'ADB_INPUT_B64',
        '--es',
        'msg',
        toBase64(sanitizeShellText(text)),
      ])
      await delay(500)
    } finally {
      if (previous && previous !== ADB_KEYBOARD_IME) {
        await this.adb.run(['shell', 'ime', 'set', previous])
      }
    }
  }

  async pressKey(
    key: 'back' | 'home' | 'recents' | 'enter',
  ): Promise<void> {
    const code = KEY_CODES[key]
    await this.adb.run(['shell', 'input', 'keyevent', String(code)])
  }

  async openApp(packageName: string): Promise<void> {
    // Package names are validated, not quoted: `monkey -p` must never receive
    // free-form text that a model produced.
    const safe = assertPackageName(packageName)
    await this.adb.run([
      'shell',
      'monkey',
      '-p',
      safe,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ])
  }

  async observe(): Promise<Observation> {
    // A wireless reconnect changes the serial mid-session; reading the screen
    // is idempotent, so refresh once and retry instead of failing the tool.
    try {
      return await this.observeOnce()
    } catch (err) {
      if (!looksLikeDeviceGone(err) || !this.tryRefresh()) {
        throw err
      }
      return await this.observeOnce()
    }
  }

  private async observeOnce(): Promise<Observation> {
    const size = await this.screenSize()
    const foreground = await this.foregroundApp()

    const png = await this.adb.runBinary(['exec-out', 'screencap', '-p'])
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const screenshotPath = join(this.captureDir, `screen-${stamp}.png`)
    writeFileSync(screenshotPath, png)
    this.pruneCaptures()

    await this.adb.run([
      'shell',
      'uiautomator',
      'dump',
      REMOTE_DUMP_PATH,
    ])
    const xml = await this.adb.runBinary([
      'exec-out',
      'cat',
      REMOTE_DUMP_PATH,
    ])
    const roots = parseUiDump(xml.toString('utf8'))

    return {
      screenshotPath,
      foregroundApp: foreground,
      screenSize: size,
      roots,
      capturedAt: new Date().toISOString(),
    }
  }

  async findText(text: string): Promise<Point | null> {
    const observation = await this.observe()
    const found = this.search(
      observation.roots,
      node => node.text.includes(text) || node.resourceId.includes(text),
    )
    if (!found) return null
    return {
      x: Math.round((found.bounds.left + found.bounds.right) / 2),
      y: Math.round((found.bounds.top + found.bounds.bottom) / 2),
    }
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
    await this.tap({
      x: Math.round((found.bounds.left + found.bounds.right) / 2),
      y: Math.round((found.bounds.top + found.bounds.bottom) / 2),
    })
    return found
  }

  async pushFile(
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    await this.adb.run(['push', localPath, shQuote(remotePath)])
  }

  async pullFile(
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    await this.adb.run(['pull', shQuote(remotePath), localPath])
  }

  async playAudio(remotePath: string): Promise<void> {
    const encoded = remotePath.replace(/ /g, '%20')
    await this.adb.run([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      shQuote(`file://${encoded}`),
      '-t',
      'audio/*',
    ])
  }

  async recordAudio(
    durationMs: number,
    remotePath: string,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(durationMs / 1000))
    await this.adb.run([
      'shell',
      'screenrecord',
      '--time-limit',
      String(seconds),
      '--microphone',
      remotePath,
    ])
  }

  private search(
    nodes: UiNode[],
    predicate: (node: UiNode) => boolean,
  ): UiNode | null {
    for (const node of nodes) {
      if (predicate(node)) return node
      const hit = this.search(node.children, predicate)
      if (hit) return hit
    }
    return null
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
