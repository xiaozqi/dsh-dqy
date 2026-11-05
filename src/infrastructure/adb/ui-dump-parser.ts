import type { Bounds, UiNode } from '../../domain/types.js'

export function parseUiDump(xml: string): UiNode[] {
  const roots: UiNode[] = []
  const stack: UiNode[] = []
  const tokenRe = /<node\b([^>]*?)(\/?)>|<\/node>/g
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(xml)) !== null) {
    if (match[0] === '</node>') {
      stack.pop()
      continue
    }
    const node = buildNode(match[1])
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
    if (match[2] !== '/') stack.push(node)
  }
  return roots
}

function buildNode(attrText: string): UiNode {
  const attrs = new Map<string, string>()
  const attrRe = /([\w-]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(attrText)) !== null) {
    attrs.set(m[1], m[2])
  }
  return {
    text: attrs.get('text') ?? '',
    desc: attrs.get('content-desc') ?? '',
    resourceId: attrs.get('resource-id') ?? '',
    className: attrs.get('class') ?? '',
    packageName: attrs.get('package') ?? '',
    bounds: parseBounds(attrs.get('bounds') ?? ''),
    clickable: attrs.get('clickable') === 'true',
    enabled: attrs.get('enabled') === 'true',
    children: [],
  }
}

function parseBounds(raw: string): Bounds {
  const m = raw.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!m) return { left: 0, top: 0, right: 0, bottom: 0 }
  return {
    left: Number(m[1]),
    top: Number(m[2]),
    right: Number(m[3]),
    bottom: Number(m[4]),
  }
}
