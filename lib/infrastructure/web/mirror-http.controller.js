import { randomBytes } from 'node:crypto';
const BODY_LIMIT = 200 * 1024;
function sendJson(res, code, obj) {
    res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(obj));
}
// Read and parse a JSON body, draining the stream even when it exceeds the
// limit so the request always reaches end.
function readBody(req) {
    return new Promise(resolve => {
        let raw = '';
        let tooLarge = false;
        req.on('data', c => {
            if (tooLarge)
                return;
            raw += c;
            if (raw.length > BODY_LIMIT) {
                tooLarge = true;
                raw = '';
            }
        });
        req.on('end', () => {
            if (tooLarge)
                return resolve({ tooLarge: true });
            try {
                const parsed = JSON.parse(raw || '{}');
                resolve({
                    body: parsed && typeof parsed === 'object' ? parsed : {},
                });
            }
            catch {
                resolve({ body: {} });
            }
        });
        req.on('error', () => resolve({ body: {} }));
    });
}
// Registers every panel route and the index injection. Write routes require
// same-origin POST plus a per-start random token; read routes only accept
// GET/HEAD and still enforce the same-origin check.
export class MirrorHttpController {
    web;
    panel;
    base;
    token = randomBytes(16).toString('hex');
    tokenHeader = 'x-fim-token';
    constructor(web, panel, base) {
        this.web = web;
        this.panel = panel;
        this.base = base;
    }
    register() {
        const disposers = [];
        const add = (sub, handler, mode = 'read') => {
            disposers.push(this.web.register({
                kind: 'exact',
                path: this.base + sub,
                handler: this.guard(handler, mode),
            }));
        };
        add('/status', (_req, res) => sendJson(res, 200, this.panel.getStatus()));
        add('/phone', async (_req, res) => sendJson(res, 200, await this.panel.getPhoneState()));
        add('/config', async (req, res) => {
            if (req.method === 'POST') {
                const r = await readBody(req);
                if (r.tooLarge)
                    return sendJson(res, 413, { ok: false, error: '请求体太大' });
                return sendJson(res, 200, this.panel.updateConfig(r.body ?? {}));
            }
            sendJson(res, 200, this.panel.getConfig());
        }, 'rw');
        add('/devices', async (_req, res) => sendJson(res, 200, await this.panel.listDevices()));
        add('/deps', async (_req, res) => sendJson(res, 200, await this.panel.getDeps()));
        add('/deps/install', async (req, res) => {
            const r = await readBody(req);
            if (r.tooLarge)
                return sendJson(res, 413, { ok: false, error: '请求体太大' });
            const what = String(r.body?.what ?? '');
            sendJson(res, 200, await this.panel.installDep(what));
        }, 'write');
        add('/start', async (_req, res) => sendJson(res, 200, await this.panel.start()), 'write');
        add('/stop', async (_req, res) => sendJson(res, 200, await this.panel.stop()), 'write');
        add('/unlock', async (_req, res) => sendJson(res, 200, await this.panel.unlock()), 'write');
        add('/lock', async (_req, res) => sendJson(res, 200, await this.panel.lock()), 'write');
        add('/key', async (req, res) => {
            const r = await readBody(req);
            if (r.tooLarge)
                return sendJson(res, 413, { ok: false, error: '请求体太大' });
            const code = Number(r.body?.code ?? 3);
            sendJson(res, 200, await this.panel.pressKey(code));
        }, 'write');
        add('/topmost', async (req, res) => {
            const r = await readBody(req);
            if (r.tooLarge)
                return sendJson(res, 413, { ok: false, error: '请求体太大' });
            const on = r.body?.on;
            if (typeof on !== 'boolean') {
                return sendJson(res, 400, { ok: false, error: '需要 {on: true|false}' });
            }
            sendJson(res, 200, await this.panel.setTopmost(on));
        }, 'write');
        add('/wireless', async (req, res) => {
            const r = await readBody(req);
            if (r.tooLarge)
                return sendJson(res, 413, { ok: false, error: '请求体太大' });
            const ip = String(r.body?.ip ?? '');
            sendJson(res, 200, await this.panel.switchWireless({ ip }));
        }, 'write');
        add('/disconnect', async (_req, res) => sendJson(res, 200, await this.panel.disconnect()), 'write');
        add('/reset', (_req, res) => sendJson(res, 200, this.panel.resetSettings()), 'write');
        add('/diagnostics', async (_req, res) => sendJson(res, 200, await this.panel.getDiagnostics()));
        add('/log', (_req, res) => {
            res.writeHead(200, {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(this.panel.getLog());
        });
        add('/panel.js', (_req, res) => {
            res.writeHead(200, {
                'content-type': 'text/javascript; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(this.panel.readPanelScript(this.token));
        });
        disposers.push(this.registerInjection());
        return () => disposers.forEach(d => d());
    }
    // Wrap a handler with the cross-site protection gates.
    guard(handler, mode) {
        return async (req, res) => {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'access-control-allow-headers': `content-type, ${this.tokenHeader}`,
                    'access-control-allow-methods': 'GET, POST, OPTIONS',
                });
                res.end();
                return;
            }
            const origin = String(req.headers.origin ?? '');
            if (origin) {
                let same = false;
                try {
                    same = new URL(origin).host === String(req.headers.host ?? '');
                }
                catch {
                    same = false;
                }
                if (!same) {
                    res.writeHead(403);
                    res.end();
                    return;
                }
            }
            const isWrite = req.method === 'POST';
            if (mode === 'write' || (mode === 'rw' && isWrite)) {
                if (!isWrite) {
                    res.writeHead(405, { allow: 'POST' });
                    res.end();
                    return;
                }
                if (String(req.headers[this.tokenHeader] ?? '') !== this.token) {
                    res.writeHead(403);
                    res.end();
                    return;
                }
            }
            else if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, { allow: 'GET' });
                res.end();
                return;
            }
            try {
                await handler(req, res);
            }
            catch (e) {
                sendJson(res, 500, {
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        };
    }
    // Inject the panel script both through the host index-inject table and the
    // index HTML tap, covering the two DSH serving paths.
    registerInjection() {
        const src = `${this.base}/panel.js`;
        const offInject = this.web.onIndexInject(table => {
            if (!Array.isArray(table))
                return;
            const already = table.some(r => r &&
                typeof r === 'object' &&
                r.kind === 'script-src' &&
                String(r.src ?? '').startsWith(src));
            if (!already)
                table.push({ kind: 'script-src', placement: 'body', src });
        });
        const offTap = this.web.tapIndex(html => {
            if (typeof html !== 'string' || html.includes(src))
                return html;
            const tag = `<script src="${src}" defer></script>`;
            return html.includes('</body>')
                ? html.replace('</body>', `${tag}</body>`)
                : html + tag;
        });
        return () => {
            offInject();
            offTap();
        };
    }
}
