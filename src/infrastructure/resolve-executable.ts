import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const IS_WINDOWS = process.platform === 'win32'
const PATH_SEPARATOR = IS_WINDOWS ? ';' : ':'

export interface ExecutableDiscovery {
  // Value from config; an explicit absolute path is honoured when it exists.
  configured: string
  // Bare command name used for PATH lookup and for the final fallback.
  command: string
  // winget package directory matcher; omitted to skip winget discovery.
  wingetPattern?: RegExp
  // Binary file name inside a winget package (e.g. adb.exe, scrcpy.exe).
  wingetExe?: string
  // Additional fixed candidate paths (e.g. the Android SDK location).
  extraCandidates?: string[]
}

// Locate a command on PATH. On Windows this also tries the PATHEXT extensions;
// elsewhere the executable name is used as-is.
function which(cmd: string): string {
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : ['']
  for (const dir of (process.env.PATH || '')
    .split(PATH_SEPARATOR)
    .filter(Boolean)) {
    for (const ext of exts) {
      const file = join(dir, IS_WINDOWS ? cmd + ext.toLowerCase() : cmd)
      if (existsSync(file)) return file
    }
  }
  return ''
}

// Search packages installed through the Windows Package Manager, which keeps
// binaries outside PATH under LOCALAPPDATA/Microsoft/WinGet/Packages.
function wingetFind(pattern: RegExp, exe: string): string {
  const local = process.env.LOCALAPPDATA || ''
  const root = local ? join(local, 'Microsoft', 'WinGet', 'Packages') : ''
  if (!root) return ''
  try {
    for (const name of readdirSync(root)) {
      if (!pattern.test(name)) continue
      const pkgDir = join(root, name)
      for (const sub of readdirSync(pkgDir)) {
        const candidate = join(pkgDir, sub, exe)
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {
    return ''
  }
  return ''
}

// Resolve a usable external command. Every candidate is verified with
// existsSync; the bare command name is returned last so spawn reports a clear
// error when nothing is installed.
export function resolveExecutable(discovery: ExecutableDiscovery): string {
  const {
    configured,
    command,
    wingetPattern,
    wingetExe,
    extraCandidates = [],
  } = discovery
  const trimmed = configured.trim()
  if (trimmed && trimmed !== command && existsSync(trimmed)) {
    return trimmed
  }
  const candidates = [
    which(command),
    ...extraCandidates,
    wingetPattern && wingetExe ? wingetFind(wingetPattern, wingetExe) : '',
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return command
}
