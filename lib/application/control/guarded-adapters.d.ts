import type { CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapter, AppAdapterRegistry } from '../../domain/ports/app-adapter.port.js';
import type { PolicyDecision, PolicyRequest, PolicySurface } from '../../domain/policy-types.js';
/** Which policy surface a capability/method pair belongs to. */
export declare function surfaceFor(capability: string, method: string): PolicySurface;
export interface GuardedRegistryOptions {
    decide(request: PolicyRequest): PolicyDecision;
    /** Observability hook: every gated call is reported with its verdict. */
    onDecision?(request: PolicyRequest, decision: PolicyDecision): void;
}
/**
 * Decorates an adapter registry so that every outbound capability method is
 * decided by the single policy gate before the adapter runs.
 *
 * This is deliberate: tools, the autonomy loop and any future caller all reach
 * adapters through `getCapability()`, so a new caller cannot forget the gate.
 * A dry-run verdict returns a synthetic success without touching the device.
 */
export declare class GuardedAdapterRegistry implements AppAdapterRegistry {
    private readonly inner;
    private readonly options;
    constructor(inner: AppAdapterRegistry, options: GuardedRegistryOptions);
    register(adapter: AppAdapter): void;
    list(): AppAdapter[];
    get(id: string): AppAdapter;
    listTodos(): Array<AdapterTodoWithApp>;
    getCapability<T>(id: string, capability: CapabilityId): T;
    private wrap;
}
type AdapterTodoWithApp = ReturnType<AppAdapterRegistry['listTodos']>[number];
export {};
