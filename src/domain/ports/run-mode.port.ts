import type {
  GateDecision,
  OutboundMessage,
} from '../control-types.js'

export interface RunModeSnapshot {
  // Master switch. When false the agent never sends, even to whitelisted peers.
  enabled: boolean
  // Dry run: decisions are recorded as if they would be sent, but no device
  // action that transmits a message is executed.
  dryRun: boolean
  // Emergency stop. Latched until an explicit resume(); stronger than enabled.
  halted: boolean
}

export interface RunModePort {
  snapshot(): RunModeSnapshot
  gate(message: OutboundMessage): GateDecision
  enable(): void
  disable(): void
  setDryRun(on: boolean): void
  halt(): void
  resume(): void
}
