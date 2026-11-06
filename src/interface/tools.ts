import type { AgentLoop } from '../application/agent-loop.js'
import {
  SignInService,
  flattenUiText,
} from '../application/tasks/signin.task.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { DouyinService } from '../application/apps/douyin.service.js'
import { GameService } from '../application/apps/game.service.js'
import { QqService } from '../application/apps/qq.service.js'
import { DailyScheduler } from '../application/scheduler/daily-scheduler.js'
import { AdapterError } from '../domain/errors.js'
import type { CapabilityId } from '../domain/adapter-types.js'
import type { AppAdapterRegistry } from '../domain/ports/app-adapter.port.js'
import type { SignInCapability } from '../domain/ports/capabilities/signin.port.js'
import type { DevicePort } from '../domain/ports/device.port.js'
import type { MemoryPort } from '../domain/ports/memory.port.js'
import type { NotificationPort } from '../domain/ports/notification.port.js'
import type { VisionPort } from '../domain/ports/vision.port.js'
import type { VoicePort } from '../domain/ports/voice.port.js'
import type { NotificationService } from '../application/notifications/notification.service.js'
import type { UiNode } from '../domain/types.js'
import { registerAppTools } from './app-tools.js'
import type { RunModePort } from '../domain/ports/run-mode.port.js'
import type { MessageStatePort } from '../domain/ports/message-state.port.js'
import type { DmWatchPipeline } from '../application/control/dm-watch-pipeline.js'
import type { MirrorPanelService } from '../application/mirror/mirror-panel.service.js'

export interface FishServices {
  loop: AgentLoop
  signin: SignInService
  device: DevicePort
  memory: MemoryPort
  vision: VisionPort
  voice: VoicePort
  qq: QqService
  douyin: DouyinService
  game: GameService
  scheduler: DailyScheduler
  adapters: AppAdapterRegistry
  adbPath: string
  deviceSerial: string
  notifications: NotificationPort
  runMode: RunModePort
  messageState: MessageStatePort
  dmWatch: DmWatchPipeline
  mirror: MirrorPanelService
}

