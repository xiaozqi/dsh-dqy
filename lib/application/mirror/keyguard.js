// Lock-screen indicators across Android versions; any match means locked.
const LOCKED_PATTERNS = [
    /isStatusBarKeyguard\s*=\s*true/,
    /mDreamingLockscreen\s*=\s*true/,
    /mShowingLockscreen\s*=\s*true/,
    /mKeyguardShowing\s*=\s*true/,
    /KeyguardServiceDelegate[\s\S]{0,240}?\bshowing\s*=\s*true/,
];
// Fields proving the output actually carries keyguard signals.
const SIGNAL_PATTERNS = [
    /isStatusBarKeyguard\s*=/,
    /mDreamingLockscreen\s*=/,
    /mShowingLockscreen\s*=/,
    /mKeyguardShowing\s*=/,
    /KeyguardServiceDelegate/,
    /mWakefulness\s*=/,
];
// Count recognisable signal fields; zero means the system is unsupported.
export function keyguardSignals(dump) {
    const text = String(dump || '');
    let n = 0;
    for (const re of SIGNAL_PATTERNS)
        if (re.test(text))
            n++;
    return n;
}
// Null means no signal field was present; never guess in that case.
export function isLocked(dump) {
    const text = String(dump || '');
    if (LOCKED_PATTERNS.some(re => re.test(text)))
        return true;
    return keyguardSignals(text) > 0 ? false : null;
}
export function isAwake(dump) {
    const m = /mWakefulness\s*=\s*(\w+)/.exec(String(dump || ''));
    return m ? m[1] === 'Awake' : null;
}
export function isSecure(dump) {
    const m = /^\s*secure=(true|false)\s*$/m.exec(String(dump || ''));
    return m ? m[1] === 'true' : null;
}
// Braces are required because these dumps feed a pipe; without them the pipe
// would only attach to the second command and lose the keyguard indicator.
const KEYGUARD = [
    '{',
    "dumpsys window 2>/dev/null | grep -E 'isStatusBarKeyguard|mDreamingLockscreen|mShowingLockscreen|mKeyguardShowing|showing=';",
    "dumpsys window policy 2>/dev/null | grep -E 'mKeyguardShowing|isStatusBarKeyguard';",
    '}',
].join(' ');
const AWAKE = 'dumpsys power 2>/dev/null | grep mWakefulness=';
// Build the single on-device shell script performing the whole unlock flow.
export function unlockScript(pin) {
    const hasPin = typeof pin === 'string' && /^\d{4,12}$/.test(pin);
    const swipe = "S=$(wm size | sed -n 's/.*: \\([0-9]*\\)x\\([0-9]*\\).*/\\1 \\2/p' | tail -1); set -- $S; W=$1; H=$2; " +
        'input swipe $((W/2)) $((H*8/10)) $((W/2)) $((H*28/100)) 220; echo MARK:swipe; sleep 0.35';
    const lines = [
        `S0=$(${KEYGUARD}; ${AWAKE})`,
        'echo MARK:state',
        'echo "$S0"',
        `if ! echo "$S0" | grep -q 'mWakefulness=Awake'; then input keyevent 224; echo MARK:wake; sleep 0.25; fi`,
        `if echo "$S0" | grep -q 'isStatusBarKeyguard=true'; then`,
        `  wm dismiss-keyguard; echo MARK:dismiss; sleep 0.2`,
        `  if ${KEYGUARD} | grep -q 'isStatusBarKeyguard=true'; then`,
    ];
    if (hasPin) {
        lines.push(`    ${swipe}`, `    input text ${pin}; echo MARK:pin; sleep 0.8`, `    F=$(${KEYGUARD}; ${AWAKE})`, `    if echo "$F" | grep -q 'isStatusBarKeyguard=true'; then`, `      sleep 0.4; F=$(${KEYGUARD}; ${AWAKE})`, `      if echo "$F" | grep -q 'isStatusBarKeyguard=true'; then input keyevent 66; echo MARK:enter; sleep 0.8; F=$(${KEYGUARD}; ${AWAKE}); fi`, '    fi');
    }
    else {
        lines.push(`    ${swipe}`, `    F=$(${KEYGUARD}; ${AWAKE})`);
    }
    lines.push('  else', `    F=$(${KEYGUARD}; ${AWAKE})`, '  fi', 'else', '  echo MARK:unlocked', `  F=$(${KEYGUARD}; ${AWAKE})`, 'fi', 'echo FINAL:', 'echo "$F"');
    return lines.join('\n');
}
// Parse the unlock script output into steps and the final keyguard state.
export function parseUnlockOutput(out) {
    const text = String(out || '');
    const cut = text.lastIndexOf('FINAL:');
    const actions = cut >= 0 ? text.slice(0, cut) : text;
    const finalDump = cut >= 0 ? text.slice(cut + 6) : text;
    const steps = [];
    const already = /MARK:unlocked/.test(actions);
    if (/MARK:wake/.test(actions))
        steps.push('唤醒');
    if (/MARK:swipe/.test(actions))
        steps.push('上滑');
    if (/MARK:pin/.test(actions))
        steps.push('输入 PIN');
    if (/MARK:enter/.test(actions))
        steps.push('回车');
    return { actions, finalDump, steps, already };
}
