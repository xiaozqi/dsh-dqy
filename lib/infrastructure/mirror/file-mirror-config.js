import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, } from 'node:fs';
import { dirname } from 'node:path';
import { MIRROR_DEFAULTS } from '../../domain/mirror-defaults.js';
const STRING_KEYS = new Set(['serial', 'adb', 'scrcpy', 'pin']);
const BOOL_KEYS = new Set([
    'autoStart',
    'alwaysOnTop',
    'turnScreenOff',
    'reconnect',
    'audio',
]);
const INT_KEYS = new Set(['windowWidth', 'graceMs']);
// Converge arbitrary input into a valid config; unknown fields are dropped.
export function sanitizeMirrorConfig(input, base = MIRROR_DEFAULTS) {
    const raw = input && typeof input === 'object' ? input : {};
    const cfg = { ...base };
    for (const key of Object.keys(base)) {
        if (!(key in raw))
            continue;
        const value = raw[key];
        if (STRING_KEYS.has(key)) {
            cfg[key] = String(value ?? '').trim();
        }
        else if (BOOL_KEYS.has(key)) {
            cfg[key] = Boolean(value);
        }
        else if (INT_KEYS.has(key)) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) {
                // INT_KEYS only contains numeric MirrorConfig fields.
                cfg[key] = Math.round(n);
            }
        }
    }
    if (cfg.windowWidth < 120)
        cfg.windowWidth = base.windowWidth;
    if (cfg.windowWidth > 2000)
        cfg.windowWidth = 2000;
    if (cfg.graceMs < 200)
        cfg.graceMs = base.graceMs;
    if (cfg.pin !== '' && !/^\d{4,12}$/.test(cfg.pin))
        cfg.pin = base.pin;
    return cfg;
}
// File-backed config store with mtime-based hot reload. Writes go through a
// temp file + rename so a crash mid-write cannot corrupt the config.
export class FileMirrorConfigStore {
    path;
    cached;
    mtimeMs = 0;
    constructor(path, initial) {
        this.path = path;
        this.cached = sanitizeMirrorConfig(initial, initial);
        this.cached = this.readFromDisk();
    }
    load() {
        this.reloadIfChanged();
        return { ...this.cached };
    }
    save(config) {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const clean = sanitizeMirrorConfig(config, this.cached);
            const tmp = `${this.path}.tmp`;
            writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
            renameSync(tmp, this.path);
            this.cached = clean;
            this.mtimeMs = this.currentMtime();
            return true;
        }
        catch {
            return false;
        }
    }
    readFromDisk() {
        if (!existsSync(this.path))
            return this.cached;
        try {
            const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
            this.cached = sanitizeMirrorConfig(parsed, this.cached);
            this.mtimeMs = this.currentMtime();
        }
        catch {
            /* keep current config on corrupt file */
        }
        return { ...this.cached };
    }
    reloadIfChanged() {
        const m = this.currentMtime();
        if (m === this.mtimeMs)
            return;
        this.readFromDisk();
    }
    currentMtime() {
        try {
            return statSync(this.path).mtimeMs;
        }
        catch {
            return 0;
        }
    }
}