export function registerTools(
  ctx: Context,
  services: FishServices,
): void {
  ctx.tools.register(
    defineTool({
      name: 'fish_goal',
      description:
        'Give Blue Fat Fish an open-ended goal on the Android phone; it plans and executes autonomously.',
      parameters: {
        goal: {
          type: 'string',
          required: true,
          description: 'Natural language goal',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal: { type: 'string', required: true },
            completed: { type: 'boolean', required: true },
            summary: { type: 'string', required: true },
            steps: { type: 'integer', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `${value.completed ? 'completed' : 'stopped'} after ${value.steps} steps: ${value.summary}`,
          },
        ],
      },
      async execute(args) {
        return services.loop.run(args.goal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_signin',
      description:
        'Run a daily sign-in task. Uses a configured plan; falls back to autonomous mode for unknown apps.',
      parameters: {
        app: {
          type: 'string',
          required: true,
          description: 'App package name or display name',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderSignin(value as Record<string, unknown>),
          },
        ],
      },
      async execute(args): Promise<any> {
        const plan = services.signin
          .listPlans()
          .find(p => p.app === args.app || p.appName === args.app)
        if (plan) {
          const record = await services.signin.run(plan)
          return {
            mode: 'plan',
            app: args.app,
            name: record.name,
            status: record.lastStatus,
            detail: record.detail,
            ok: record.lastStatus === 'success',
            data: {},
          }
        }
        for (const adapter of services.adapters.list()) {
          if (
            (adapter.id === args.app ||
              adapter.displayName === args.app) &&
            adapter.capabilities.has('signin')
          ) {
            const signin = services.adapters.getCapability<SignInCapability>(
              adapter.id,
              'signin',
            )
            const result = await signin.signIn()
            return {
              mode: 'adapter',
              app: adapter.id,
              name: adapter.displayName,
              status: result.ok ? 'success' : 'failed',
              detail: result.detail,
              ok: result.ok,
              data: result.data ?? {},
            }
          }
        }
        const result = await services.loop.run(
          `在${args.app}完成每日签到`,
        )
        return {
          mode: 'autonomous',
          app: args.app,
          name: '',
          status: result.completed ? 'success' : 'stopped',
          detail: result.summary,
          ok: result.completed,
          data: { steps: result.steps },
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_observe',
      description:
        'Capture the current phone screen: foreground app, UI text and screenshot path.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            foreground: { type: 'string', required: true },
            screenshotPath: { type: 'string', required: true },
            nodeCount: { type: 'integer', required: true },
            uiText: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `foreground: ${value.foreground}\n${value.uiText}\nscreenshot: ${value.screenshotPath}`,
          },
        ],
      },
      async execute() {
        const observation = await services.device.observe()
        return {
          foreground: observation.foregroundApp,
          screenshotPath: observation.screenshotPath,
          nodeCount: countNodes(observation.roots),
          uiText: flattenUiText(observation.roots).slice(0, 2000),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_remember',
      description: 'Store a long-term fact in Blue Fat Fish memory.',
      parameters: {
        content: {
          type: 'string',
          required: true,
          description: 'Fact to remember',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            content: { type: 'string', required: true },
            tags: {
              type: 'array',
              required: true,
              items: { type: 'string' },
            },
            createdAt: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `saved: ${value.content}` },
        ],
      },
      async execute(args) {
        return services.memory.remember({
          kind: 'fact',
          content: args.content,
          tags: Array.isArray(args.tags) ? args.tags : [],
        })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_recall',
      description:
        'Search Blue Fat Fish memory for relevant facts and events.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'Search query',
        },
      },
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              content: { type: 'string', required: true },
              tags: {
                type: 'array',
                required: true,
                items: { type: 'string' },
              },
              createdAt: { type: 'string', required: true },
            },
          },
        },
        render: (_args, value) => {
          const text =
            value.length > 0
              ? value.map(r => `- ${r.content}`).join('\n')
              : 'no memory hit'
          return [{ type: 'text', text }]
        },
      },
      async execute(args) {
        return services.memory.recall(args.query, 5)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_status',
      description:
        'Show device connection, configured sign-in plans and task history.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            deviceConnected: { type: 'boolean', required: true },
            plans: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true },
            },
            taskHistory: {
              type: 'array',
              required: true,
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: JSON.stringify(value, null, 2) },
        ],
      },
      async execute() {
        const connected = await services.device.isConnected()
        const taskHistory = await services.memory.listTaskResults()
        return {
          deviceConnected: connected,
          plans: services.signin
            .listPlans()
            .map(p => ({ app: p.app, name: p.appName })),
          taskHistory: taskHistory.map(t => ({ ...t })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_apps',
      description:
        'List registered app adapters, their capabilities and unimplemented TODO items.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderApps(value as unknown as AppListView),
          },
        ],
      },
      async execute() {
        return {
          apps: services.adapters.list().map(a => ({
            id: a.id,
            displayName: a.displayName,
            packageName: a.packageName,
            capabilities: [...a.capabilities],
            todoCount: a.todos.length,
          })),
          todos: services.adapters.listTodos().map(t => ({
            app: t.app,
            capability: t.capability,
            feature: t.feature,
            note: t.note,
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_app_run',
      description:
        'Run one capability action on a registered app adapter. ' +
        'Capability-action pairs: message: sendMessage/sendImage/readConversation; ' +
        'comment: comment/replyComment/browseComments; social: mention; live: watchLive; ' +
        'feed: browseFeed; signin: signIn; pet: feedPet; game: runGame.',
      parameters: {
        app: {
          type: 'string',
          required: true,
          description: 'Adapter id or display name (see fish_apps)',
        },
        capability: {
          type: 'string',
          required: true,
          description:
            'Capability id: message/comment/social/live/feed/signin/pet/game',
        },
        action: {
          type: 'string',
          required: true,
          description: 'Action name within the capability',
        },
        params: {
          type: 'object',
          additionalProperties: true,
          description:
            'Action parameters (peer/text/localImagePath/target/friend/count/...)',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            app: { type: 'string', required: true },
            capability: { type: 'string', required: true },
            action: { type: 'string', required: true },
            ok: { type: 'boolean', required: true },
            detail: { type: 'string', required: true },
            sent: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderAppRun(value as unknown as AppRunView),
          },
        ],
      },
      async execute(args): Promise<any> {
        const app = String(args.app)
        const capability = String(args.capability)
        const action = String(args.action)
        const methodName = CAPABILITY_ACTIONS[capability]?.[action]
        if (!methodName) {
          throw new AdapterError(
            'ACTION_NOT_FOUND',
            `no action ${capability}/${action} in the dispatch table`,
          )
        }
        const adapter = services.adapters.getCapability<Record<string, unknown>>(
          app,
          capability as CapabilityId,
        )
        const fn = adapter[methodName] as
          | ((input: Record<string, unknown>) => Promise<{
              ok: boolean
              detail: string
              sent?: boolean
              data?: Record<string, unknown>
            }>)
          | undefined
        if (typeof fn !== 'function') {
          throw new AdapterError(
            'ACTION_NOT_FOUND',
            `adapter ${app} has no callable ${methodName}`,
          )
        }
        let params: Record<string, unknown> = {}
        if (
          typeof args.params === 'object' &&
          args.params !== null &&
          !Array.isArray(args.params)
        ) {
          params = args.params as Record<string, unknown>
        }
        try {
          const result = await fn.call(adapter, params)
          return {
            app,
            capability,
            action,
            ok: result.ok,
            detail: result.detail,
            sent: result.sent ?? false,
            data: result.data ?? {},
          }
        } catch (err) {
          return {
            app,
            capability,
            action,
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
            sent: false,
            data: {},
          }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'fish_notifications',
      description:
        'Inspect the phone notification pipeline: whether it runs, the live connection state, filter statistics and recently allowed notifications.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderNotifications(value as unknown as NotificationView),
          },
        ],
      },
      async execute(): Promise<any> {
        const svc = services.notifications as NotificationService
        const stats = svc.stats()
        const recent = svc.recent(20).map(d => ({
          app: d.event.app,
          title: d.event.title,
          text: d.event.text,
          when: d.event.when,
          action: d.action,
          reason: d.reason,
        }))
        return {
          enabled: svc.started,
          connected: svc.connected,
          stats,
          recent,
        }
      },
    }),
  )

  registerAppTools(ctx, services)
}

