export const CAPABILITIES = [
  'message',
  'comment',
  'social',
  'live',
  'feed',
  'signin',
  'pet',
  'game',
  'moment',
] as const

export type CapabilityId = (typeof CAPABILITIES)[number]

export interface AdapterResult {
  ok: boolean
  detail: string
  sent?: boolean
  data?: Record<string, unknown>
}

export interface AdapterTodo {
  capability: CapabilityId
  feature: string
  note: string
}

export interface AdapterInfo {
  id: string
  displayName: string
  packageName: string
  capabilities: CapabilityId[]
  todos: AdapterTodo[]
}

export function okResult(
  detail: string,
  data?: Record<string, unknown>,
): AdapterResult {
  return { ok: true, detail, data }
}

export function failResult(
  detail: string,
  data?: Record<string, unknown>,
): AdapterResult {
  return { ok: false, detail, data }
}
