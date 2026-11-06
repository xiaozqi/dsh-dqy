export interface ShellResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface ShellPort {
    run(cmd: string, args: readonly string[], timeoutMs?: number): Promise<ShellResult>;
}
