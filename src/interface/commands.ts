import type { Context } from '@deepseek-ai/cordis'
import type { FishServices } from './tools.js'

interface CommandInvocation {
  rawInput: string
}

export function registerCommands(
  ctx: Context,
  services: FishServices,
): void {
  const commands = ctx.get('commands')
  if (!commands) return

  commands.register({
    name: 'fish',
    description:
      'Give Blue Fat Fish a goal to execute autonomously on the phone',
    input: { hint: '<goal>' },
    handler: async (invocation: CommandInvocation) => {
      const result = await services.loop.run(invocation.rawInput.trim())
      return {
        kind: 'success',
        text: `${result.completed ? 'done' : 'stopped'} (${result.steps} steps): ${result.summary}`,
      }
    },
  })

  commands.register({
    name: 'signin',
    description: 'Run a daily sign-in task by app package or display name',
    input: { hint: '<app>' },
    handler: async (invocation: CommandInvocation) => {
      const app = invocation.rawInput.trim()
      const plan = services.signin
        .listPlans()
        .find(p => p.app === app || p.appName === app)
      if (plan) {
        const record = await services.signin.run(plan)
        return {
          kind: 'success',
          text: `${record.name}: ${record.lastStatus} - ${record.detail}`,
        }
      }
      for (const adapter of services.adapters.list()) {
        if (
          (adapter.id === app || adapter.displayName === app) &&
          adapter.capabilities.has('signin')
        ) {
          const signin = services.adapters.getCapability<{
            signIn(): Promise<{ ok: boolean; detail: string }>
          }>(adapter.id, 'signin')
          const result = await signin.signIn()
          return {
            kind: 'success',
            text: `${adapter.displayName}: ${result.ok ? 'ok' : 'failed'} - ${result.detail}`,
          }
        }
      }
      return {
        kind: 'error',
        text: `no plan or signin adapter for ${app}; use /fish for autonomous mode`,
      }
    },
  })

  commands.register({
    name: 'apps',
    description: 'List registered app adapters and their capabilities',
    input: { hint: '' },
    handler: async () => {
      const lines = services.adapters.list().map(a => {
        const capabilities = [...a.capabilities].join(',')
        return `${a.id} (${a.displayName}, ${a.packageName}): [${capabilities}] todo=${a.todos.length}`
      })
      return {
        kind: 'success',
        text:
          lines.length > 0
            ? lines.join('\n')
            : 'no adapters registered',
      }
    },
  })
}
