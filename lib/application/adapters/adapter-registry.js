import { AdapterError, CapabilityNotImplementedError, } from '../../domain/errors.js';
export class AdapterRegistry {
    adapters = new Map();
    register(adapter) {
        if (this.adapters.has(adapter.id)) {
            throw new AdapterError('ADAPTER_DUPLICATE', `adapter already registered: ${adapter.id}`);
        }
        this.adapters.set(adapter.id, adapter);
    }
    list() {
        return [...this.adapters.values()];
    }
    get(id) {
        const adapter = this.adapters.get(id);
        if (!adapter) {
            throw new AdapterError('ADAPTER_NOT_FOUND', `no app adapter registered for: ${id}`);
        }
        return adapter;
    }
    getCapability(id, capability) {
        const adapter = this.get(id);
        if (!adapter.capabilities.has(capability)) {
            throw new CapabilityNotImplementedError('CAPABILITY_NOT_IMPLEMENTED', `adapter ${id} does not implement capability ${capability}`);
        }
        return adapter;
    }
    listTodos() {
        const out = [];
        for (const adapter of this.adapters.values()) {
            for (const todo of adapter.todos) {
                out.push({ app: adapter.id, ...todo });
            }
        }
        return out;
    }
}
