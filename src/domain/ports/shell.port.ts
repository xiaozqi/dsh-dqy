export interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

// Abstraction over external process execution. Implementations never reject:
// start failures and timeouts are folded into a non-zero code so application
// logic branches only on the result.
export interface ShellPort {
  run(
    cmd: string,
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<ShellResult>
}
