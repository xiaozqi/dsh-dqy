import type { PolicySurface } from '../../domain/policy-types.js'
import { needsText, targetsPerson } from '../../domain/policy-types.js'

export interface OutboundGuardConfig {
  // Keys are `${packageName}:${peer}`. An empty set blocks every person-
  // targeted surface (fail closed).
  allowedPeers: ReadonlySet<string>
  maxLength: number
  blockUrl: boolean
}

export interface OutboundContent {
  app: string
  surface: PolicySurface
  peer?: string
  text: string
}

// Covers explicit links and bare domains such as "abc.com" / "x.cn/path".
const URL_PATTERN =
  /https?:\/\/|www\.|[a-z0-9][a-z0-9-]{0,62}\.(?:com|cn|net|org|io|cc|xyz|top|me|info|app|link)\b/i

// The peer may itself contain ':', so only the first separator splits.
export function peerKey(app: string, peer: string): string {
  return `${app}:${peer}`
}

/** Parse one `control.allowedPeers` entry, or null when it is malformed. */
export function parsePeerEntry(entry: string): string | null {
  const trimmed = entry.trim()
  const sep = trimmed.indexOf(':')
  if (sep <= 0 || sep === trimmed.length - 1) {
    return null
  }
  const app = trimmed.slice(0, sep).trim()
  const peer = trimmed.slice(sep + 1).trim()
  if (!app || !peer) {
    return null
  }
  return peerKey(app, peer)
}

export function buildPeerSet(entries: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) {
    const key = parsePeerEntry(entry)
    if (key) {
      out.add(key)
    }
  }
  return out
}

// Pure, deterministic checks. This runs in code, independent of the LLM, so a
// prompt-injection payload cannot talk its way past these rules.
export class OutboundGuard {
  constructor(private readonly config: OutboundGuardConfig) {}

  inspect(content: OutboundContent): string[] {
    const reasons: string[] = []
    const text = content.text ?? ''

    if (needsText(content.surface) && text.trim().length === 0) {
      reasons.push('empty text')
    }

    if (targetsPerson(content.surface)) {
      const peer = (content.peer ?? '').trim()
      if (!peer) {
        reasons.push('peer is required for this action')
      } else if (!this.config.allowedPeers.has(peerKey(content.app, peer))) {
        reasons.push(
          `peer not whitelisted: ${peer} ` +
            `(add "${content.app}:${peer}" to control.allowedPeers)`,
        )
      }
    }

    if ([...text].length > this.config.maxLength) {
      reasons.push(`text exceeds ${this.config.maxLength} chars`)
    }
    if (this.config.blockUrl && URL_PATTERN.test(text)) {
      reasons.push('url is not allowed')
    }
    return reasons
  }
}
