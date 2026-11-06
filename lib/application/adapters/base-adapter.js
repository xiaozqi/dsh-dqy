import { DeviceError } from '../../domain/errors.js';
import { centerOf, findNode, sleep, waitFor } from '../support/wait-for.js';
export async function openAndWait(driver, packageName, options = {}) {
    await driver.openApp(packageName);
    await waitFor(async () => {
        const current = await driver.foregroundApp();
        return current === packageName ? true : null;
    }, { timeoutMs: 15000, ...options });
    await sleep(2000);
}
export async function findControl(driver, matcher, options = {}) {
    return waitFor(async () => {
        const nodes = await driver.findNodes(matcher);
        return nodes.length > 0 ? nodes[0] : null;
    }, options);
}
export async function tapByMatcher(driver, matcher, options = {}) {
    const node = await findControl(driver, matcher, options);
    await driver.tap(centerOf(node));
    return node;
}
export async function tapByText(driver, text, options = {}) {
    return tapByMatcher(driver, { text }, options);
}
export async function tapSend(driver, options = {}) {
    const send = await findControl(driver, { text: /^发送$|^回复$|^发布$|^提交$/ }, options);
    await driver.tap(centerOf(send));
    await sleep(600);
}
export async function typeIntoInput(driver, text, matcher, options = {}) {
    const input = matcher !== undefined
        ? await findControl(driver, matcher, options)
        : await findControl(driver, { className: /EditText/i }, options);
    await driver.tap(centerOf(input));
    await sleep(600);
    await driver.inputText(text);
    await sleep(400);
}
export async function pushMedia(driver, localImagePath) {
    const remote = `/sdcard/blue-fat-fish/media/img-${Date.now()}.png`;
    try {
        await driver.pushFile(localImagePath, remote);
    }
    catch (err) {
        if (err instanceof DeviceError) {
            throw err;
        }
        throw new DeviceError('PUSH_FAILED', `cannot push image to phone: ${err.message}`);
    }
    return remote;
}
export async function waitAndTapPeer(driver, peer, options = {}) {
    const peerNode = await findControl(driver, { text: peer }, options);
    await driver.tap(centerOf(peerNode));
    await sleep(1200);
}
export function firstTextNode(nodes) {
    return findNode(nodes, node => node.text.length > 0);
}
export async function currentCenter(driver) {
    const size = await driver.screenSize();
    return {
        x: Math.round(size.width / 2),
        y: Math.round(size.height * 0.45),
    };
}
