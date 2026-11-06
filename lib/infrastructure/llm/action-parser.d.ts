import type { AgentAction } from '../../domain/types.js';
/**
 * Extract the first JSON object from model text.
 *
 * Providers occasionally prepend prose before a JSON body, so the parser slices
 * between the outermost braces instead of requiring a pure JSON document.
 */
export declare function extractJsonObject(content: string): string;
/**
 * Parse one agent action out of model text.
 *
 * Shared by every LlmPort implementation so HTTP and host-routed providers
 * accept exactly the same action vocabulary.
 */
export declare function parseActionContent(content: string): AgentAction;
