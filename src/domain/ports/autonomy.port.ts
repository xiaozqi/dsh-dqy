import type { CapabilityId } from '../adapter-types.js'

// Signals the autonomy loop collects before asking the LLM for a decision.
export interface AutonomySignalBundle {
  // Recent notification summaries, e.g. ["com.tencent.mobileqq: Alice: hi"].
  notifications: string[]
  // Local wall-clock ISO string at collection time.
  now: string
  // Recalled goals / todos / recent lessons, e.g. ["goal: sign in daily"].
  memory: string[]
}

export interface AutonomySignalSource {
  collect(): Promise<AutonomySignalBundle>
}

// Structured decision produced by the LLM each heartbeat.
export interface AutonomyDecision {
  intent: 'act' | 'idle'
  app?: string
  capability?: CapabilityId
  method?: string
  args?: Record<string, unknown>
  reason: string
  // Optional self-reported "wake me again in N ms". The scheduler layer
  // clamps this to [minWakeMs, maxWakeMs]; the loop itself just passes the
  // raw (finite-positive) value through. Missing/illegal => undefined and
  // the driver falls back to its configured default.
  nextWakeMs?: number
  // Optional self-directed goal. When present the loop stores it as a
  // 'goal' record, so the agent can steer its own learning across ticks.
  newGoal?: string
}

// Writes one self-authored daily diary (and the strategies learned that day)
// into memory. Implementations must be idempotent per calendar day.
export interface DiaryPort {
  writeIfDue(now?: Date): Promise<boolean>
}

// Action-level grading: 'auto' runs without human in the loop, 'confirm' pauses.
export type ActionLevel = 'auto' | 'confirm'

export interface AutonomyPolicyPort {
  classify(
    app: string,
    capability: CapabilityId,
    method: string,
  ): ActionLevel
}

// Invoked when the policy says a decision needs human confirmation. The
// default implementation logs and records a memory event; a richer hook may
// route the request to a UI / voice channel.
export interface ConfirmHook {
  confirmRequired(
    decision: AutonomyDecision,
    reason: string,
  ): Promise<void>
}
