import type { MirrorConfig } from './mirror-types.js'

// Title used for scrcpy windows and stray-process matching. Shared by the
// application rules and the infrastructure adapters.
export const MIRROR_WINDOW_TITLE = '手机投屏'

// Baseline mirror configuration. File stores and the reset action both derive
// from this single source of defaults.
export const MIRROR_DEFAULTS: MirrorConfig = {
  serial: '',
  adb: '',
  scrcpy: '',
  autoStart: false,
  alwaysOnTop: true,
  windowWidth: 460,
  turnScreenOff: true,
  audio: false,
  graceMs: 1200,
  reconnect: true,
  pin: '',
}
