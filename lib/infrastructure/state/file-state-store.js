import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from 'node:fs';
import { resolve } from 'node:path';
function fileName(key) {
    const safe = key.replace(/[^a-z0-9_-]+/gi, '_');
    return `${safe}.json`;
}
// Synchronous JSON store. Writes go through a temp file + rename so a crash
// mid-write can never leave a truncated state file that breaks startup.
export class FileStateStore {
    dir;
    constructor(dir) {
        this.dir = dir;
        mkdirSync(this.dir, { recursive: true });
    }
    load(key, fallback) {
        const path = this.pathFor(key);
        if (!existsSync(path)) {
            return fallback;
        }
        try {
            return JSON.parse(readFileSync(path, 'utf8'));
        }
        catch {
            // Corrupt state must not take the plugin down; start from the fallback.
            return fallback;
        }
    }
    save(key, value) {
        const path = this.pathFor(key);
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(value), 'utf8');
        renameSync(tmp, path);
    }
    pathFor(key) {
        return resolve(this.dir, fileName(key));
    }
}
