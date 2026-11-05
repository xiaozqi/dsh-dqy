import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { LlmError } from '../../domain/errors.js'
import type { ChatMessage, LlmPort } from '../../domain/ports/llm.port.js'
import type { AgentAction } from '../../domain/types.js'
import { parseActionContent } from './action-parser.js'

export interface HostLlmOptions {
  runtime: LlmRuntime
  /** Model id to prefer when the host exposes several; falls back to the first. */
  preferredModel: string
  timeoutMs: number
}

interface Route {
  provider: string
  model: string
}

/**
 * Minimal message shape the host stream accepts.
 *
 * Built as a plain object on purpose: the adapter then has no runtime
 * dependency on the host's message factories, so a peer-version drift in
 * @deepseek-ai/dsh-llm cannot break plugin loading.
 */
interface HostMessage {
  id: string
  role: 'user' | 'assistant'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' } | { kind: 'model'; provider: string; model: string }
}

function buildMessage(
  message: ChatMessage,
  route: Route,
  seq: number,
): HostMessage {
  const text = [{ type: 'text' as const, text: message.content }]
  if (message.role === 'assistant') {
    return {
      id: `bff-${Date.now()}-${seq}`,
      role: 'assistant',
      content: text,
      source: { kind: 'model', provider: route.provider, model: route.model },
    }
  }
  return {
    id: `bff-${Date.now()}-${seq}`,
    role: 'user',
    content: text,
    source: { kind: 'user' },
  }
}

/**
 * LlmPort backed by the DeepSeek Harness model channel (`ctx.llm`).
 *
 * When a plugin runs inside DSH the host already holds the provider route and
 * credentials, so this adapter borrows the host runtime instead of asking the
 * user for a second apiKey. The route is resolved lazily once and cached; a
 * DeepSeek route wins when several providers are registered.
 */
export class HostLlm implements LlmPort {
  private route: Route | null = null

  constructor(private readonly options: HostLlmOptions) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    return this.complete(messages)
  }

  async chatJson(messages: ChatMessage[]): Promise<string> {
    return this.complete(messages)
  }

  async decide(messages: ChatMessage[]): Promise<AgentAction> {
    return parseActionContent(await this.complete(messages))
  }

  private async resolveRoute(): Promise<Route> {
    if (this.route) return this.route
    const runtime = this.options.runtime
    const providers = runtime.listProviders()
    if (providers.length === 0) {
      throw new LlmError(
        'HOST_LLM_NO_PROVIDER',
        'host llm has no registered provider route',
      )
    }
    const provider =
      providers.find(p => /deepseek/i.test(`${p.id} ${p.name}`)) ??
      providers[0]
    let modelIds: string[] = []
    try {
      modelIds = (await runtime.listModels(provider.id)).map(m => m.id)
    } catch {
      modelIds = []
    }
    const preferred = this.options.preferredModel.trim()
    const model =
      preferred && modelIds.includes(preferred)
        ? preferred
        : (modelIds[0] ?? preferred)
    if (!model) {
      throw new LlmError(
        'HOST_LLM_NO_MODEL',
        `host provider ${provider.id} exposes no model id`,
      )
    }
    this.route = { provider: provider.id, model }
    return this.route
  }

  private async complete(messages: ChatMessage[]): Promise<string> {
    const route = await this.resolveRoute()
    const system = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')
    const conversation = messages.filter(m => m.role !== 'system')
    const built = conversation.map((message, seq) =>
      buildMessage(message, route, seq),
    )
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    let text = ''
    try {
      const request: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        messages: built as unknown as GenerateOptions['messages'],
        temperature: 0.2,
        signal: controller.signal,
        ...(system ? { system } : {}),
      }
      for await (const chunk of this.options.runtime.stream(request)) {
        if (chunk.type === 'text-delta') text += chunk.text
      }
      if (text.trim().length === 0) {
        throw new LlmError(
          'HOST_LLM_EMPTY',
          'host llm returned no text content',
        )
      }
      return text
    } catch (err) {
      if (err instanceof LlmError) throw err
      throw new LlmError('HOST_LLM_FAILED', (err as Error).message)
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Detect a usable host model runtime on the cordis context.
 *
 * Returns null when the plugin runs standalone or when the host has not
 * registered a provider yet, so callers can fall back to the HTTP adapter.
 */
export function detectHostLlm(ctx: unknown): LlmRuntime | null {
  try {
    const candidate = (ctx as { llm?: LlmRuntime }).llm
    if (
      candidate &&
      typeof candidate.stream === 'function' &&
      typeof candidate.listProviders === 'function' &&
      candidate.listProviders().length > 0
    ) {
      return candidate
    }
  } catch {
    // A host without the llm service must not break plugin loading.
  }
  return null
}
