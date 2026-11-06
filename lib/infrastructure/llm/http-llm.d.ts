import type { ChatMessage, LlmPort } from '../../domain/ports/llm.port.js';
import type { AgentAction } from '../../domain/types.js';
export interface HttpLlmConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
}
export declare class HttpLlm implements LlmPort {
    private readonly config;
    constructor(config: HttpLlmConfig);
    chat(messages: ChatMessage[]): Promise<string>;
    chatJson(messages: ChatMessage[]): Promise<string>;
    decide(messages: ChatMessage[]): Promise<AgentAction>;
    private request;
}
