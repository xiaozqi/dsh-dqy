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
export function sanitizeShellText(text: string, max = 4000): string {
  return text
    .replace(/\0/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max)
}

/** Single-quote a value for the device shell. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Encode text for `input text`: `%` must be escaped first, spaces become `%s`,
 * and the whole payload is single-quoted for the device shell.
 */
export function encodeAdbInputText(text: string): string {
  const encoded = text
    .replace(/%/g, '%25')
    .replace(/\s/g, '%s')
  return shQuote(encoded)
}

/** Base64 is shell-safe by construction (used for the IME broadcast). */
export function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * Only package names may reach `monkey -p`; anything else is rejected instead
 * of being quoted, because a package name is never free-form text.
 */
export function assertPackageName(packageName: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(packageName)) {
    throw new Error(`invalid package name: ${packageName}`)
  }
  return packageName
}
