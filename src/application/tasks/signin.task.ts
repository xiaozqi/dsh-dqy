import { DeviceError } from '../../domain/errors.js'
import type { DevicePort } from '../../domain/ports/device.port.js'
import type { MemoryPort } from '../../domain/ports/memory.port.js'
import type { TaskRecord, UiNode } from '../../domain/types.js'
import type { SignInPlan, SignInStep } from './task-types.js'

export function flattenUiText(roots: UiNode[]): string {
  const lines: string[] = []
  const walk = (nodes: UiNode[]): void => {
    for (const node of nodes) {
      if (node.text) lines.push(node.text)
      walk(node.children)
    }
  }
  walk(roots)
  return lines.join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SignInService {
  constructor(
    private readonly device: DevicePort,
    private readonly memory: MemoryPort,
    private readonly plans: SignInPlan[],
  ) {}

  listPlans(): SignInPlan[] {
    return this.plans
  }

  async runByApp(app: string): Promise<TaskRecord> {
    const plan = this.plans.find(p => p.app === app || p.appName === app)
    if (!plan) throw new DeviceError('PLAN_NOT_FOUND', `no sign-in plan for ${app}`)
    return this.run(plan)
  }

  async run(plan: SignInPlan): Promise<TaskRecord> {
    try {
      for (const step of plan.steps) {
        await this.executeStep(step)
        await sleep(800)
      }
      const observation = await this.device.observe()
      const uiText = flattenUiText(observation.roots)
      const succeeded = plan.successText.some(t => uiText.includes(t))
      const record: TaskRecord = {
        app: plan.app,
        name: plan.appName,
        lastStatus: succeeded ? 'success' : 'failed',
        lastRunAt: new Date().toISOString(),
        detail: succeeded ? 'success markers found' : 'no success marker on screen',
      }
      await this.memory.saveTaskResult(record)
      return record
    } catch (err) {
      const record: TaskRecord = {
        app: plan.app,
        name: plan.appName,
        lastStatus: 'failed',
        lastRunAt: new Date().toISOString(),
        detail: (err as Error).message,
      }
      await this.memory.saveTaskResult(record)
      return record
    }
  }

  private async executeStep(step: SignInStep): Promise<void> {
    switch (step.kind) {
      case 'open_app':
        await this.device.openApp(step.target ?? '')
        break
      case 'click_text': {
        const point = await this.device.findText(step.target ?? '')
        if (!point) {
          throw new DeviceError(
            'ELEMENT_NOT_FOUND',
            `text not found: ${step.target}`,
          )
        }
        await this.device.tap(point)
        break
      }
      case 'input_text':
        await this.device.inputText(step.value ?? '')
        break
      case 'press_key':
        await this.device.pressKey(
          (step.target as 'back' | 'home' | 'recents' | 'enter') ?? 'back',
        )
        break
      case 'wait':
        await sleep(step.durationMs ?? 1500)
        break
    }
  }
}
