import type { AgentAction } from '../../domain/types.js';
/**
 * Extract the first complete JSON object from model text.
 *
 * Providers occasionally wrap the action in prose or emit a second object
 * afterwards. Slicing between the outermost braces used to swallow that
 * trailing text ("Unexpected non-whitespace character after JSON"), so scan
 * for the matching closing brace instead, ignoring braces inside strings.
 */
export declare function extractJsonObject(content: string): string;
/**
 * Parse one agent action out of model text.
 *
 * Shared by every LlmPort implementation so HTTP and host-routed providers
 * accept exactly the same action vocabulary.
 */
export declare function parseActionContent(content: string): AgentAction;
