import { DriverUnavailableError, UiNotFoundError, } from '../../domain/errors.js';
import { center, } from '../../domain/ports/ui-driver.port.js';
/**
 * Routes every UI operation through a primary driver, then a fallback
 * driver. findNodes tolerates failure by returning []; tapControl also
 * consults template vision as a final locator. Both are wrapped in a
 * single retry for transient failures. The kind of the last driver that
 * performed a successful action is exposed as lastUsed.
 */
export class FallbackUiDriver {
    config;
    kind = 'fallback';
    lastUsedDriver = '';
    constructor(config) {
        this.config = config;
    }
    get lastUsed() {
        return this.lastUsedDriver;
    }
    async connect() {
        await this.runChain(d => d.connect(), 'connect');
    }
    async isConnected() {
        for (const driver of [this.config.primary, this.config.fallback]) {
            try {
                if (await driver.isConnected())
                    return true;
            }
            catch {
                // try the next chain
            }
        }
        return false;
    }
    async screenSize() {
        return this.runChain(d => d.screenSize(), 'screenSize');
    }
    async foregroundApp() {
        return this.runChain(d => d.foregroundApp(), 'foregroundApp');
    }
    async tap(point) {
        await this.runChain(d => d.tap(point), 'tap');
    }
    async longPress(point, durationMs) {
        await this.runChain(d => d.longPress(point, durationMs), 'longPress');
    }
    async swipe(from, to, durationMs) {
        await this.runChain(d => d.swipe(from, to, durationMs), 'swipe');
    }
    async inputText(text) {
        await this.runChain(d => d.inputText(text), 'inputText');
    }
    async inputChinese(text) {
        await this.runChain(d => d.inputChinese(text), 'inputChinese');
    }
    async pressKey(key) {
        await this.runChain(d => d.pressKey(key), 'pressKey');
    }
    async openApp(packageName) {
        await this.runChain(d => d.openApp(packageName), 'openApp');
    }
    async observe() {
        return this.runChain(d => d.observe(), 'observe');
    }
    async findText(text) {
        return this.runChain(d => d.findText(text), 'findText');
    }
    async pushFile(localPath, remotePath) {
        await this.runChain(d => d.pushFile(localPath, remotePath), 'pushFile');
    }
    async pullFile(remotePath, localPath) {
        await this.runChain(d => d.pullFile(remotePath, localPath), 'pullFile');
    }
    async playAudio(remotePath) {
        await this.runChain(d => d.playAudio(remotePath), 'playAudio');
    }
    async recordAudio(durationMs, remotePath) {
        await this.runChain(d => d.recordAudio(durationMs, remotePath), 'recordAudio');
    }
    async findNodes(matcher) {
        return this.retryOnce(() => this.findNodesOnce(matcher));
    }
    async tapControl(matcher, templateHint) {
        return this.retryOnce(() => this.locateAndTap(matcher, templateHint));
    }
    async findNodesOnce(matcher) {
        for (const driver of [this.config.primary, this.config.fallback]) {
            try {
                const nodes = await driver.findNodes(matcher);
                if (nodes.length > 0) {
                    this.lastUsedDriver = driver.kind;
                    return nodes;
                }
            }
            catch {
                // try the next chain
            }
        }
        return [];
    }
    async locateAndTap(matcher, templateHint) {
        const reasons = [];
        for (const driver of [this.config.primary, this.config.fallback]) {
            try {
                const nodes = await driver.findNodes(matcher);
                if (nodes.length > 0) {
                    const node = nodes[0];
                    await this.tapPoint(center(node));
                    return node;
                }
                reasons.push(`${driver.kind}: no matching nodes`);
            }
            catch (err) {
                reasons.push(`${driver.kind}: ${err.message}`);
            }
        }
        if (templateHint && this.config.vision) {
            const { appId, label } = this.parseHint(templateHint);
            const point = await this.config.vision.findTemplate(appId, label);
            if (point) {
                await this.tapPoint(point);
                return syntheticNode(point);
            }
            reasons.push('vision: template not matched');
        }
        else if (templateHint) {
            reasons.push('vision: not configured');
        }
        throw new UiNotFoundError('UI_NOT_FOUND', `no control found for ${JSON.stringify(matcher)}: ${reasons.join(' | ')}`);
    }
    async tapPoint(point) {
        const errors = [];
        for (const driver of [this.config.primary, this.config.fallback]) {
            try {
                await driver.tap(point);
                this.lastUsedDriver = driver.kind;
                return;
            }
            catch (err) {
                errors.push(`${driver.kind}: ${err.message}`);
            }
        }
        throw new DriverUnavailableError('DRIVER_FAILED', `tap failed on all drivers: ${errors.join(' | ')}`);
    }
    async runChain(op, opName) {
        const errors = [];
        for (const driver of [this.config.primary, this.config.fallback]) {
            try {
                const result = await op(driver);
                this.lastUsedDriver = driver.kind;
                return result;
            }
            catch (err) {
                errors.push(`${driver.kind}: ${err.message}`);
            }
        }
        throw new DriverUnavailableError('DRIVER_FAILED', `${opName} failed: ${errors.join(' | ')}`);
    }
    parseHint(hint) {
        const idx = hint.lastIndexOf('/');
        if (idx > 0) {
            return { appId: hint.slice(0, idx), label: hint.slice(idx + 1) };
        }
        return { appId: '', label: hint };
    }
    async retryOnce(fn) {
        try {
            return await fn();
        }
        catch {
            return await fn();
        }
    }
}
function syntheticNode(point) {
    return {
        text: '',
        desc: '',
        resourceId: '',
        className: '',
        packageName: '',
        bounds: {
            left: point.x,
            top: point.y,
            right: point.x,
            bottom: point.y,
        },
        clickable: true,
        enabled: true,
        children: [],
    };
}
