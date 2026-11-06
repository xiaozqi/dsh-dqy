import type { MirrorConfig, MirrorStatus } from '../mirror-types.js'

// Process-level mirroring capability. The caller (application service) has
// already resolved an online serial; the adapter only manages the scrcpy
// process and reports its state.
export interface MirrorPort {
  // Spawn scrcpy for the given serial using the supplied config.
  launch(
    config: MirrorConfig,
    serial: string,
  ): Promise<{ ok: boolean; error?: string; already?: boolean }>
  // Terminate the current process.
  stop(): Promise<{ ok: boolean; already?: boolean }>
  // Current process snapshot.
  status(): MirrorStatus
}
