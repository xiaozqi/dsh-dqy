// The only vocabulary the outbound policy understands.
//
// A surface decides which checks apply:
//   - person-targeted (message/image/voice/mention): recipient must be
//     whitelisted, so untrusted text can never pick a new recipient.
//   - public (moment/comment): content rules only.
//   - device: does not leave the phone, the autonomy policy grades it.
export type PolicySurface =
  | 'message'
  | 'image'
  | 'voice'
  | 'share'
  | 'moment'
  | 'comment'
  | 'mention'
  | 'device'

export interface PolicyRequest {
  app: string
  surface: PolicySurface
  peer?: string
  text?: string
}

export type PolicyVerdict = 'allow' | 'dry-run' | 'block'

export interface PolicyDecision {
  verdict: PolicyVerdict
  reasons: string[]
}

export interface PolicyOptions {
  /**
   * Set only by an owner-approved confirmation (`/confirm approve`).
   *
   * It bypasses the master switch and dry run, never the content rules and
   * never the emergency halt: an approval proves intent, not safety.
   */
  humanApproved?: boolean
}

const PERSONAL_SURFACES: ReadonlySet<PolicySurface> = new Set<PolicySurface>([
  'message',
  'image',
  'voice',
  'share',
  'mention',
])

export function isOutbound(surface: PolicySurface): boolean {
  return surface !== 'device'
}

export function targetsPerson(surface: PolicySurface): boolean {
  return PERSONAL_SURFACES.has(surface)
}

export function needsText(surface: PolicySurface): boolean {
  return (
    surface === 'message' ||
    surface === 'voice' ||
    surface === 'moment' ||
    surface === 'comment' ||
    surface === 'mention'
  )
}
