import type {
  GateDecision,
  OutboundMessage,
} from '../../domain/control-types.js'
import type {
  PolicyDecision,
  PolicyOptions,
  PolicyRequest,
} from '../../domain/policy-types.js'
import { isOutbound } from '../../domain/policy-types.js'
import type { StateStorePort } from '../../domain/ports/state-store.port.js'
import type {
  RunModePort,
  RunModeSnapshot,
} from '../../domain/ports/run-mode.port.js'
import type { OutboundGuard } from './outbound-guard.js'

const STORE_KEY = 'run-mode'

// Safe defaults: nothing transmits until the user explicitly enables it, and
// dry run stays on so the first real sessions only log intended replies.
const DEFAULT_SNAPSHOT: RunModeSnapshot = {
  enabled: false,
  dryRun: true,
  halted: false,
}

export class RunMode implements RunModePort {
  private state: RunModeSnapshot

  constructor(
    private readonly store: StateStorePort,
    private readonly guard: OutboundGuard,
    initial: RunModeSnapshot = DEFAULT_SNAPSHOT,
  ) {
    // Persisted state wins after the first manual change; the supplied initial
    // snapshot is only used when no state file exists yet.
    this.state = store.load(STORE_KEY, initial)
  }

  snapshot(): RunModeSnapshot {
    return { ...this.state }
  }

  decide(
    request: PolicyRequest,
    options: PolicyOptions = {},
  ): PolicyDecision {
    // Device-only actions never leave the phone; the autonomy policy is the
    // only thing that grades them.
    if (!isOutbound(request.surface)) {
      return { verdict: 'allow', reasons: [] }
    }

    if (this.state.halted) {
      return {
        verdict: 'block',
        reasons: ['emergency halt is active (run /watch resume)'],
      }
    }

    const violations = this.guard.inspect({
      app: request.app,
      surface: request.surface,
      peer: request.peer,
      text: request.text ?? '',
    })
    if (violations.length > 0) {
      return { verdict: 'block', reasons: violations }
    }

    if (options.humanApproved) {
      return { verdict: 'allow', reasons: ['approved by owner'] }
    }
    if (!this.state.enabled) {
      return {
        verdict: 'block',
        reasons: ['auto send is disabled (run /watch enable)'],
      }
    }
    if (this.state.dryRun) {
      return { verdict: 'dry-run', reasons: ['dry run mode'] }
    }
    return { verdict: 'allow', reasons: [] }
  }

  gate(message: OutboundMessage): GateDecision {
    const decision = this.decide({
      app: message.app,
      surface: 'message',
      peer: message.peer,
      text: message.text,
    })
    return {
      verdict: decision.verdict === 'allow' ? 'send' : decision.verdict,
      reasons: decision.reasons,
    }
  }

  enable(): void {
    this.update({ enabled: true })
  }

  disable(): void {
    this.update({ enabled: false })
  }

  setDryRun(on: boolean): void {
    this.update({ dryRun: on })
  }

  halt(): void {
    // Halt latches and also flips the master switch off.
    this.update({ halted: true, enabled: false })
  }

  resume(): void {
    // Resume clears the latch but does not re-enable sending by itself.
    this.update({ halted: false })
  }

  private update(patch: Partial<RunModeSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.store.save(STORE_KEY, this.state)
  }
}
