import { DeviceError } from '../../domain/errors.js';
import { sleep } from './wait-for.js';
const SYSTEM_UI = 'com.android.systemui';
/**
 * Wakes the screen and refuses to drive a locked phone.
 *
 * Without this an overnight reply would tap the lock screen: the flow could
 * "succeed" at typing into nothing and then fail bubble verification, hiding
 * the real cause (the phone was locked). Failing early with DEVICE_LOCKED
 * makes that visible instead of silent.
 */
export async function ensureDeviceReady(driver) {
    await driver.pressKey('wakeup');
    await sleep(400);
    const foreground = await driver.foregroundApp();
    if (foreground === SYSTEM_UI ||
        foreground.startsWith(`${SYSTEM_UI}.`)) {
        throw new DeviceError('DEVICE_LOCKED', 'screen is locked; refusing to drive the UI');
    }
}
