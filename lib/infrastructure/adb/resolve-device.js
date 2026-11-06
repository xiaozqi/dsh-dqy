import { execFileSync } from 'node:child_process';
import { DeviceError } from '../../domain/errors.js';
/**
 * Resolve the device serial to use for adb.
 *
 * A configured serial is used as-is. When the config leaves the serial empty
 * (wireless adb IP changes across reconnects), auto-discover the single
 * online device; with multiple online devices, fail loudly instead of
 * guessing.
 */
export function resolveDeviceSerial(adbPath, configured) {
    const trimmed = configured.trim();
    if (trimmed.length > 0)
        return trimmed;
    let output = '';
    try {
        output = execFileSync(adbPath, ['devices'], {
            encoding: 'utf8',
            timeout: 10000,
        });
    }
    catch (err) {
        throw new DeviceError('NO_DEVICE', `adb devices failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const online = output
        .split(/\r?\n/)
        .slice(1)
        .filter(line => /(^|\s)device$/.test(line.trim()))
        .map(line => line.trim().split(/\s+/)[0].trim());
    if (online.length === 0)
        return '';
    if (online.length > 1) {
        throw new DeviceError('MULTIPLE_DEVICES', `multiple devices online: ${online.join(', ')}; set deviceSerial explicitly`);
    }
    return online[0];
}
