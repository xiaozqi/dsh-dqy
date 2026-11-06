import type { MirrorConfig } from '../mirror-types.js'

// Persistent, writable mirror configuration. Implementations own the
// sanitisation and storage details; callers only see a valid config.
export interface MirrorConfigStore {
  load(): MirrorConfig
  save(config: MirrorConfig): boolean
}
