import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
export class HttpNotificationSource {
    port;
    logPath;
    lastError = null;
    server = null;
    listeners = new Set();
    pendingCancels = [];
    seq = 0;
    constructor(port = 14123, logPath) {
        this.port = port;
        this.logPath = logPath;
    }
    get connected() {
        return this.server?.listening ?? false;
    }
    async start() {
        if (this.server?.listening) {
            return;
        }
        try {
            mkdirSync(dirname(this.logPath), { recursive: true });
            await new Promise(resolve => {
                const server = createServer((req, res) => this.handle(req, res));
                server.once('error', err => {
                    this.lastError = err.message;
                    resolve();
                });
                server.listen(this.port, '0.0.0.0', () => {
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
        const chunks = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const event = this.toEvent(body);
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
        const id = typeof body.id === 'string' && body.id
            ? body.id
            : `${Date.now()}-${this.seq++}`;
        const when = typeof body.when === 'number' ? body.when : Date.now();
        return {
            id,
            app: typeof body.app === 'string' ? body.app : '',
            title: typeof body.title === 'string' ? body.title : '',
            text: typeof body.text === 'string' ? body.text : '',
            when,
            importance: 2,
            source: 'http',
        };
    }
    appendLog(event) {
        try {
            appendFileSync(this.logPath, JSON.stringify(event) + '\n', 'utf8');
        }
        catch {
            /* logging failure must not break delivery */
        }
    }
}
