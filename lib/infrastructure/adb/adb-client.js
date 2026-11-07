import { spawn } from 'node:child_process';
import { DeviceError } from '../../domain/errors.js';
export class AdbClient {
    adbPath;
    serial;
    constructor(adbPath, serial) {
        this.adbPath = adbPath;
        this.serial = serial;
    }
    /**
     * Replace the serial after a wireless reconnect.
     *
     * A phone on `192.168.x.y:5555` comes back with a different address; the
     * serial resolved at plugin load is then dead and every call fails with
     * "device not found" until the harness restarts.
     */
    setSerial(serial) {
        if (serial) {
            this.serial = serial;
        }
    }
    get currentSerial() {
        return this.serial;
    }
    async run(args, timeoutMs = 30000) {
        const result = await this.exec(this.withSerial(args), false, timeoutMs);
        if (result.code !== 0) {
            throw new DeviceError('ADB_FAILED', result.stderr.trim() || `adb ${args.join(' ')} failed`);
        }
        return result.stdout;
    }
    async runBinary(args, timeoutMs = 30000) {
        const result = await this.exec(this.withSerial(args), true, timeoutMs);
        if (result.code !== 0) {
            throw new DeviceError('ADB_FAILED', result.stderr.trim() || `adb binary call failed`);
        }
        return result.stdout;
    }
    async listDevices() {
        const out = await this.run(['devices']);
        return out
            .split(/\r?\n/)
            .slice(1)
            .map(line => line.split('\t')[0].trim())
            .filter(Boolean);
    }
    withSerial(args) {
        return this.serial ? ['-s', this.serial, ...args] : args;
    }
    exec(args, binary, timeoutMs) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.adbPath, args, { windowsHide: true });
            const chunks = [];
            const errChunks = [];
            const timer = setTimeout(() => {
                child.kill();
                reject(new DeviceError('ADB_TIMEOUT', `adb timed out after ${timeoutMs}ms: ${args.join(' ')}`));
            }, timeoutMs);
            child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
            child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)));
            child.on('error', err => {
                clearTimeout(timer);
                reject(new DeviceError('ADB_NOT_STARTABLE', `cannot start adb (${this.adbPath}): ${err.message}`));
            });
            child.on('close', code => {
                clearTimeout(timer);
                const stderr = Buffer.concat(errChunks).toString('utf8');
                if (binary) {
                    resolve({
                        code: code ?? -1,
                        stdout: Buffer.concat(chunks),
                        stderr,
                    });
                }
                else {
                    resolve({
                        code: code ?? -1,
                        stdout: Buffer.concat(chunks).toString('utf8'),
                        stderr,
                    });
                }
            });
        });
    }
}
