import type { MirrorState } from '../../domain/mirror-types.js';
export interface SessionDeps {
    scrcpy: string;
    args: string[];
    graceMs: number;
    onExit: (code: number, byUser: boolean) => void;
}
export declare class ScrcpySession {
    private readonly deps;
    private proc;
    private graceTimer;
    private exitTimer;
    private state;
    private error;
    private since;
    private stderrTail;
    constructor(deps: SessionDeps);
    start(): {
        ok: boolean;
        error?: string;
        already?: boolean;
    };
    private handleExit;
    stop(): {
        ok: boolean;
        already?: boolean;
    };
    getState(): MirrorState;
    getSince(): number;
    getError(): string;
    private tail;
}
