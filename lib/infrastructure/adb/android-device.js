import { mkdirSync, readdirSync, rmSync, writeFileSync, } from 'node:fs';
import { join } from 'node:path';
import { DeviceError, UiNotFoundError } from '../../domain/errors.js';
import { matches, } from '../../domain/ports/ui-driver.port.js';
import { parseUiDump } from './ui-dump-parser.js';
const KEY_CODES = {
    back: 4,
    home: 3,
    recents: 187,
    enter: 66,
};
const ADB_KEYBOARD_IME = 'com.android.adbkeyboard/.AdbIME';
const REMOTE_DUMP_PATH = '/sdcard/blue-fat-fish-dump.xml';
const MAX_CAPTURES = 5;
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function encodeInput(text) {
    return text
        .replace(/%/g, '%25')
        .replace(/ /g, '%s')
        .replace(/"/g, '\\"')
        .replace(/&/g, '\\&')
        .replace(/</g, '\\<')
        .replace(/>/g, '\\>')
        .replace(/;/g, '\\;')
        .replace(/\|/g, '\\|');
}
export class AndroidDevice {
    adb;
    captureDir;
    kind = 'adb';
    cachedSize = null;
    constructor(adb, captureDir) {
        this.adb = adb;
        this.captureDir = captureDir;
        mkdirSync(captureDir, { recursive: true });
    }
    async connect() {
        const devices = await this.adb.listDevices();
        if (devices.length === 0) {
            throw new DeviceError('NO_DEVICE', 'no android device found; connect the phone and enable USB debugging');
        }
    }
    async isConnected() {
        try {
            const devices = await this.adb.listDevices();
            return devices.length > 0;
        }
        catch {
            return false;
        }
    }
    async screenSize() {
        if (this.cachedSize)
            return this.cachedSize;
        const out = await this.adb.run(['shell', 'wm', 'size']);
        const m = out.match(/(\d+)x(\d+)/);
        if (!m)
            throw new DeviceError('BAD_SCREEN_SIZE', out);
        this.cachedSize = { width: Number(m[1]), height: Number(m[2]) };
        return this.cachedSize;
    }
    async foregroundApp() {
        const out = await this.adb.run([
            'shell',
            'dumpsys',
            'activity',
            'activities',
        ]);
        const resumed = out.match(/mResumedActivity[^\n]*?([a-zA-Z][\w.]*)\//);
        if (resumed)
            return resumed[1];
        const focus = out.match(/mCurrentFocus[^\n]*?([a-zA-Z][\w.]*)\//);
        if (focus)
            return focus[1];
        return 'unknown';
    }
    async tap(point) {
        await this.adb.run([
            'shell',
            'input',
            'tap',
            String(point.x),
            String(point.y),
        ]);
    }
    async longPress(point, durationMs) {
        await this.adb.run([
            'shell',
            'input',
            'swipe',
            String(point.x),
            String(point.y),
            String(point.x),
            String(point.y),
            String(durationMs),
        ]);
    }
    async swipe(from, to, durationMs) {
        await this.adb.run([
            'shell',
            'input',
            'swipe',
            String(from.x),
            String(from.y),
            String(to.x),
            String(to.y),
            String(durationMs),
        ]);
    }
    async inputText(text) {
        await this.adb.run(['shell', 'input', 'text', encodeInput(text)]);
    }
    // Chinese / non-ASCII injection via the ADBKeyBoard input method: switch
    // to it, broadcast the text into the focused field, then always restore
    // the previously active IME so the user's keyboard is untouched.
    async inputChinese(text) {
        const previous = (await this.adb.run([
            'shell',
            'settings',
            'get',
            'secure',
            'default_input_method',
        ])).trim();
        try {
            await this.adb.run(['shell', 'ime', 'enable', ADB_KEYBOARD_IME]);
            await this.adb.run(['shell', 'ime', 'set', ADB_KEYBOARD_IME]);
            // Some OEMs (Huawei EMUI) switch IMEs slowly; the input broadcast is
            // silently dropped if the keyboard is not yet active. Poll until the
            // active IME is really ADBKeyBoard before injecting anything.
            let ready = false;
            for (let i = 0; i < 16; i++) {
                const active = (await this.adb.run([
                    'shell',
                    'settings',
                    'get',
                    'secure',
                    'default_input_method',
                ])).trim();
                if (active === ADB_KEYBOARD_IME) {
                    ready = true;
                    break;
                }
                await delay(300);
            }
            if (!ready) {
                throw new Error(`inputChinese: ADBKeyBoard IME did not activate within 5s (active=${previous || 'none'})`);
            }
            await delay(400);
            // Wipe any restored draft first so we replace, not append.
            await this.adb.run(['shell', 'am', 'broadcast', '-a', 'ADB_CLEAR_TEXT']);
            await delay(400);
            await this.adb.run([
                'shell',
                'am',
                'broadcast',
                '-a',
                'ADB_INPUT_TEXT',
                '--es',
                'msg',
                text,
            ]);
            await delay(500);
        }
        finally {
            if (previous && previous !== ADB_KEYBOARD_IME) {
                await this.adb.run(['shell', 'ime', 'set', previous]);
            }
        }
    }
    async pressKey(key) {
        const code = KEY_CODES[key];
        await this.adb.run(['shell', 'input', 'keyevent', String(code)]);
    }
    async openApp(packageName) {
        await this.adb.run([
            'shell',
            'monkey',
            '-p',
            packageName,
            '-c',
            'android.intent.category.LAUNCHER',
            '1',
        ]);
    }
    async observe() {
        const size = await this.screenSize();
        const foreground = await this.foregroundApp();
        const png = await this.adb.runBinary(['exec-out', 'screencap', '-p']);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = join(this.captureDir, `screen-${stamp}.png`);
        writeFileSync(screenshotPath, png);
        this.pruneCaptures();
        await this.adb.run([
            'shell',
            'uiautomator',
            'dump',
            REMOTE_DUMP_PATH,
        ]);
        const xml = await this.adb.runBinary([
            'exec-out',
            'cat',
            REMOTE_DUMP_PATH,
        ]);
        const roots = parseUiDump(xml.toString('utf8'));
        return {
            screenshotPath,
            foregroundApp: foreground,
            screenSize: size,
            roots,
            capturedAt: new Date().toISOString(),
        };
    }
    async findText(text) {
        const observation = await this.observe();
        const found = this.search(observation.roots, node => node.text.includes(text) || node.resourceId.includes(text));
        if (!found)
            return null;
        return {
            x: Math.round((found.bounds.left + found.bounds.right) / 2),
            y: Math.round((found.bounds.top + found.bounds.bottom) / 2),
        };
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
        await this.tap({
            x: Math.round((found.bounds.left + found.bounds.right) / 2),
            y: Math.round((found.bounds.top + found.bounds.bottom) / 2),
        });
        return found;
    }
    async pushFile(localPath, remotePath) {
        await this.adb.run(['push', localPath, remotePath]);
    }
    async pullFile(remotePath, localPath) {
        await this.adb.run(['pull', remotePath, localPath]);
    }
    async playAudio(remotePath) {
        const encoded = remotePath.replace(/ /g, '%20');
        await this.adb.run([
            'shell',
            'am',
            'start',
            '-a',
            'android.intent.action.VIEW',
            '-d',
            `file://${encoded}`,
            '-t',
            'audio/*',
        ]);
    }
    async recordAudio(durationMs, remotePath) {
        const seconds = Math.max(1, Math.ceil(durationMs / 1000));
        await this.adb.run([
            'shell',
            'screenrecord',
            '--time-limit',
            String(seconds),
            '--microphone',
            remotePath,
        ]);
    }
    search(nodes, predicate) {
        for (const node of nodes) {
            if (predicate(node))
                return node;
            const hit = this.search(node.children, predicate);
            if (hit)
                return hit;
        }
        return null;
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
