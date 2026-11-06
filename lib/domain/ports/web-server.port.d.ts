import type { IncomingMessage, ServerResponse } from 'node:http';
export interface WebRoute {
    kind: 'exact';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface WebServerPort {
    register(route: WebRoute): () => void;
    tapIndex(tapper: (html: string) => string): () => void;
    onIndexInject(listener: (table: unknown[]) => void): () => void;
}
