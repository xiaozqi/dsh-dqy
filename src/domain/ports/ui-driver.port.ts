import type { DevicePort } from './device.port.js'
import type { Point, UiNode } from '../types.js'

export interface UiMatcher {
  text?: string | RegExp
  desc?: string | RegExp
  resourceId?: string | RegExp
  className?: string | RegExp
}

function matchField(
  value: string,
  pattern: string | RegExp | undefined,
): boolean {
  if (pattern === undefined) return true
  if (typeof pattern === 'string') return value.includes(pattern)
  const flags = pattern.flags.replace(/[gy]/g, '')
  return new RegExp(pattern.source, flags).test(value)
}

export function matches(node: UiNode, matcher: UiMatcher): boolean {
  return (
    matchField(node.text, matcher.text) &&
    matchField(node.desc, matcher.desc) &&
    matchField(node.resourceId, matcher.resourceId) &&
    matchField(node.className, matcher.className)
  )
}

export interface UiDriverPort extends DevicePort {
  readonly kind: string
  findNodes(matcher: UiMatcher): Promise<UiNode[]>
  tapControl(matcher: UiMatcher, templateHint?: string): Promise<UiNode>
}

export function center(node: UiNode): Point {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  }
}
