import type {
  ShellPort,
  ShellResult,
} from '../domain/ports/shell.port.js'
import { runCommand } from './command-runner.js'

// ShellPort adapter backed by the local process runner.
export class NodeShell implements ShellPort {
  async run(
    cmd: string,
    args: readonly string[],
    timeoutMs = 8000,
  ): Promise<ShellResult> {
    return runCommand(cmd, args, timeoutMs)
  }
}
