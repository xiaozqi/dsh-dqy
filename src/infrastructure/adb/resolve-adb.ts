import { join } from 'node:path'
import { resolveExecutable } from '../resolve-executable.js'

// Resolve a usable adb binary. An explicit absolute path is honoured; the bare
// default 'adb' (or an empty value) triggers discovery across PATH, the Android
// SDK location and the winget package directory.
export function resolveAdbPath(configured: string): string {
  const local = process.env.LOCALAPPDATA || ''
  return resolveExecutable({
    configured,
    command: 'adb',
    wingetPattern: /platform-?tools/i,
    wingetExe: 'adb.exe',
    extraCandidates: local
      ? [join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe')]
      : [],
  })
}
