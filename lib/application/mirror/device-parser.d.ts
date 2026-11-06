import type { DeviceInfo } from '../../domain/mirror-types.js';
import { MIRROR_WINDOW_TITLE as WINDOW_TITLE } from '../../domain/mirror-defaults.js';
export { WINDOW_TITLE };
export declare function parseDevices(text: string): DeviceInfo[];
export interface DevicePick {
    serial: string;
    source: 'configured' | 'dhcp' | '';
    online: DeviceInfo[];
}
export declare function pickDevice(list: DeviceInfo[], configured: string): DevicePick;
export declare function parseAdbVersion(out: string): string;
export declare function parseScrcpyVersion(out: string): string;
export declare function describeExit(code: number): string;
