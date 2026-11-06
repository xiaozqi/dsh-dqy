import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CapabilityNotImplementedError, DeviceError, DriverUnavailableError, UiNotFoundError, } from '../../domain/errors.js';
import { center, matches, } from '../../domain/ports/ui-driver.port.js';
import { parseUiDump } from '../adb/ui-dump-parser.js';
const MAX_CAPTURES = 5;
/**
 * UI driver backed by a single-shot python uiautomator2 worker.
 * When the worker cannot start, cannot import uiautomator2, or cannot
 * reach the device, calls throw DriverUnavailableError('U2_UNAVAILABLE')
 * so the caller can degrade to the fallback chain instead of crashing.
 */
export class Uiautomator2Driver {
    pythonPath;
    workerPath;
    adbPath;
    serial;
    captureDir;
    kind = 'uiautomator2';
    constructor(pythonPath, workerPath, adbPath, serial, captureDir) {
        this.pythonPath = pythonPath;
        this.workerPath = workerPath;
        this.adbPath = adbPath;
        this.serial = serial;
        this.captureDir = captureDir;
        mkdirSync(captureDir, { recursive: true });
    }
    async connect() {
        await this.call({ mode: 'ping' });
    }
    async isConnected() {
        try {
            await this.call({ mode: 'ping' });
            return true;
        }
        catch {
            return false;
        }
    }
    async screenSize() {
        const data = (await this.call({ mode: 'screen_size' }));
        return { width: data.width, height: data.height };
    }
    async foregroundApp() {
        return (await this.call({ mode: 'foreground' }));
    }
    async tap(point) {
        await this.call({ mode: 'tap', x: point.x, y: point.y });
    }
    async longPress(point, durationMs) {
        await this.call({
            mode: 'long_press',
            x: point.x,
            y: point.y,
            durationMs,
        });
    }
    async swipe(from, to, durationMs) {
        await this.call({
            mode: 'swipe',
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            durationMs,
        });
    }
    async inputText(text) {
        await this.call({ mode: 'input_text', text });
    }
    async inputChinese(_text) {
        throw new CapabilityNotImplementedError('NOT_SUPPORTED', 'uiautomator2 driver does not implement inputChinese; use the adb fallback');
    }
    async pressKey(key) {
        await this.call({ mode: 'press_key', key });
    }
    async openApp(packageName) {
        await this.call({ mode: 'open_app', packageName });
    }
    async observe() {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const pngPath = join(this.captureDir, `screen-${stamp}.png`);
        const data = (await this.call({
            mode: 'observe',
            pngPath,
        }));
        this.pruneCaptures();
        return {
            screenshotPath: pngPath,
            foregroundApp: data.foreground,
            screenSize: {
                width: data.screenSize.width,
                height: data.screenSize.height,
            },
            roots: parseUiDump(data.xml),
            capturedAt: new Date().toISOString(),
        };
    }
    async findText(text) {
        const observation = await this.observe();
        const found = findNode(observation.roots, node => node.text.includes(text) || node.resourceId.includes(text));
        return found ? center(found) : null;
    }
    async findNodes(matcher) {
        const observation = await this.observe();
        const hits = [];
        const walk = (nodes) => {
            for (const node of nodes) {
                if (matches(node, matcher))
                    hits.push(node);
                walk(node.children);
            }
        };
        walk(observation.roots);
        return hits;
    }
    async tapControl(matcher, _templateHint) {
        const nodes = await this.findNodes(matcher);
        if (nodes.length === 0) {
            throw new UiNotFoundError('UI_NOT_FOUND', `no ui node matched ${JSON.stringify(matcher)}`);
        }
        const found = nodes[0];
        await this.tap(center(found));
        return found;
    }
    async pushFile(localPath, remotePath) {
        await this.call({ mode: 'push', local: localPath, remote: remotePath });
    }
    async pullFile(remotePath, localPath) {
        await this.call({ mode: 'pull', remote: remotePath, local: localPath });
    }
    async playAudio(_remotePath) {
        throw new CapabilityNotImplementedError('NOT_SUPPORTED', 'uiautomator2 driver does not implement playAudio');
    }
    async recordAudio(_durationMs, _remotePath) {
        throw new CapabilityNotImplementedError('NOT_SUPPORTED', 'uiautomator2 driver does not implement recordAudio');
    }
    call(command) {
        const payload = {
            ...command,
            adb: this.adbPath,
            serial: this.serial,
        };
        return new Promise((resolve, reject) => {
            const child = spawn(this.pythonPath, [this.workerPath, JSON.stringify(payload)], { windowsHide: true });
            const outChunks = [];
            const errChunks = [];
            child.stdout.on('data', chunk => outChunks.push(Buffer.from(chunk)));
            child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)));
            child.on('error', err => {
                reject(new DriverUnavailableError('U2_UNAVAILABLE', `cannot start python worker: ${err.message}`));
            });
            child.on('close', code => {
                const raw = Buffer.concat(outChunks).toString('utf8');
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
                    reject(new DeviceError('U2_BAD_JSON', Buffer.concat(errChunks).toString('utf8') ||
                        raw ||
                        `worker exit ${code}`));
                    return;
                }
                const message = parsed.error || `worker exit ${code}`;
                if (parsed.unavailable) {
                    reject(new DriverUnavailableError('U2_UNAVAILABLE', message));
                    return;
                }
                if (!parsed.ok) {
                    reject(new DeviceError('U2_OP_FAILED', message));
                    return;
                }
                resolve(parsed.data);
            });
        });
    }
    pruneCaptures() {
        const files = readdirSync(this.captureDir)
            .filter(f => f.startsWith('screen-') && f.endsWith('.png'))
            .sort();
        const stale = files.slice(0, Math.max(0, files.length - MAX_CAPTURES));
        for (const f of stale) {
            rmSync(join(this.captureDir, f), { force: true });
        }
    }
}
function findNode(nodes, predicate) {
    for (const node of nodes) {
        if (predicate(node))
            return node;
        const hit = findNode(node.children, predicate);
        if (hit)
            return hit;
    }
    return null;
}
