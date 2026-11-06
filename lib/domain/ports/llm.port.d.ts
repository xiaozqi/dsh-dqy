import type { AgentAction } from '../types.js';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface LlmPort {
    decide(messages: ChatMessage[]): Promise<AgentAction>;
    chat(messages: ChatMessage[]): Promise<string>;
    chatJson?(messages: ChatMessage[]): Promise<string>;
}
