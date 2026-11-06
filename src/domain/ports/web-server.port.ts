import type { IncomingMessage, ServerResponse } from 'node:http'

export interface WebRoute {
  kind: 'exact'
  path: string
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void | Promise<void>
}

// Abstraction over the DSH host web server so the panel integration never
// depends on a concrete, untyped host service.
export interface WebServerPort {
  // Register a route; returns a disposer for lifecycle-managed registration.
  register(route: WebRoute): () => void
  // Transform the host index HTML before it is served.
  tapIndex(tapper: (html: string) => string): () => void
  // Subscribe to index injection requests; returns a disposer.
  onIndexInject(listener: (table: unknown[]) => void): () => void
}
