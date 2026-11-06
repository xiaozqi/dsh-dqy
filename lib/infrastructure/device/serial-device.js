import { DeviceTimeoutError, } from '../../domain/errors.js';
/**
 * Serializes every device call and gives each one a deadline.
 *
 * One phone is shared by the tools, the autonomy heartbeat, the notification
 * pipeline and the mirror panel. Without a mutex two flows interleave: the
 * concrete first casualty is the IME — two concurrent `inputChinese` calls both
 * read "previous IME", restore it twice, and the phone is left on ADBKeyBoard
 * with the user's keyboard gone.
 *
 * A timeout rejects the caller but cannot cancel the running adb child: the
 * queue advances so one wedged call cannot block the plugin forever, and the
 * timeout is reported so the caller re-observes instead of trusting its state.
 */
export class SerialDevice {
    inner;
    options;
    kind;
    tail = Promise.resolve();
    constructor(inner, options) {
        this.inner = inner;
        this.options = options;
        this.kind = `serial(${inner.kind})`;
    }
    connect() {
        return this.run('connect', this.options.timeoutMs, () => this.inner.connect());
    }
    isConnected() {
        return this.run('isConnected', this.options.timeoutMs, () => this.inner.isConnected());
    }
    screenSize() {
        return this.run('screenSize', this.options.timeoutMs, () => this.inner.screenSize());
    }
    foregroundApp() {
        return this.run('foregroundApp', this.options.timeoutMs, () => this.inner.foregroundApp());
    }
    tap(point) {
        return this.run('tap', this.options.timeoutMs, () => this.inner.tap(point));
    }
    longPress(point, durationMs) {
        return this.run('longPress', this.options.timeoutMs, () => this.inner.longPress(point, durationMs));
    }
    swipe(from, to, durationMs) {
        return this.run('swipe', this.options.timeoutMs, () => this.inner.swipe(from, to, durationMs));
    }
    inputText(text) {
        return this.run('inputText', this.options.timeoutMs, () => this.inner.inputText(text));
    }
    inputChinese(text) {
        return this.run('inputChinese', this.options.timeoutMs, () => this.inner.inputChinese(text));
    }
    pressKey(key) {
        return this.run('pressKey', this.options.timeoutMs, () => this.inner.pressKey(key));
    }
    openApp(packageName) {
        return this.run('openApp', this.options.timeoutMs, () => this.inner.openApp(packageName));
    }
    observe() {
        return this.run('observe', this.options.observeTimeoutMs ?? this.options.timeoutMs, () => this.inner.observe());
    }
    findText(text) {
        return this.run('findText', this.options.timeoutMs, () => this.inner.findText(text));
    }
    findNodes(matcher) {
        return this.run('findNodes', this.options.timeoutMs, () => this.inner.findNodes(matcher));
    }
    tapControl(matcher, templateHint) {
        return this.run('tapControl', this.options.timeoutMs, () => this.inner.tapControl(matcher, templateHint));
    }
    pushFile(localPath, remotePath) {
        return this.run('pushFile', this.options.timeoutMs, () => this.inner.pushFile(localPath, remotePath));
    }
    pullFile(remotePath, localPath) {
        return this.run('pullFile', this.options.timeoutMs, () => this.inner.pullFile(remotePath, localPath));
    }
    playAudio(remotePath) {
        return this.run('playAudio', this.options.timeoutMs, () => this.inner.playAudio(remotePath));
    }
    recordAudio(durationMs, remotePath) {
        return this.run('recordAudio', this.options.timeoutMs, () => this.inner.recordAudio(durationMs, remotePath));
    }
    /** Number of callers currently waiting for their turn, for diagnostics. */
    get queued() {
        return this.pending;
    }
    pending = 0;
    run(label, timeoutMs, action) {
        this.pending += 1;
        const start = () => {
            this.pending -= 1;
            return this.withDeadline(label, timeoutMs, action);
        };
        // Chain on both outcomes so one rejection cannot poison the queue.
        const result = this.tail.then(start, start);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
    async withDeadline(label, timeoutMs, action) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                this.options.onTimeout?.(label, timeoutMs);
                reject(new DeviceTimeoutError('DEVICE_TIMEOUT', `${label} exceeded ${timeoutMs}ms; the phone may be wedged, ` +
                    're-observe before acting again'));
            }, timeoutMs);
            timer.unref?.();
        });
        try {
            return await Promise.race([action(), timeout]);
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
}
