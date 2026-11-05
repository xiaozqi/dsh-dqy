import { LlmError } from '../../domain/errors.js'
import type { ChatMessage, LlmPort } from '../../domain/ports/llm.port.js'
import type { AgentAction } from '../../domain/types.js'
import { parseActionContent } from './action-parser.js'

export interface HttpLlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string }
  }>
}

export class HttpLlm implements LlmPort {
  constructor(private readonly config: HttpLlmConfig) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const data = await this.request(messages, false)
    return data.choices?.[0]?.message?.content ?? ''
  }

  async chatJson(messages: ChatMessage[]): Promise<string> {
    const data = await this.request(messages, true)
    return data.choices?.[0]?.message?.content ?? ''
  }

  async decide(messages: ChatMessage[]): Promise<AgentAction> {
    const data = await this.request(messages, true)
    const content = data.choices?.[0]?.message?.content ?? ''
    return parseActionContent(content)
  }

  private async request(
    messages: ChatMessage[],
    jsonMode: boolean,
  ): Promise<ChatCompletionResponse> {
    if (!this.config.apiKey) {
      throw new LlmError(
        'NO_API_KEY',
        'apiKey missing in plugin config',
      )
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    )
    try {
      const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.2,
          ...(jsonMode
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new LlmError(
          'LLM_HTTP_ERROR',
          `HTTP ${res.status}: ${await res.text()}`,
        )
      }
      return (await res.json()) as ChatCompletionResponse
    } catch (err) {
      if (err instanceof LlmError) throw err
      throw new LlmError(
        'LLM_REQUEST_FAILED',
        (err as Error).message,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
