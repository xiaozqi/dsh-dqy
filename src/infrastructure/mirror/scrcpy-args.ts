import type { MirrorConfig } from '../../domain/mirror-types.js'
import { MIRROR_WINDOW_TITLE as WINDOW_TITLE } from '../../domain/mirror-defaults.js'

// Pure mapping from mirror config to scrcpy command-line arguments. The
// serial is the actually-online device, which may differ from config.serial
// when a network phone got a new DHCP address.
export function buildScrcpyArgs(
  config: MirrorConfig,
  serial: string,
  title: string = WINDOW_TITLE,
): string[] {
  const args = ['--window-title', title]
  if (!config.audio) args.push('--no-audio')
  if (serial) args.push('--serial', String(serial))
  if (config.windowWidth > 0) {
    args.push('--window-width', String(Math.round(config.windowWidth)))
  }
  if (config.alwaysOnTop) args.push('--always-on-top')
  // --stay-awake would override --turn-screen-off, so it is intentionally absent.
  if (config.turnScreenOff) args.push('--turn-screen-off')
  return args
}
