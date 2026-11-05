import { spawn } from 'node:child_process'
import { DeviceError } from '../../domain/errors.js'

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

interface BinaryExecResult {
  code: number
  stdout: Buffer
  stderr: string
}

export class AdbClient {
  constructor(
    private readonly adbPath: string,
    private readonly serial?: string,
  ) {}

  async run(args: string[], timeoutMs = 30000): Promise<string> {
    const result: ExecResult = await this.exec(
      this.withSerial(args),
      false,
      timeoutMs,
    )
    if (result.code !== 0) {
      throw new DeviceError(
        'ADB_FAILED',
        result.stderr.trim() || `adb ${args.join(' ')} failed`,
      )
    }
    return result.stdout
  }

  async runBinary(args: string[], timeoutMs = 30000): Promise<Buffer> {
    const result: BinaryExecResult = await this.exec(
      this.withSerial(args),
      true,
      timeoutMs,
    )
    if (result.code !== 0) {
      throw new DeviceError(
        'ADB_FAILED',
        result.stderr.trim() || `adb binary call failed`,
      )
    }
    return result.stdout
  }

  async listDevices(): Promise<string[]> {
    const out = await this.run(['devices'])
    return out
      .split(/\r?\n/)
      .slice(1)
      .map(line => line.split('\t')[0].trim())
      .filter(Boolean)
  }

  private withSerial(args: string[]): string[] {
    return this.serial ? ['-s', this.serial, ...args] : args
  }

  private exec(
    args: string[],
    binary: true,
    timeoutMs: number,
  ): Promise<BinaryExecResult>
  private exec(
    args: string[],
    binary: false,
    timeoutMs: number,
  ): Promise<ExecResult>
  private exec(
    args: string[],
    binary: boolean,
    timeoutMs: number,
  ): Promise<ExecResult | BinaryExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, args, { windowsHide: true })
      const chunks: Buffer[] = []
      const errChunks: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill()
        reject(
          new DeviceError(
            'ADB_TIMEOUT',
            `adb timed out after ${timeoutMs}ms: ${args.join(' ')}`,
          ),
        )
      }, timeoutMs)

      child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)))
      child.on('error', err => {
        clearTimeout(timer)
        reject(
          new DeviceError(
            'ADB_NOT_STARTABLE',
            `cannot start adb (${this.adbPath}): ${err.message}`,
          ),
        )
      })
      child.on('close', code => {
        clearTimeout(timer)
        const stderr = Buffer.concat(errChunks).toString('utf8')
        if (binary) {
          resolve({
            code: code ?? -1,
            stdout: Buffer.concat(chunks),
            stderr,
          })
        } else {
          resolve({
            code: code ?? -1,
            stdout: Buffer.concat(chunks).toString('utf8'),
            stderr,
          })
        }
      })
    })
  }
}
