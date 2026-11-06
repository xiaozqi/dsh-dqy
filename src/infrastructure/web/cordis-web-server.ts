import type {
  WebRoute,
  WebServerPort,
} from '../../domain/ports/web-server.port.js'

// Minimal structural type of the host webServer service. The DSH host injects
// this at runtime without a published type package, so only the members the
// adapter uses are declared.
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
  on(event: string, listener: (table: unknown[]) => void): () => void
}

// WebServerPort adapter over the concrete DSH host service.
export class CordisWebServer implements WebServerPort {
  constructor(private readonly host: HostWebServer) {}

  register(route: WebRoute): () => void {
    return this.host.register(route)
  }

  tapIndex(tapper: (html: string) => string): () => void {
    return this.host.tapIndex(tapper)
  }

  onIndexInject(listener: (table: unknown[]) => void): () => void {
    return this.host.on('webserver/index-inject', listener)
  }
}
