export type OwnerCommand =
  | { kind: 'status' }
  | { kind: 'feed'; count: number }
  | { kind: 'unknown'; raw: string }

/**
 * Parses an owner command from an inbound message.
 *
 * The passphrase is a second factor on top of the owner-account list: without
 * it, an attacker holding the account can only chat, not command. It is
 * deliberately not a permission escalator — the command set stays small and
 * every side-effecting command is still checked by the outbound policy.
 */
export function parseOwnerCommand(
  text: string,
  passphrase: string,
): OwnerCommand | null {
  const secret = passphrase.trim()
  if (!secret) {
    return null
  }
  const index = text.indexOf(secret)
  if (index < 0) {
    return null
  }
  const rest = text
    .slice(index + secret.length)
    .trim()
    .replace(/^[，,。.！!？?\s]+/, '')
  if (!rest || /^(状态|status|在吗)$/i.test(rest)) {
    return { kind: 'status' }
  }
  if (/^(帮助|help|指令)$/i.test(rest)) {
    return { kind: 'unknown', raw: 'help' }
  }
  const feed = /^刷(?:会儿)?抖音(?:\s*(\d+))?$/.exec(rest)
  if (feed) {
    const count = Number(feed[1] ?? '5')
    return { kind: 'feed', count: Math.max(1, Math.min(count, 20)) }
  }
  return { kind: 'unknown', raw: rest }
}
