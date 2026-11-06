import { ProcessSupervisor } from '../process-supervisor.js';
export class ReverseTunnelKeepAlive {
    adbPath;
    serial;
    localPort;
    remotePort;
    checkIntervalMs;
    supervisor;
    lastError = null;
    timer = null;
    inFlight = false;
    constructor(adbPath, serial, localPort = 14123, remotePort = 14123, checkIntervalMs = 60000, supervisor = new ProcessSupervisor()) {
        this.adbPath = adbPath;
        this.serial = serial;
        this.localPort = localPort;
        this.remotePort = remotePort;
        this.checkIntervalMs = checkIntervalMs;
        this.supervisor = supervisor;
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
        // A tick must never overlap the previous one: on a disconnected phone the
        // old code spawned one more adb.exe every minute, forever.
        if (this.inFlight) {
            return;
        }
        this.inFlight = true;
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
        finally {
            this.inFlight = false;
        }
    }
    async runAdb(args) {
        const full = this.serial ? ['-s', this.serial, ...args] : args;
        const result = await this.supervisor.run(this.adbPath, full, {
            timeoutMs: 5000,
        });
        if (result.timedOut) {
            throw new Error(`adb ${args.join(' ')} 超时（5s），进程已被杀掉`);
        }
        if (result.code !== 0) {
            throw new Error(`adb ${args.join(' ')} exited with code ${result.code ?? -1}: ${result.stderr.trim()}`);
        }
        return result.stdout;
    }
}
