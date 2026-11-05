import type {
  AdapterTodo,
  CapabilityId,
} from '../../domain/adapter-types.js'
import {
  AdapterError,
  CapabilityNotImplementedError,
} from '../../domain/errors.js'
import type {
  AppAdapter,
  AppAdapterRegistry,
} from '../../domain/ports/app-adapter.port.js'

export class AdapterRegistry implements AppAdapterRegistry {
  private readonly adapters = new Map<string, AppAdapter>()

  register(adapter: AppAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new AdapterError(
        'ADAPTER_DUPLICATE',
        `adapter already registered: ${adapter.id}`,
      )
    }
    this.adapters.set(adapter.id, adapter)
  }

  list(): AppAdapter[] {
    return [...this.adapters.values()]
  }

  get(id: string): AppAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new AdapterError(
        'ADAPTER_NOT_FOUND',
        `no app adapter registered for: ${id}`,
      )
    }
    return adapter
  }

  getCapability<T>(id: string, capability: CapabilityId): T {
    const adapter = this.get(id)
    if (!adapter.capabilities.has(capability)) {
      throw new CapabilityNotImplementedError(
        'CAPABILITY_NOT_IMPLEMENTED',
        `adapter ${id} does not implement capability ${capability}`,
      )
    }
    return adapter as unknown as T
  }

  listTodos(): Array<AdapterTodo & { app: string }> {
    const out: Array<AdapterTodo & { app: string }> = []
    for (const adapter of this.adapters.values()) {
      for (const todo of adapter.todos) {
        out.push({ app: adapter.id, ...todo })
      }
    }
    return out
  }
}
