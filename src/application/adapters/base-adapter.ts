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
  const send = await findControl(
    driver,
    { text: /^发送$|^回复$|^发布$|^提交$/ },
    options,
  )
  await driver.tap(centerOf(send))
  await sleep(600)
}

export async function typeIntoInput(
  driver: UiDriverPort,
  text: string,
  matcher?: UiMatcher,
  options: WaitOptions = {},
): Promise<void> {
  const input =
    matcher !== undefined
      ? await findControl(driver, matcher, options)
      : await findControl(
          driver,
          { className: /EditText/i },
          options,
        )
  await driver.tap(centerOf(input))
  await sleep(600)
  await driver.inputText(text)
  await sleep(400)
}

export async function pushMedia(
  driver: UiDriverPort,
  localImagePath: string,
): Promise<string> {
  const remote =
    `/sdcard/blue-fat-fish/media/img-${Date.now()}.png`
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
