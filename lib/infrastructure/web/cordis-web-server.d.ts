import type { WebRoute, WebServerPort } from '../../domain/ports/web-server.port.js';
export interface HostWebServer {
    register(route: {
        kind: string;
        path: string;
        handler: (...args: any[]) => void | Promise<void>;
    }): () => void;
    tapIndex(tapper: (html: string) => string): () => void;
    on?: (event: string, listener: (...args: any[]) => void) => () => void;
}
export interface HostEventScope {
    on(event: string, listener: (...args: any[]) => void): () => void;
}
export declare class CordisWebServer implements WebServerPort {
    private readonly host;
    private readonly events?;
    constructor(host: HostWebServer, events?: HostEventScope | undefined);
    register(route: WebRoute): () => void;
    tapIndex(tapper: (html: string) => string): () => void;
    onIndexInject(listener: (table: unknown[]) => void): () => void;
}
