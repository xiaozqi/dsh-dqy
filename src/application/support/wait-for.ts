import { DeviceError } from '../../domain/errors.js'
import type { DevicePort } from '../../domain/ports/device.port.js'
import type { Point, UiNode } from '../../domain/types.js'

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

export interface RetryOptions {
  attempts?: number
  delayMs?: number
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitFor<T>(
  predicate: () => Promise<T | null>,
  options: WaitOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10000
  const intervalMs = options.intervalMs ?? 800
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const hit = await predicate()
      if (hit) return hit
    } catch (err) {
      lastError = err
    }
    await sleep(intervalMs)
  }
  throw new DeviceError(
    'WAIT_TIMEOUT',
    lastError instanceof Error
      ? lastError.message
      : 'condition not met before timeout',
  )
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const delayMs = options.delayMs ?? 500
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === attempts) break
      await sleep(delayMs)
    }
  }
  throw lastError
}

export function waitForText(
  device: DevicePort,
  text: string,
  options?: WaitOptions,
): Promise<UiNode> {
  return waitFor(async () => {
    const observation = await device.observe()
    return findNode(
      observation.roots,
      node => node.text.includes(text) || node.desc.includes(text),
    )
  }, options)
}

export function waitForApp(
  device: DevicePort,
  packageName: string,
  options?: WaitOptions,
): Promise<boolean> {
  return waitFor(async () => {
    const current = await device.foregroundApp()
    return current === packageName ? true : null
  }, options)
}

export function findNode(
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

export function findNodes(
  nodes: UiNode[],
  predicate: (node: UiNode) => boolean,
): UiNode[] {
  const hits: UiNode[] = []
  const walk = (current: UiNode[]): void => {
    for (const node of current) {
      if (predicate(node)) hits.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return hits
}

export function centerOf(node: UiNode): Point {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  }
}
