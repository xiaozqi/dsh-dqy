import { LlmError } from '../../domain/errors.js'
import type { ActionName, AgentAction } from '../../domain/types.js'

const ACTION_NAMES: ActionName[] = [
  'tap',
  'long_press',
  'swipe',
  'input_text',
  'press_key',
  'open_app',
  'wait',
  'remember',
  'recall',
  'speak',
  'finish',
]

/**
 * Extract the first JSON object from model text.
 *
 * Providers occasionally prepend prose before a JSON body, so the parser slices
 * between the outermost braces instead of requiring a pure JSON document.
 */
export function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError('NO_ACTION_JSON', 'model returned no JSON object')
  }
  return content.slice(start, end + 1)
}

/**
 * Parse one agent action out of model text.
 *
 * Shared by every LlmPort implementation so HTTP and host-routed providers
 * accept exactly the same action vocabulary.
 */
export function parseActionContent(content: string): AgentAction {
  const json = extractJsonObject(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new LlmError(
      'BAD_ACTION_JSON',
      `cannot parse action: ${(err as Error).message}`,
    )
  }
  const obj = parsed as Record<string, unknown>
  const name = obj.name as ActionName
  if (!ACTION_NAMES.includes(name)) {
    throw new LlmError(
      'BAD_ACTION_NAME',
      `unknown action: ${String(obj.name)}`,
    )
  }
  return {
    thought: String(obj.thought ?? ''),
    name,
    args: (obj.args as Record<string, unknown>) ?? {},
  }
}
