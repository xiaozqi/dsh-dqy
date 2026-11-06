import type {
  AdapterResult,
  CapabilityId,
} from '../../domain/adapter-types.js'
import { PolicyBlockedError } from '../../domain/errors.js'
import type {
  AppAdapter,
  AppAdapterRegistry,
} from '../../domain/ports/app-adapter.port.js'
import type {
  PolicyDecision,
  PolicyRequest,
  PolicySurface,
} from '../../domain/policy-types.js'

interface GatedMethod {
  method: string
  surface: PolicySurface
}

// Capability methods whose call leaves the machine or speaks in public. Every
// other method (readConversation, browseFeed, signIn, ...) only moves the phone.
const GATED_METHODS: Partial<Record<CapabilityId, GatedMethod[]>> = {
  message: [
    { method: 'sendMessage', surface: 'message' },
    { method: 'sendImage', surface: 'image' },
  ],
  moment: [{ method: 'publishMoment', surface: 'moment' }],
  social: [{ method: 'mention', surface: 'mention' }],
  comment: [
    { method: 'comment', surface: 'comment' },
    { method: 'replyComment', surface: 'comment' },
  ],
}

/** Which policy surface a capability/method pair belongs to. */
export function surfaceFor(
  capability: string,
  method: string,
): PolicySurface {
  const hit = GATED_METHODS[capability as CapabilityId]?.find(
    item => item.method === method,
  )
  if (hit) {
    return hit.surface
  }
  // Legacy direct sends that are not modelled as a capability.
  if (method === 'sendVoiceWithText') {
    return 'voice'
  }
  return 'device'
}

export interface GuardedRegistryOptions {
  decide(request: PolicyRequest): PolicyDecision
  /** Observability hook: every gated call is reported with its verdict. */
  onDecision?(request: PolicyRequest, decision: PolicyDecision): void
}

interface OutboundInput {
  peer?: unknown
  /** The social capability names its recipient `friend`. */
  friend?: unknown
  text?: unknown
}

function readInput(input: unknown): OutboundInput {
  if (input && typeof input === 'object') {
    return input as OutboundInput
  }
  return {}
}

/**
 * Decorates an adapter registry so that every outbound capability method is
 * decided by the single policy gate before the adapter runs.
 *
 * This is deliberate: tools, the autonomy loop and any future caller all reach
 * adapters through `getCapability()`, so a new caller cannot forget the gate.
 * A dry-run verdict returns a synthetic success without touching the device.
 */
export class GuardedAdapterRegistry implements AppAdapterRegistry {
  constructor(
    private readonly inner: AppAdapterRegistry,
    private readonly options: GuardedRegistryOptions,
  ) {}

  register(adapter: AppAdapter): void {
    this.inner.register(adapter)
  }

  list(): AppAdapter[] {
    return this.inner.list()
  }

  get(id: string): AppAdapter {
    return this.inner.get(id)
  }

  listTodos(): Array<AdapterTodoWithApp> {
    return this.inner.listTodos()
  }

  getCapability<T>(id: string, capability: CapabilityId): T {
    const capabilityObject = this.inner.getCapability<T>(id, capability)
    const gated = GATED_METHODS[capability]
    if (!gated || !capabilityObject) {
      return capabilityObject
    }
    return this.wrap(capabilityObject, id, gated)
  }

  private wrap<T>(target: T, app: string, gated: GatedMethod[]): T {
    const surfaces = new Map(gated.map(item => [item.method, item.surface]))
    return new Proxy(target as unknown as object, {
      get: (object, property, receiver) => {
        const value = Reflect.get(object, property, receiver) as unknown
        if (typeof property !== 'string' || typeof value !== 'function') {
          return value
        }
        const surface = surfaces.get(property)
        if (!surface) {
          return value
        }
        return async (input?: unknown): Promise<AdapterResult> => {
          const args = readInput(input)
          const peer =
            typeof args.peer === 'string'
              ? args.peer
              : typeof args.friend === 'string'
                ? args.friend
                : undefined
          const request: PolicyRequest = {
            app,
            surface,
            peer,
            text: typeof args.text === 'string' ? args.text : '',
          }
          const decision = this.options.decide(request)
          this.options.onDecision?.(request, decision)

          if (decision.verdict === 'block') {
            throw new PolicyBlockedError(
              'POLICY_BLOCKED',
              `${app}/${surface} 被安全策略拦下：${decision.reasons.join('；')}`,
              decision.reasons,
            )
          }
          if (decision.verdict === 'dry-run') {
            return {
              ok: true,
              sent: false,
              detail:
                `试运行（dry-run）：本来要调用 ${app}/${property}` +
                (request.peer ? `，发给 ${request.peer}` : '') +
                '，这次没有真发',
              data: {
                dryRun: true,
                peer: request.peer ?? null,
                text: request.text ?? '',
              },
            }
          }
          return (value as (arg: unknown) => Promise<AdapterResult>).call(
            object,
            input,
          )
        }
      },
    }) as unknown as T
  }
}

// `listTodos` keeps the registry port's shape; declared locally to avoid
// leaking the intersection type through the class.
type AdapterTodoWithApp = ReturnType<AppAdapterRegistry['listTodos']>[number]
