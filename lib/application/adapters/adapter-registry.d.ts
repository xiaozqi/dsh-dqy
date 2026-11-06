import type { AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapter, AppAdapterRegistry } from '../../domain/ports/app-adapter.port.js';
export declare class AdapterRegistry implements AppAdapterRegistry {
    private readonly adapters;
    register(adapter: AppAdapter): void;
    list(): AppAdapter[];
    get(id: string): AppAdapter;
    getCapability<T>(id: string, capability: CapabilityId): T;
    listTodos(): Array<AdapterTodo & {
        app: string;
    }>;
}
