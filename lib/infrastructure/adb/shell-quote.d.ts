/**
 * Quoting for text that ends up inside a command executed on the phone.
 *
 * `adb shell <args...>` does not pass argv to the device: modern adb joins the
 * arguments with spaces and lets `/system/bin/sh` re-split them. Any text that
 * came from a model or from an untrusted chat message therefore must be
 * single-quoted before it reaches the shell, or `$(...)`, backticks and `;`
 * are executed on the phone.
 */
/** Strip characters that cannot be typed and cap the length. */
export declare function sanitizeShellText(text: string, max?: number): string;
/** Single-quote a value for the device shell. */
export declare function shQuote(value: string): string;
/**
 * Encode text for `input text`: `%` must be escaped first, spaces become `%s`,
 * and the whole payload is single-quoted for the device shell.
 */
export declare function encodeAdbInputText(text: string): string;
/** Base64 is shell-safe by construction (used for the IME broadcast). */
export declare function toBase64(text: string): string;
/**
 * Only package names may reach `monkey -p`; anything else is rejected instead
 * of being quoted, because a package name is never free-form text.
 */
export declare function assertPackageName(packageName: string): string;
