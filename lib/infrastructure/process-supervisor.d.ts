import { type ChildProcess, type StdioOptions } from 'node:child_process';
export interface ProcessRunOptions {
    /** Deadline after which the whole child tree is killed. */
    timeoutMs?: number;
    /** Captured output limit per stream; overflow is dropped, not buffered. */
    maxBytes?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: StdioOptions;
}
export interface ProcessRunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
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
export declare class ProcessSupervisor {
    private readonly children;
    /** Start a long-lived child (logcat, tunnel, mirror) and keep it tracked. */
    spawn(cmd: string, args: string[], options?: ProcessRunOptions): ChildProcess;
    /** Run a short-lived child to completion with a deadline. */
    run(cmd: string, args: string[], options?: ProcessRunOptions): Promise<ProcessRunResult>;
    /** Kill every tracked child; called from the plugin's dispose effect. */
    killAll(): void;
    get size(): number;
    private track;
}
