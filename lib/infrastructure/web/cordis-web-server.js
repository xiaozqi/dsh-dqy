const INDEX_INJECT_EVENT = 'webserver/index-inject';
// WebServerPort adapter over the concrete DSH host service.
export class CordisWebServer {
    host;
    events;
    constructor(host, events) {
        this.host = host;
        this.events = events;
    }
    register(route) {
        return this.host.register(route);
    }
    tapIndex(tapper) {
        return this.host.tapIndex(tapper);
    }
    // Older hosts exposed the injection table as a service method; newer hosts
    // emit it on the Context. Either path is optional, and the raw `tapIndex`
    // injection below still renders the panel when both are unavailable.
    onIndexInject(listener) {
        if (typeof this.host.on === 'function') {
            try {
                return this.host.on(INDEX_INJECT_EVENT, listener);
            }
            catch {
                // fall through to the Context listener
            }
        }
        if (this.events !== undefined) {
            try {
                return this.events.on(INDEX_INJECT_EVENT, listener);
            }
            catch {
                // the host does not publish the event: keep the tap path only
            }
        }
        return () => { };
    }
}
