import type {
  UiDriverPort,
  UiMatcher,
} from '../../domain/ports/ui-driver.port.js'
import type {
  Observation,
  Point,
  Size,
  UiNode,
} from '../../domain/types.js'
import type { AndroidDevice } from '../adb/android-device.js'

/**
 * Thin UiDriverPort adapter around an already-built AndroidDevice.
 * Every method, including findNodes/tapControl, delegates straight through.
 */
export class AdbUiDriver implements UiDriverPort {
  readonly kind = 'adb'

  constructor(private readonly device: AndroidDevice) {}

  connect(): Promise<void> {
    return this.device.connect()
  }

  isConnected(): Promise<boolean> {
    return this.device.isConnected()
  }

  screenSize(): Promise<Size> {
    return this.device.screenSize()
  }

  foregroundApp(): Promise<string> {
    return this.device.foregroundApp()
  }

  tap(point: Point): Promise<void> {
    return this.device.tap(point)
  }

  longPress(point: Point, durationMs: number): Promise<void> {
    return this.device.longPress(point, durationMs)
  }

  swipe(from: Point, to: Point, durationMs: number): Promise<void> {
    return this.device.swipe(from, to, durationMs)
  }

  inputText(text: string): Promise<void> {
    return this.device.inputText(text)
  }

  inputChinese(text: string): Promise<void> {
    return this.device.inputChinese(text)
  }

  pressKey(key: 'back' | 'home' | 'recents' | 'enter'): Promise<void> {
    return this.device.pressKey(key)
  }

  openApp(packageName: string): Promise<void> {
    return this.device.openApp(packageName)
  }

  observe(): Promise<Observation> {
    return this.device.observe()
  }

  findText(text: string): Promise<Point | null> {
    return this.device.findText(text)
  }

  pushFile(localPath: string, remotePath: string): Promise<void> {
    return this.device.pushFile(localPath, remotePath)
  }

  pullFile(remotePath: string, localPath: string): Promise<void> {
    return this.device.pullFile(remotePath, localPath)
  }

  playAudio(remotePath: string): Promise<void> {
    return this.device.playAudio(remotePath)
  }

  recordAudio(durationMs: number, remotePath: string): Promise<void> {
    return this.device.recordAudio(durationMs, remotePath)
  }

  findNodes(matcher: UiMatcher): Promise<UiNode[]> {
    return this.device.findNodes(matcher)
  }

  tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode> {
    return this.device.tapControl(matcher, templateHint)
  }
}
