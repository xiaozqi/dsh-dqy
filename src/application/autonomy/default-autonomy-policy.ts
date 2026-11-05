import type { CapabilityId } from '../../domain/adapter-types.js'
import type {
  ActionLevel,
  AutonomyPolicyPort,
} from '../../domain/ports/autonomy.port.js'

export interface DefaultAutonomyPolicyConfig {
  // Whitelist of "app/capability/method" strings that may run without confirm.
  autoActions: string[]
  // Blacklist of "app/capability/method" strings that always require confirm,
  // even if also present in autoActions.
  forbiddenActions: string[]
  // When false the loop is maximally conservative: every act decision needs
  // human confirmation regardless of whitelist.
  guardEnabled: boolean
}

export class DefaultAutonomyPolicy implements AutonomyPolicyPort {
  private readonly auto = new Set<string>()
  private readonly forbidden = new Set<string>()
  public guardEnabled: boolean

  constructor(cfg: DefaultAutonomyPolicyConfig) {
    this.guardEnabled = cfg.guardEnabled
    for (const a of cfg.autoActions) this.auto.add(normalize(a))
    for (const f of cfg.forbiddenActions) this.forbidden.add(normalize(f))
  }

  classify(
    app: string,
    capability: CapabilityId,
    method: string,
  ): ActionLevel {
    if (!this.guardEnabled) return 'confirm'
    const full = normalize(`${app}/${capability}/${method}`)
    const short = normalize(`${capability}/${method}`)
    // Both "app/capability/method" and "capability/method" keys are honored,
    // so a rule like "message/sendMessage" applies across every adapter.
    if (this.forbidden.has(full) || this.forbidden.has(short)) return 'confirm'
    if (this.auto.has(full) || this.auto.has(short)) return 'auto'
    return 'confirm'
  }
}

function normalize(key: string): string {
  return key.trim().toLowerCase()
}
