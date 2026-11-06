import type {
  WebRoute,
  WebServerPort,
} from '../../domain/ports/web-server.port.js'

// Minimal structural type of the host webServer service. The DSH host injects
// this at runtime without a published type package, so only the members the
// adapter uses are declared. `on` is optional: newer hosts moved the
// index-injection table to a Context event, so the adapter probes for it and
// falls back to the Context listener passed at construction.
export interface HostWebServer {
  register(route: {
    kind: string
    path: string
    // The host is untyped; eslint is relaxed for this boundary so typed
    // handlers can be passed without an artificial unknown wrapper.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => void | Promise<void>
  }): () => void
  tapIndex(tapper: (html: string) => string): () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?: (event: string, listener: (...args: any[]) => void) => () => void
}

// The slice of a Cordis Context the adapter needs for event fallback.
export interface HostEventScope {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): () => void
}

const INDEX_INJECT_EVENT = 'webserver/index-inject'

// WebServerPort adapter over the concrete DSH host service.
export class CordisWebServer implements WebServerPort {
  constructor(
    private readonly host: HostWebServer,
    private readonly events?: HostEventScope,
  ) {}

  register(route: WebRoute): () => void {
    return this.host.register(route)
  }

  tapIndex(tapper: (html: string) => string): () => void {
    return this.host.tapIndex(tapper)
  }

  // Older hosts exposed the injection table as a service method; newer hosts
  // emit it on the Context. Either path is optional, and the raw `tapIndex`
  // injection below still renders the panel when both are unavailable.
  onIndexInject(listener: (table: unknown[]) => void): () => void {
    if (typeof this.host.on === 'function') {
      try {
        return this.host.on(INDEX_INJECT_EVENT, listener)
      } catch {
        // fall through to the Context listener
      }
    }
    if (this.events !== undefined) {
      try {
        return this.events.on(INDEX_INJECT_EVENT, listener)
      } catch {
        // the host does not publish the event: keep the tap path only
      }
    }
    return () => {}
  }
}
