import { runCommand } from './command-runner.js';
// ShellPort adapter backed by the local process runner.
export class NodeShell {
    async run(cmd, args, timeoutMs = 8000) {
        return runCommand(cmd, args, timeoutMs);
    }
}
