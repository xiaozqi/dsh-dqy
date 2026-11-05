import { GuardrailError } from '../domain/errors.js'
import type { AgentAction } from '../domain/types.js'

export interface GuardrailConfig {
  allowedApps: string[]
  forbiddenPackages: string[]
  maxSteps: number
}

export class Guardrails {
  constructor(private readonly config: GuardrailConfig) {}

  checkStep(step: number): void {
    if (step > this.config.maxSteps) {
      throw new GuardrailError(
        'MAX_STEPS',
        `step limit ${this.config.maxSteps} reached without finishing`,
      )
    }
  }

  checkAction(action: AgentAction): void {
    if (action.name !== 'open_app') return
    const pkg = String(action.args.packageName ?? '')
    if (this.config.forbiddenPackages.includes(pkg)) {
      throw new GuardrailError('FORBIDDEN_APP', `package ${pkg} is forbidden`)
    }
    if (
      this.config.allowedApps.length > 0 &&
      !this.config.allowedApps.includes(pkg)
    ) {
      throw new GuardrailError(
        'APP_NOT_WHITELISTED',
        `package ${pkg} is not in the whitelist`,
      )
    }
  }
}
