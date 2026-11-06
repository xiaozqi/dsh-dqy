/**
 * Resolve the device serial to use for adb.
 *
 * A configured serial is used as-is. When the config leaves the serial empty
 * (wireless adb IP changes across reconnects), auto-discover the single
 * online device; with multiple online devices, fail loudly instead of
 * guessing.
 */
export declare function resolveDeviceSerial(adbPath: string, configured: string): string;
