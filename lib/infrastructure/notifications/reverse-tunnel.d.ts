import { ProcessSupervisor } from '../process-supervisor.js';
export declare class ReverseTunnelKeepAlive {
    private readonly adbPath;
    private readonly serial;
    private readonly localPort;
    private readonly remotePort;
    private readonly checkIntervalMs;
    private readonly supervisor;
    lastError: string | null;
    private timer;
    private inFlight;
    constructor(adbPath: string, serial: string, localPort?: number, remotePort?: number, checkIntervalMs?: number, supervisor?: ProcessSupervisor);
    start(): Promise<void>;
    stop(): void;
    private ensureRule;
    private runAdb;
}
