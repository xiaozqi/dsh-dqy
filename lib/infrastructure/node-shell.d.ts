import type { ShellPort, ShellResult } from '../domain/ports/shell.port.js';
export declare class NodeShell implements ShellPort {
    run(cmd: string, args: readonly string[], timeoutMs?: number): Promise<ShellResult>;
}
