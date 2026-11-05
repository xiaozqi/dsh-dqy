import type { AdapterTodo, CapabilityId } from '../adapter-types.js'

export interface AppAdapter {
  readonly id: string
  readonly displayName: string
  readonly packageName: string
  readonly capabilities: ReadonlySet<CapabilityId>
  readonly todos: readonly AdapterTodo[]
  initialize(): Promise<void>
}

export interface AppAdapterRegistry {
  register(adapter: AppAdapter): void
  list(): AppAdapter[]
  get(id: string): AppAdapter
  getCapability<T>(id: string, capability: CapabilityId): T
  listTodos(): Array<AdapterTodo & { app: string }>
}
