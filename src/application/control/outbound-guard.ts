import type { OutboundMessage } from '../../domain/control-types.js'

export interface OutboundGuardConfig {
  // Keys are `${app}:${peer}`. An empty set blocks every peer (fail closed).
  allowedPeers: ReadonlySet<string>
  maxLength: number
  blockUrl: boolean
}

// Covers explicit links and bare domains such as "abc.com" / "x.cn/path".
const URL_PATTERN =
  /https?:\/\/|www\.|[a-z0-9][a-z0-9-]{0,62}\.(?:com|cn|net|org|io|cc|xyz|top|me|info|app|link)\b/i

export function peerKey(app: string, peer: string): string {
  return `${app}\u0000${peer}`
}

// Pure, deterministic checks. This runs in code, independent of the LLM, so a
// prompt-injection payload cannot talk its way past these rules.
export class OutboundGuard {
  constructor(private readonly config: OutboundGuardConfig) {}

  inspect(message: OutboundMessage): string[] {
    const reasons: string[] = []
    const text = message.text ?? ''

    if (text.trim().length === 0) {
      reasons.push('empty text')
    }
    if (!this.config.allowedPeers.has(peerKey(message.app, message.peer))) {
      reasons.push(`peer not whitelisted: ${message.peer}`)
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
