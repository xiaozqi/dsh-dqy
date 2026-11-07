import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
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
        // Unique temp name per write: a tool call and a scheduler tick saving the
        // same key used to share one `.tmp` file and race the rename into
        // ENOENT/EPERM, losing the state write.
        const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
        try {
            writeFileSync(tmp, JSON.stringify(value), 'utf8');
            renameSync(tmp, path);
        }
        catch (err) {
            // State is best-effort: a full or locked disk must not throw from inside
            // a tool call, and the previous file is still intact.
            console.warn(`[state] failed to persist "${key}": ${err.message}`);
            try {
                rmSync(tmp, { force: true });
            }
            catch {
                // nothing else to clean up
            }
        }
    }
    pathFor(key) {
        return resolve(this.dir, fileName(key));
    }
}
