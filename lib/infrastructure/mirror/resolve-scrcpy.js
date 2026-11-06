import { resolveExecutable } from '../resolve-executable.js';
// Resolve a usable scrcpy binary. An explicit absolute path is honoured; the
// bare default 'scrcpy' (or an empty value) triggers PATH then winget
// discovery.
export function resolveScrcpyPath(configured) {
    return resolveExecutable({
        configured,
        command: 'scrcpy',
        wingetPattern: /scrcpy/i,
        wingetExe: 'scrcpy.exe',
    });
}
