import type { AgentAction } from '../types.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmPort {
  decide(messages: ChatMessage[]): Promise<AgentAction>
  chat(messages: ChatMessage[]): Promise<string>
  // Optional JSON-mode completion (response_format=json_object). Implementers
  // that support it should use it for decision loops: constrained output is
  // faster and parse-safe. Consumers fall back to chat() when absent.
  chatJson?(messages: ChatMessage[]): Promise<string>
}
