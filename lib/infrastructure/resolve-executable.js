import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const IS_WINDOWS = process.platform === 'win32';
const PATH_SEPARATOR = IS_WINDOWS ? ';' : ':';
// Locate a command on PATH. On Windows this also tries the PATHEXT extensions;
// elsewhere the executable name is used as-is.
function which(cmd) {
    const exts = IS_WINDOWS
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
        : [''];
    for (const dir of (process.env.PATH || '')
        .split(PATH_SEPARATOR)
        .filter(Boolean)) {
        for (const ext of exts) {
            const file = join(dir, IS_WINDOWS ? cmd + ext.toLowerCase() : cmd);
            if (existsSync(file))
                return file;
        }
    }
    return '';
}
// Search packages installed through the Windows Package Manager, which keeps
// binaries outside PATH under LOCALAPPDATA/Microsoft/WinGet/Packages.
function wingetFind(pattern, exe) {
    const local = process.env.LOCALAPPDATA || '';
    const root = local ? join(local, 'Microsoft', 'WinGet', 'Packages') : '';
    if (!root)
        return '';
    try {
        for (const name of readdirSync(root)) {
            if (!pattern.test(name))
                continue;
            const pkgDir = join(root, name);
            for (const sub of readdirSync(pkgDir)) {
                const candidate = join(pkgDir, sub, exe);
                if (existsSync(candidate))
                    return candidate;
            }
        }
    }
    catch {
        return '';
    }
    return '';
}
// Resolve a usable external command. Every candidate is verified with
// existsSync; the bare command name is returned last so spawn reports a clear
// error when nothing is installed.
export function resolveExecutable(discovery) {
    const { configured, command, wingetPattern, wingetExe, extraCandidates = [], } = discovery;
    const trimmed = configured.trim();
    if (trimmed && trimmed !== command && existsSync(trimmed)) {
        return trimmed;
    }
    const candidates = [
        which(command),
        ...extraCandidates,
        wingetPattern && wingetExe ? wingetFind(wingetPattern, wingetExe) : '',
    ];
    for (const candidate of candidates) {
        if (candidate && existsSync(candidate))
            return candidate;
    }
    return command;
}
