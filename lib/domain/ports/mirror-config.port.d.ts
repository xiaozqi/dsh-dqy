import type { MirrorConfig } from '../mirror-types.js';
export interface MirrorConfigStore {
    load(): MirrorConfig;
    save(config: MirrorConfig): boolean;
}
