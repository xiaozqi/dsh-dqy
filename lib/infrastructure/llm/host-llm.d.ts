import type { LlmRuntime } from '@deepseek-ai/dsh-llm';
import type { ChatMessage, LlmPort } from '../../domain/ports/llm.port.js';
import type { AgentAction } from '../../domain/types.js';
export interface HostLlmOptions {
    runtime: LlmRuntime;
    /** Model id to prefer when the host exposes several; falls back to the first. */
    preferredModel: string;
    timeoutMs: number;
}
/**
 * LlmPort backed by the DeepSeek Harness model channel (`ctx.llm`).
 *
 * When a plugin runs inside DSH the host already holds the provider route and
 * credentials, so this adapter borrows the host runtime instead of asking the
 * user for a second apiKey. The route is resolved lazily once and cached; a
 * DeepSeek route wins when several providers are registered.
 */
export declare class HostLlm implements LlmPort {
    private readonly options;
    private route;
    constructor(options: HostLlmOptions);
    chat(messages: ChatMessage[]): Promise<string>;
    chatJson(messages: ChatMessage[]): Promise<string>;
    decide(messages: ChatMessage[]): Promise<AgentAction>;
    private resolveRoute;
    private complete;
}
/**
 * Detect a usable host model runtime on the cordis context.
 *
 * Returns null when the plugin runs standalone or when the host has not
 * registered a provider yet, so callers can fall back to the HTTP adapter.
 */
export declare function detectHostLlm(ctx: unknown): LlmRuntime | null;
