import { createServer } from 'node:http';
import { createFileLogger } from '../file-logger.js';
const MAX_TEXT = 4000;
const DEFAULT_MAX_BODY = 64 * 1024;
export class HttpNotificationSource {
    port;
    lastError = null;
    server = null;
    listeners = new Set();
    pendingCancels = [];
    logger;
    bindHost;
    token;
    maxBodyBytes;
    allowedApps;
    seq = 0;
    constructor(port = 14123, logPath, options = {}) {
        this.port = port;
        this.bindHost = options.bindHost ?? '127.0.0.1';
        this.token = options.token ?? '';
        this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
        this.allowedApps = new Set(options.allowedApps ?? []);
        this.logger = options.logger ?? createFileLogger(logPath);
    }
    get connected() {
        return this.server?.listening ?? false;
    }
    async start() {
        if (this.server?.listening) {
            return;
        }
        try {
            await new Promise(resolve => {
                const server = createServer((req, res) => this.handle(req, res));
                server.once('error', err => {
                    this.lastError = err.message;
                    resolve();
                });
                server.listen(this.port, this.bindHost, () => {
                    server.removeAllListeners('error');
                    this.server = server;
                    this.lastError = null;
                    resolve();
                });
            });
        }
        catch (err) {
            this.lastError = err.message;
        }
    }
    async stop() {
        const server = this.server;
        this.server = null;
        if (!server) {
            return;
        }
        await new Promise(resolve => server.close(() => resolve()));
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    pushCancel(key) {
        if (this.pendingCancels.includes(key)) {
            return;
        }
        this.pendingCancels.push(key);
        if (this.pendingCancels.length > 500) {
            this.pendingCancels.shift();
        }
    }
    handle(req, res) {
        if (req.method === 'GET' &&
            typeof req.url === 'string' &&
            req.url.startsWith('/api/pending-cancels')) {
            const cancels = this.pendingCancels.splice(0, this.pendingCancels.length);
            res
                .writeHead(200, { 'content-type': 'application/json' })
                .end(JSON.stringify({ cancels }));
            return;
        }
        if (req.method !== 'POST') {
            res.writeHead(404).end();
            return;
        }
        if (this.token && String(req.headers['x-fish-token'] ?? '') !== this.token) {
            res.writeHead(403).end();
            return;
        }
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', chunk => {
            if (tooLarge) {
                return;
            }
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            if (size > this.maxBodyBytes) {
                tooLarge = true;
                chunks.length = 0;
                res.writeHead(413, { 'content-type': 'application/json' }).end('{"ok":false,"error":"body too large"}');
                return;
            }
            chunks.push(buffer);
        });
        req.on('end', () => {
            if (tooLarge) {
                return;
            }
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const event = this.toEvent(body);
                if (!event) {
                    res.writeHead(400, { 'content-type': 'application/json' }).end('{"ok":false,"error":"app not allowed"}');
                    return;
                }
                this.appendLog(event);
                for (const cb of this.listeners) {
                    try {
                        cb(event);
                    }
                    catch {
                        /* a listener failure must not break the HTTP endpoint */
                    }
                }
                res
                    .writeHead(200, { 'content-type': 'application/json' })
                    .end('{"ok":true}');
            }
            catch {
                res.writeHead(400).end();
            }
        });
        req.on('error', () => {
            res.writeHead(400).end();
        });
    }
    toEvent(body) {
        const app = typeof body.app === 'string' ? body.app.slice(0, 200) : '';
        if (this.allowedApps.size > 0 && !this.allowedApps.has(app)) {
            return null;
        }
        const id = typeof body.id === 'string' && body.id
            ? body.id.slice(0, 200)
            : `${Date.now()}-${this.seq++}`;
        const when = typeof body.when === 'number' ? body.when : Date.now();
        const importance = typeof body.importance === 'number' &&
            Number.isFinite(body.importance)
            ? body.importance
            : 2;
        return {
            id,
            app,
            title: typeof body.title === 'string' ? body.title.slice(0, MAX_TEXT) : '',
            text: typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '',
            when,
            importance,
            source: 'http',
        };
    }
    appendLog(event) {
        try {
            this.logger(JSON.stringify(event));
        }
        catch {
            /* logging failure must not break delivery */
        }
    }
}
