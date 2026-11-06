import { DeviceError } from '../../domain/errors.js';
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export async function waitFor(predicate, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const intervalMs = options.intervalMs ?? 800;
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const hit = await predicate();
            if (hit)
                return hit;
        }
        catch (err) {
            lastError = err;
        }
        await sleep(intervalMs);
    }
    throw new DeviceError('WAIT_TIMEOUT', lastError instanceof Error
        ? lastError.message
        : 'condition not met before timeout');
}
export async function withRetry(fn, options = {}) {
    const attempts = options.attempts ?? 3;
    const delayMs = options.delayMs ?? 500;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (attempt === attempts)
                break;
            await sleep(delayMs);
        }
    }
    throw lastError;
}
export function waitForText(device, text, options) {
    return waitFor(async () => {
        const observation = await device.observe();
        return findNode(observation.roots, node => node.text.includes(text) || node.desc.includes(text));
    }, options);
}
export function waitForApp(device, packageName, options) {
    return waitFor(async () => {
        const current = await device.foregroundApp();
        return current === packageName ? true : null;
    }, options);
}
export function findNode(nodes, predicate) {
    for (const node of nodes) {
        if (predicate(node))
            return node;
        const hit = findNode(node.children, predicate);
        if (hit)
            return hit;
    }
    return null;
}
export function findNodes(nodes, predicate) {
    const hits = [];
    const walk = (current) => {
        for (const node of current) {
            if (predicate(node))
                hits.push(node);
            walk(node.children);
        }
    };
    walk(nodes);
    return hits;
}
export function centerOf(node) {
    return {
        x: Math.round((node.bounds.left + node.bounds.right) / 2),
        y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
    };
}
