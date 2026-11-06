import type { DependencyInfo, DeviceInfo, MirrorConfig, PhoneStateInfo, UnlockOutcome } from '../../domain/mirror-types.js';
import type { MirrorConfigStore } from '../../domain/ports/mirror-config.port.js';
import type { MirrorPort } from '../../domain/ports/mirror.port.js';
import type { ShellPort } from '../../domain/ports/shell.port.js';
export interface MirrorPanelDeps {
    configStore: MirrorConfigStore;
    mirror: MirrorPort;
    shell: ShellPort;
    resolveAdb: (configured: string) => string;
    resolveScrcpy: (configured: string) => string;
    pluginVersion: string;
    logPath: string;
    panelAssetPath: string;
    logger: (msg: string) => void;
}
export declare class MirrorPanelService {
    private readonly deps;
    private cmdCache;
    private verCache;
    private phoneCache;
    private activeSerial;
    private activeAt;
    private lastPick;
    private deviceModel;
    private modelProbing;
    private lastAdbOkAt;
    private retryTimer;
    private retries;
    private installingDep;
    constructor(deps: MirrorPanelDeps);
    handleExit(code: number, byUser: boolean): void;
    private scheduleReconnect;
    private clearRetry;
    private resolveCommands;
    private resolveSerial;
    private ensureModel;
    private versions;
    getStatus(): Record<string, unknown>;
    getPhoneState(): Promise<PhoneStateInfo>;
    private publicConfig;
    getConfig(): {
        ok: boolean;
        config: MirrorConfig;
        defaults: MirrorConfig;
    };
    updateConfig(patch: Record<string, unknown>): {
        ok: boolean;
        config?: MirrorConfig;
        error?: string;
    };
    private invalidateCaches;
    listDevices(): Promise<{
        ok: boolean;
        devices: DeviceInfo[];
        adb: string;
    }>;
    private hasWinget;
    getDeps(): Promise<DependencyInfo>;
    installDep(what: string): Promise<{
        ok: boolean;
        found?: boolean;
        error?: string;
        output?: string;
    }>;
    start(): Promise<{
        ok: boolean;
        already?: boolean;
        needPick?: boolean;
        devices?: {
            serial: string;
            model: string;
        }[];
        error?: string;
    }>;
    stop(): Promise<{
        ok: boolean;
        already?: boolean;
    }>;
    pressKey(code: number): Promise<{
        ok: boolean;
        error?: string;
    }>;
    private waitIdle;
    setTopmost(on: boolean): Promise<{
        ok: boolean;
        alwaysOnTop?: boolean;
        restarted?: boolean;
        error?: string;
    }>;
    unlock(): Promise<UnlockOutcome>;
    lock(): Promise<{
        ok: boolean;
        locked?: boolean | null;
        awake?: boolean | null;
        error?: string;
    }>;
    switchWireless(body: {
        ip?: string;
    }): Promise<{
        ok: boolean;
        serial?: string;
        ip?: string;
        needIp?: boolean;
        needPick?: boolean;
        restarted?: boolean;
        error?: string;
    }>;
    disconnect(): Promise<{
        ok: boolean;
    }>;
    resetSettings(): {
        ok: boolean;
        config: MirrorConfig;
    };
    getDiagnostics(): Promise<{
        ok: boolean;
        text: string;
    }>;
    getLog(): string;
    readPanelScript(token: string): string;
}
