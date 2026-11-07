import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
/**
 * Wakes the screen and refuses to drive a locked phone.
 *
 * Without this an overnight reply would tap the lock screen: the flow could
 * "succeed" at typing into nothing and then fail bubble verification, hiding
 * the real cause (the phone was locked). Failing early with DEVICE_LOCKED
 * makes that visible instead of silent.
 */
export declare function ensureDeviceReady(driver: UiDriverPort): Promise<void>;
