import type { Observation, Point, Size } from '../types.js'

export interface DevicePort {
  connect(): Promise<void>
  isConnected(): Promise<boolean>
  screenSize(): Promise<Size>
  foregroundApp(): Promise<string>
  tap(point: Point): Promise<void>
  longPress(point: Point, durationMs: number): Promise<void>
  swipe(from: Point, to: Point, durationMs: number): Promise<void>
  inputText(text: string): Promise<void>
  // Inject non-ASCII (e.g. Chinese) text into the focused field. The plain
  // `input text` shell command only carries ASCII, so implementations route
  // through a dedicated input method (ADBKeyBoard broadcast) and MUST restore
  // the user's previous IME afterwards.
  inputChinese(text: string): Promise<void>
  pressKey(key: 'back' | 'home' | 'recents' | 'enter' | 'wakeup'): Promise<void>
  openApp(packageName: string): Promise<void>
  observe(): Promise<Observation>
  findText(text: string): Promise<Point | null>
  pushFile(localPath: string, remotePath: string): Promise<void>
  pullFile(remotePath: string, localPath: string): Promise<void>
  playAudio(remotePath: string): Promise<void>
  recordAudio(durationMs: number, remotePath: string): Promise<void>
}
