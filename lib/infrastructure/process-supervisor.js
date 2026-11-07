import { spawn } from 'node:child_process';
const DEFAULT_MAX_BYTES = 64 * 1024;
function killTree(pid) {
    if (!pid) {
        return;
    }
    if (process.platform === 'win32') {
        // Detached so the killer itself is not tied to the child's tree.
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            detached: true,
        }).unref();
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    }
    catch {
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch {
            // already gone
        }
    }
}
/**
 * Owns every child process the plugin starts.
 *
 * A spawned adb/python/scrcpy child that is never drained or killed is how a
 * plugin wedges: stderr fills a pipe the child keeps writing to, `close` never
 * fires, and the promise that awaits it never settles. Everything here has a
 * deadline, drains both streams, and is tracked so `dispose()` can kill the
 * whole tree when the plugin unloads.
 */
export class ProcessSupervisor {
    children = new Set();
    /** Start a long-lived child (logcat, tunnel, mirror) and keep it tracked. */
    spawn(cmd, args, options = {}) {
        const child = spawn(cmd, args, {
            cwd: options.cwd,
            env: options.env ?? {
                ...process.env,
                // Python on Windows picks the ANSI code page for piped stdout, which
                // turns every Chinese UI string into replacement characters and makes
                // Chinese input verification fail on text that was actually correct.
                PYTHONUTF8: '1',
                PYTHONIOENCODING: 'utf-8',
            },
            windowsHide: true,
            stdio: options.stdio ?? 'ignore',
            detached: process.platform !== 'win32',
        });
        this.track(child);
        return child;
    }
    /** Run a short-lived child to completion with a deadline. */
    run(cmd, args, options = {}) {
        const timeoutMs = options.timeoutMs ?? 30_000;
        const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        return new Promise(resolve => {
            const child = spawn(cmd, args, {
                cwd: options.cwd,
                env: options.env ?? {
                    ...process.env,
                    // Python on Windows picks the ANSI code page for piped stdout, which
                    // turns every Chinese UI string into replacement characters and makes
                    // Chinese input verification fail on text that was actually correct.
                    PYTHONUTF8: '1',
                    PYTHONIOENCODING: 'utf-8',
                },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
            });
            this.track(child);
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let settled = false;
            const finish = (code) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                this.children.delete(child);
                resolve({ code, stdout, stderr, timedOut });
            };
            const timer = setTimeout(() => {
                timedOut = true;
                killTree(child.pid);
                // Do not wait for a `close` that a half-dead child may never emit.
                finish(null);
            }, timeoutMs);
            timer.unref?.();
            child.stdout?.on('data', (chunk) => {
                if (stdout.length < maxBytes) {
                    stdout += chunk.toString('utf8');
                }
            });
            child.stderr?.on('data', (chunk) => {
                if (stderr.length < maxBytes) {
                    stderr += chunk.toString('utf8');
                }
            });
            child.on('error', () => finish(null));
            child.on('close', code => finish(code));
        });
    }
    /** Kill every tracked child; called from the plugin's dispose effect. */
    killAll() {
        for (const child of this.children) {
            killTree(child.pid);
            try {
                child.kill();
            }
            catch {
                // already gone
            }
        }
        this.children.clear();
    }
    get size() {
        return this.children.size;
    }
    track(child) {
        this.children.add(child);
        child.on('close', () => this.children.delete(child));
        child.on('error', () => this.children.delete(child));
        // A long-lived child can still fill its stderr pipe; drain it so the child
        // never blocks on a write nobody reads.
        if (child.stderr && typeof child.stderr.on === 'function') {
            child.stderr.on('data', () => undefined);
        }
    }
}
