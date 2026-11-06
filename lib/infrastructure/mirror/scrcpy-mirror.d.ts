import type { MirrorConfig, MirrorStatus } from '../../domain/mirror-types.js';
import type { MirrorPort } from '../../domain/ports/mirror.port.js';
export interface ScrcpyMirrorDeps {
    resolveAdb: (configured: string) => string;
    resolveScrcpy: (configured: string) => string;
    onExit: (code: number, byUser: boolean) => void;
}
export declare class ScrcpyMirror implements MirrorPort {
    private readonly deps;
    private session;
    constructor(deps: ScrcpyMirrorDeps);
    launch(config: MirrorConfig, serial: string): Promise<{
        ok: boolean;
        error?: string;
        already?: boolean;
    }>;
    stop(): Promise<{
        ok: boolean;
        already?: boolean;
    }>;
    status(): MirrorStatus;
    private killStrayScrcpy;
}
