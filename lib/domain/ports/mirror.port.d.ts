import type { MirrorConfig, MirrorStatus } from '../mirror-types.js';
export interface MirrorPort {
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
}