function countNodes(roots: UiNode[]): number {
  let count = 0
  const walk = (nodes: UiNode[]): void => {
    for (const node of nodes) {
      count += 1
      walk(node.children)
    }
  }
  walk(roots)
  return count
}

function renderSignin(value: Record<string, unknown>): string {
  if (value.mode === 'plan') {
    return `${value.name}: ${value.status} - ${value.detail}`
  }
  if (value.mode === 'adapter') {
    return `${value.name}: ${value.ok ? 'ok' : 'failed'} - ${value.detail}`
  }
  return `autonomous: ${value.status} - ${value.detail}`
}

const CAPABILITY_ACTIONS: Record<string, Record<string, string>> = {
  message: {
    sendMessage: 'sendMessage',
    sendImage: 'sendImage',
    readConversation: 'readConversation',
  },
  comment: {
    comment: 'comment',
    replyComment: 'replyComment',
    browseComments: 'browseComments',
  },
  social: { mention: 'mention' },
  live: { watchLive: 'watchLive' },
  feed: { browseFeed: 'browseFeed' },
  signin: { signIn: 'signIn' },
  pet: { feedPet: 'feedPet' },
  game: { runGame: 'runGame' },
}

interface AppListView {
  apps: Array<{
    id: string
    displayName: string
    packageName: string
    capabilities: string[]
    todoCount: number
  }>
  todos: unknown[]
}

interface AppRunView {
  app: string
  capability: string
  action: string
  ok: boolean
  detail: string
  sent?: boolean
  data?: Record<string, unknown>
}

interface NotificationView {
  enabled: boolean
  connected: boolean
  stats: {
    received: number
    allowed: number
    blocked: number
    droppedBy: Record<string, number>
  }
  recent: Array<{
    app: string
    title: string
    text: string
    when: number
    action: string
    reason: string
  }>
}

function renderNotifications(value: NotificationView): string {
  const lines = [
    `enabled=${value.enabled} connected=${value.connected}`,
    `received=${value.stats.received} allowed=${value.stats.allowed} blocked=${value.stats.blocked} dropped=${JSON.stringify(value.stats.droppedBy)}`,
  ]
  if (value.recent.length === 0) {
    lines.push('no recent allowed notifications')
  }
  for (const r of value.recent) {
    const title = r.title || '-'
    const text = r.text || '-'
    lines.push(
      `- [${r.action}] ${r.app} | ${title} | ${text} | ${new Date(r.when).toLocaleTimeString()} | ${r.reason}`,
    )
  }
  return lines.join('\n')
}

function renderApps(value: AppListView): string {
  const lines = value.apps.map(
    a =>
      `${a.id} (${a.displayName}, ${a.packageName}): [${a.capabilities.join(', ')}] todo ${a.todoCount}`,
  )
  if (value.todos.length > 0) {
    lines.push('todos:')
    for (const todo of value.todos as Array<{ app: string; capability: string; feature: string; note: string }>) {
      lines.push(`- ${todo.app}/${todo.capability}: ${todo.feature} (${todo.note})`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'no adapters registered'
}

function renderAppRun(value: AppRunView): string {
  const status = value.ok ? 'ok' : 'failed'
  let text = `${value.app}/${value.capability}/${value.action}: ${status} - ${value.detail}`
  if (value.sent !== undefined) text += `, sent=${value.sent}`
  if (value.data) text += `, data=${JSON.stringify(value.data)}`
  return text
}
