export type MirrorState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

// Full writable mirror configuration backing the control panel.
export interface MirrorConfig {
  // adb serial; for a network device this is host:port.
  serial: string
  // Explicit adb path; empty means auto-discovery.
  adb: string
  // Explicit scrcpy path; empty means auto-discovery.
  scrcpy: string
  // Start mirroring automatically when the plugin loads.
  autoStart: boolean
  // Keep the scrcpy window above other windows.
  alwaysOnTop: boolean
  // Window content width in physical pixels.
  windowWidth: number
  // Turn the physical phone screen off while mirroring.
  turnScreenOff: boolean
  // Forward audio together with video.
  audio: boolean
  // A scrcpy process surviving this long counts as started.
  graceMs: number
  // Reconnect automatically after an unexpected exit.
  reconnect: boolean
  // Lock-screen PIN, 4-12 digits; empty means ask when needed.
  pin: string
}

// A device row reported by `adb devices -l`.
export interface DeviceInfo {
  serial: string
  state: string
  model: string
}

// Keyguard / screen state of the connected phone. Null fields mean the
// device did not provide a recognisable signal, so the caller must not guess.
export interface PhoneStateInfo {
  ok: boolean
  locked: boolean | null
  awake: boolean | null
  secure: boolean | null
  supported: boolean
  error?: string
}

export interface DependencyStatus {
  found: boolean
  path: string
  version: string
}

// External dependency availability for the setup drawer.
export interface DependencyInfo {
  ok: boolean
  adb: DependencyStatus
  scrcpy: DependencyStatus
  winget: boolean
  installing: string
  plugin: string
}

// Outcome of the one-tap unlock flow.
export interface UnlockOutcome {
  ok: boolean
  steps: string[]
  locked?: boolean | null
  awake?: boolean | null
  already?: boolean
  needPin?: boolean
  unsupported?: boolean
  error?: string
}

// Snapshot consumed by the panel for rendering switches and state.
export interface MirrorOptions {
  serial: string
  alwaysOnTop: boolean
  windowWidth: number
  turnScreenOff: boolean
  audio: boolean
}

export interface MirrorStatus {
  state: MirrorState
  running: boolean
  busy: boolean
  error: string
  // Epoch ms when the current session started.
  since: number
  serial: string
  scrcpy: string
}
