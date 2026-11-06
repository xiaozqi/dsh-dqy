import type { MirrorConfig } from '../../domain/mirror-types.js';
import type { MirrorConfigStore } from '../../domain/ports/mirror-config.port.js';
export declare function sanitizeMirrorConfig(input: unknown, base?: MirrorConfig): MirrorConfig;
export declare class FileMirrorConfigStore implements MirrorConfigStore {
    private readonly path;
    private cached;
    private mtimeMs;
    constructor(path: string, initial: MirrorConfig);
    load(): MirrorConfig;
    save(config: MirrorConfig): boolean;
    private readFromDisk;
    private reloadIfChanged;
    private currentMtime;
}
