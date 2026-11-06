/**
 * Thin UiDriverPort adapter around an already-built AndroidDevice.
 * Every method, including findNodes/tapControl, delegates straight through.
 */
export class AdbUiDriver {
    device;
    kind = 'adb';
    constructor(device) {
        this.device = device;
    }
    connect() {
        return this.device.connect();
    }
    isConnected() {
        return this.device.isConnected();
    }
    screenSize() {
        return this.device.screenSize();
    }
    foregroundApp() {
        return this.device.foregroundApp();
    }
    tap(point) {
        return this.device.tap(point);
    }
    longPress(point, durationMs) {
        return this.device.longPress(point, durationMs);
    }
    swipe(from, to, durationMs) {
        return this.device.swipe(from, to, durationMs);
    }
    inputText(text) {
        return this.device.inputText(text);
    }
    inputChinese(text) {
        return this.device.inputChinese(text);
    }
    pressKey(key) {
        return this.device.pressKey(key);
    }
    openApp(packageName) {
        return this.device.openApp(packageName);
    }
    observe() {
        return this.device.observe();
    }
    findText(text) {
        return this.device.findText(text);
    }
    pushFile(localPath, remotePath) {
        return this.device.pushFile(localPath, remotePath);
    }
    pullFile(remotePath, localPath) {
        return this.device.pullFile(remotePath, localPath);
    }
    playAudio(remotePath) {
        return this.device.playAudio(remotePath);
    }
    recordAudio(durationMs, remotePath) {
        return this.device.recordAudio(durationMs, remotePath);
    }
    findNodes(matcher) {
        return this.device.findNodes(matcher);
    }
    tapControl(matcher, templateHint) {
        return this.device.tapControl(matcher, templateHint);
    }
}
