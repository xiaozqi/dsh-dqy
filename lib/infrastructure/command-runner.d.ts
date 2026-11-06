export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export declare function runCommand(cmd: string, args: readonly string[], timeoutMs?: number): Promise<CommandResult>;
