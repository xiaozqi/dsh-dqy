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
 * Extract the first complete JSON object from model text.
 *
 * Providers occasionally wrap the action in prose or emit a second object
 * afterwards. Slicing between the outermost braces used to swallow that
 * trailing text ("Unexpected non-whitespace character after JSON"), so scan
 * for the matching closing brace instead, ignoring braces inside strings.
 */
export function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  if (start === -1) {
    throw new LlmError('NO_ACTION_JSON', 'model returned no JSON object')
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < content.length; index++) {
    const char = content[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return content.slice(start, index + 1)
      }
    }
  }
  throw new LlmError(
    'NO_ACTION_JSON',
    'model reply has an unbalanced JSON object',
  )
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
