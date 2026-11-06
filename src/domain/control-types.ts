// Outbound message moving through the watch pipeline. It is the only shape the
// guard and run-mode gate are allowed to inspect, so untrusted conversation
// text never reaches the device tools directly.
export interface OutboundMessage {
  app: string
  conversationId: string
  peer: string
  text: string
}

// send: real device action permitted.
// dry-run: logged only, nothing is sent.
// block: hard guard rejected the message.
export type GateVerdict = 'send' | 'dry-run' | 'block'

export interface GateDecision {
  verdict: GateVerdict
  reasons: string[]
}

// Lifecycle of one inbound message. Persisted so a crash or reconnect resumes
// from the last phase instead of replaying a reply.
export type MessagePhase =
  | 'pending'
  | 'filtered'
  | 'decided'
  | 'acting'
  | 'sent'
  | 'verified'
  | 'failed'

// Allowed forward transitions. Any other jump is a programming error.
export const PHASE_TRANSITIONS: Record<MessagePhase, readonly MessagePhase[]> = {
  pending: ['filtered', 'failed'],
  filtered: ['decided', 'failed'],
  // decided -> verified covers a decision that no reply is needed.
  decided: ['acting', 'verified', 'failed'],
  // acting -> verified covers dry-run, where nothing is actually transmitted.
  acting: ['sent', 'verified', 'failed'],
  sent: ['verified', 'failed'],
  verified: [],
  failed: ['pending'],
}
