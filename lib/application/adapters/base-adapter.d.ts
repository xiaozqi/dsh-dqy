import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js';
import type { Point, UiNode } from '../../domain/types.js';
export interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
}
export declare function openAndWait(driver: UiDriverPort, packageName: string, options?: WaitOptions): Promise<void>;
/**
 * Refuse to act unless our own app owns the screen.
 *
 * Every write path calls this first: a notification, a mirror-panel tap or a
 * sibling automation can change the foreground app between two tool steps, and
 * a send must never land in whatever app happened to be on top.
 */
export declare function ensureForeground(driver: UiDriverPort, packageName: string, options?: WaitOptions): Promise<void>;
export declare function findControl(driver: UiDriverPort, matcher: UiMatcher, options?: WaitOptions): Promise<UiNode>;
export declare function tapByMatcher(driver: UiDriverPort, matcher: UiMatcher, options?: WaitOptions): Promise<UiNode>;
export declare function tapByText(driver: UiDriverPort, text: string, options?: WaitOptions): Promise<UiNode>;
export declare function tapSend(driver: UiDriverPort, options?: WaitOptions): Promise<void>;
/** Text currently in a discoverable input field ('' when none is found). */
export declare function composerText(driver: UiDriverPort): Promise<string>;
/**
 * Put text into the focused field.
 *
 * `adb shell input text` is ASCII-only: a Chinese reply injected through it
 * silently types nothing, and the old send path then reported success. Route
 * everything through the IME (clear + inject) and fall back to the ASCII
 * command only when the payload is pure ASCII.
 */
export declare function enterText(driver: UiDriverPort, text: string, matcher?: UiMatcher, options?: WaitOptions): Promise<void>;
/**
 * True only when the text left the composer and a bubble now shows it.
 *
 * The previous check searched the whole tree for the text, so a *failed* send
 * (text still in the composer) looked exactly like a successful one.
 */
export declare function confirmOutgoing(driver: UiDriverPort, text: string, options?: WaitOptions): Promise<boolean>;
export declare function typeIntoInput(driver: UiDriverPort, text: string, matcher?: UiMatcher, options?: WaitOptions): Promise<void>;
export declare function pushMedia(driver: UiDriverPort, localImagePath: string): Promise<string>;
export declare function waitAndTapPeer(driver: UiDriverPort, peer: string, options?: WaitOptions): Promise<void>;
export declare function firstTextNode(nodes: UiNode[]): UiNode | null;
export declare function currentCenter(driver: UiDriverPort): Promise<Point>;
