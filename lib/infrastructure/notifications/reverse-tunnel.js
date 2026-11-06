import { spawn } from 'node:child_process';
export class ReverseTunnelKeepAlive {
    adbPath;
    serial;
    localPort;
    remotePort;
    checkIntervalMs;
    lastError = null;
    timer = null;
    constructor(adbPath, serial, localPort = 14123, remotePort = 14123, checkIntervalMs = 60000) {
        this.adbPath = adbPath;
        this.serial = serial;
        this.localPort = localPort;
        this.remotePort = remotePort;
        this.checkIntervalMs = checkIntervalMs;
    }
    async start() {
        if (this.timer) {
            return;
        }
        await this.ensureRule();
        this.timer = setInterval(() => {
            void this.ensureRule();
        }, this.checkIntervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async ensureRule() {
        try {
            const list = await this.runAdb(['reverse', '--list']);
            if (list.includes(`tcp:${this.localPort}`)) {
                return;
            }
            await this.runAdb([
                'reverse',
                `tcp:${this.localPort}`,
                `tcp:${this.remotePort}`,
            ]);
            this.lastError = null;
        }
        catch (err) {
            this.lastError = err.message;
        }
    }
    runAdb(args) {
        return new Promise((resolve, reject) => {
            const full = this.serial ? ['-s', this.serial, ...args] : args;
            const child = spawn(this.adbPath, full, { windowsHide: true });
            const chunks = [];
            child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
            child.on('error', err => {
                reject(err);
            });
            child.on('close', code => {
                const out = Buffer.concat(chunks).toString('utf8');
                if (code !== 0) {
                    reject(new Error(`adb ${args.join(' ')} exited with code ${code ?? -1}`));
                }
                else {
                    resolve(out);
                }
            });
        });
    }
}
