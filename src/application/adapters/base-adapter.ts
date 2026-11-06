import { DeviceError } from '../../domain/errors.js'
import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js'
import type { Point, UiNode } from '../../domain/types.js'
import { centerOf, findNode, sleep, waitFor } from '../support/wait-for.js'

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

export async function openAndWait(
  driver: UiDriverPort,
  packageName: string,
  options: WaitOptions = {},
): Promise<void> {
  await driver.openApp(packageName)
  await waitFor(
    async () => {
      const current = await driver.foregroundApp()
      return current === packageName ? true : null
    },
    { timeoutMs: 15000, ...options },
  )
  await sleep(2000)
}

/**
 * Refuse to act unless our own app owns the screen.
 *
 * Every write path calls this first: a notification, a mirror-panel tap or a
 * sibling automation can change the foreground app between two tool steps, and
 * a send must never land in whatever app happened to be on top.
 */
export async function ensureForeground(
  driver: UiDriverPort,
  packageName: string,
  options: WaitOptions = {},
): Promise<void> {
  const foreground = await driver.foregroundApp()
  if (foreground === packageName) {
    return
  }
  // One cheap retry: the previous step may still be animating to our app.
  await waitFor(
    async () => {
      const current = await driver.foregroundApp()
      return current === packageName ? true : null
    },
    { timeoutMs: 4000, intervalMs: 600, ...options },
  ).catch(() => {
    throw new DeviceError(
      'WRONG_FOREGROUND_APP',
      `expected ${packageName} in the foreground but found ${foreground}; ` +
        'refusing to act on another app',
    )
  })
}

export async function findControl(
  driver: UiDriverPort,
  matcher: UiMatcher,
  options: WaitOptions = {},
): Promise<UiNode> {
  return waitFor(async () => {
    const nodes = await driver.findNodes(matcher)
    return nodes.length > 0 ? nodes[0] : null
  }, options)
}

export async function tapByMatcher(
  driver: UiDriverPort,
  matcher: UiMatcher,
  options: WaitOptions = {},
): Promise<UiNode> {
  const node = await findControl(driver, matcher, options)
  await driver.tap(centerOf(node))
  return node
}

export async function tapByText(
  driver: UiDriverPort,
  text: string,
  options: WaitOptions = {},
): Promise<UiNode> {
  return tapByMatcher(driver, { text }, options)
}

export async function tapSend(
  driver: UiDriverPort,
  options: WaitOptions = {},
): Promise<void> {
  const size = await driver.screenSize()
  // A "回复" label inside a comment row matches the same regex as the real send
  // button, so only accept controls in the lower half of the screen and tap the
  // lowest one: the composer's send button is always the bottom-most.
  const nodes = await waitFor(async () => {
    const hits = await driver.findNodes({
      text: /^发送$|^回复$|^发布$|^提交$/,
    })
    const bottom = hits.filter(
      node =>
        (node.bounds.top + node.bounds.bottom) / 2 > size.height * 0.55,
    )
    return bottom.length > 0 ? bottom : null
  }, options)
  const target = nodes.sort(
    (left, right) => right.bounds.bottom - left.bounds.bottom,
  )[0]
  await driver.tap(centerOf(target))
  await sleep(600)
}

function isAsciiOnly(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7F]/.test(text)
}

/** Text currently in a discoverable input field ('' when none is found). */
export async function composerText(driver: UiDriverPort): Promise<string> {
  try {
    const nodes = await driver.findNodes({ className: /EditText/i })
    return nodes
      .map(node => node.text)
      .filter(text => text.length > 0)
      .join('\n')
  } catch {
    return ''
  }
}

/**
 * Put text into the focused field.
 *
 * `adb shell input text` is ASCII-only: a Chinese reply injected through it
 * silently types nothing, and the old send path then reported success. Route
 * everything through the IME (clear + inject) and fall back to the ASCII
 * command only when the payload is pure ASCII.
 */
export async function enterText(
  driver: UiDriverPort,
  text: string,
  matcher?: UiMatcher,
  options: WaitOptions = {},
): Promise<void> {
  const input =
    matcher !== undefined
      ? await findControl(driver, matcher, options)
      : await findControl(driver, { className: /EditText/i }, options)
  await driver.tap(centerOf(input))
  await sleep(600)
  try {
    await driver.inputChinese(text)
  } catch (err) {
    if (!isAsciiOnly(text)) {
      throw new DeviceError(
        'INPUT_IME_UNAVAILABLE',
        `cannot inject non-ASCII text (install ADBKeyBoard): ${(err as Error).message}`,
      )
    }
    await driver.inputText(text)
  }
  await sleep(400)
  // Best effort: catch the "field kept its old content" case. A composer that
  // is not exposed as an EditText cannot be checked this way, so only a
  // *wrong, non-empty* composer is fatal.
  const typed = await composerText(driver)
  if (typed.length > 0) {
    const probe = text.slice(0, Math.min(12, text.length))
    if (probe && !typed.includes(probe)) {
      throw new DeviceError(
        'INPUT_TEXT_NOT_APPLIED',
        `input field shows "${typed.slice(0, 40)}" instead of the requested text`,
      )
    }
  }
}

/**
 * True only when the text left the composer and a bubble now shows it.
 *
 * The previous check searched the whole tree for the text, so a *failed* send
 * (text still in the composer) looked exactly like a successful one.
 */
export async function confirmOutgoing(
  driver: UiDriverPort,
  text: string,
  options: WaitOptions = {},
): Promise<boolean> {
  const probe = text.slice(0, Math.min(12, text.length))
  if (!probe) {
    return false
  }
  try {
    await waitFor(
      async () => {
        const composer = await composerText(driver)
        if (composer.includes(probe)) {
          return null // still a draft
        }
        const nodes = await driver.findNodes({ text: probe })
        return nodes.length > 0 ? true : null
      },
      { timeoutMs: 8000, ...options },
    )
    return true
  } catch {
    return false
  }
}

export async function typeIntoInput(
  driver: UiDriverPort,
  text: string,
  matcher?: UiMatcher,
  options: WaitOptions = {},
): Promise<void> {
  await enterText(driver, text, matcher, options)
}

export async function pushMedia(
  driver: UiDriverPort,
  localImagePath: string,
): Promise<string> {
  const remote =
    `/sdcard/dqy/media/img-${Date.now()}.png`
  try {
    await driver.pushFile(localImagePath, remote)
  } catch (err) {
    if (err instanceof DeviceError) {
      throw err
    }
    throw new DeviceError(
      'PUSH_FAILED',
      `cannot push image to phone: ${(err as Error).message}`,
    )
  }
  return remote
}

export async function waitAndTapPeer(
  driver: UiDriverPort,
  peer: string,
  options: WaitOptions = {},
): Promise<void> {
  const peerNode = await findControl(
    driver,
    { text: peer },
    options,
  )
  await driver.tap(centerOf(peerNode))
  await sleep(1200)
}

export function firstTextNode(nodes: UiNode[]): UiNode | null {
  return findNode(nodes, node => node.text.length > 0)
}

export async function currentCenter(driver: UiDriverPort): Promise<Point> {
  const size = await driver.screenSize()
  return {
    x: Math.round(size.width / 2),
    y: Math.round(size.height * 0.45),
  }
}
