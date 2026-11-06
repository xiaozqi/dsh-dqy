export type MirrorState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export interface MirrorConfig {
    serial: string;
    adb: string;
    scrcpy: string;
    autoStart: boolean;
    alwaysOnTop: boolean;
    windowWidth: number;
    turnScreenOff: boolean;
    audio: boolean;
    graceMs: number;
    reconnect: boolean;
    pin: string;
}
export interface DeviceInfo {
    serial: string;
    state: string;
    model: string;
}
export interface PhoneStateInfo {
    ok: boolean;
    locked: boolean | null;
    awake: boolean | null;
    secure: boolean | null;
    supported: boolean;
    error?: string;
}
export interface DependencyStatus {
    found: boolean;
    path: string;
    version: string;
}
export interface DependencyInfo {
    ok: boolean;
    adb: DependencyStatus;
    scrcpy: DependencyStatus;
    winget: boolean;
    installing: string;
    plugin: string;
}
export interface UnlockOutcome {
    ok: boolean;
    steps: string[];
    locked?: boolean | null;
    awake?: boolean | null;
    already?: boolean;
    needPin?: boolean;
    unsupported?: boolean;
    error?: string;
}
export interface MirrorOptions {
    serial: string;
    alwaysOnTop: boolean;
    windowWidth: number;
    turnScreenOff: boolean;
    audio: boolean;
}
export interface MirrorStatus {
    state: MirrorState;
    running: boolean;
    busy: boolean;
    error: string;
    since: number;
    serial: string;
    scrcpy: string;
}
