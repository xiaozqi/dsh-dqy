import { DeviceError } from '../../domain/errors.js';
import { centerOf, sleep, waitFor, waitForApp, } from '../support/wait-for.js';
const DEFAULT_SEND = {
    regex: true,
    text: '^发送$|^回复$|^发布$|^提交$',
};
const DEFAULT_INPUT = {
    regex: true,
    className: 'EditText',
};
function toMatcher(selector) {
    const regex = selector.regex ?? false;
    const compile = (value) => {
        if (value === undefined)
            return undefined;
        return regex ? new RegExp(value) : value;
    };
    return {
        text: compile(selector.text),
        desc: compile(selector.desc),
        resourceId: compile(selector.resourceId),
        className: compile(selector.className),
    };
}
function hasNonAscii(text) {
    return /[^\x00-\x7F]/.test(text);
}
export class RecipeExecutor {
    driver;
    constructor(driver) {
        this.driver = driver;
    }
    async execute(recipe, context) {
        await this.driver.connect();
        for (const step of recipe.steps) {
            await this.runStep(recipe, step, context);
        }
    }
    async runStep(recipe, step, context) {
        const current = step.selector
            ? { ...step, selector: this.resolveSelector(step.selector, context) }
            : step;
        const timeoutMs = current.timeoutMs ?? 10000;
        switch (current.action) {
            case 'open_app':
                await this.driver.openApp(recipe.packageName);
                await waitForApp(this.driver, recipe.packageName, { timeoutMs });
                await sleep(2000);
                break;
            case 'wait_for':
            case 'verify':
                if (!current.selector) {
                    throw new DeviceError('RECIPE_BAD_STEP', `${current.action} needs a selector`);
                }
                await this.findControl(current.selector, timeoutMs);
                break;
            case 'tap':
                if (!current.selector) {
                    throw new DeviceError('RECIPE_BAD_STEP', 'tap needs a selector');
                }
                await this.tapControl(current.selector, timeoutMs);
                break;
            case 'input':
                await this.input(current, context);
                break;
            case 'send':
                await this.tapControl(current.selector ?? DEFAULT_SEND, timeoutMs);
                await sleep(600);
                break;
            case 'press_key':
                if (!current.key) {
                    throw new DeviceError('RECIPE_BAD_STEP', 'press_key needs a key');
                }
                await this.driver.pressKey(current.key);
                break;
        }
    }
    resolveSelector(selector, context) {
        const fill = (value) => {
            if (value === undefined)
                return undefined;
            return value.replace(/\{(\w+)\}/g, (_, key) => context[key] ?? '');
        };
        return {
            ...selector,
            text: fill(selector.text),
            desc: fill(selector.desc),
            resourceId: fill(selector.resourceId),
            className: fill(selector.className),
        };
    }
    async findControl(selector, timeoutMs) {
        const matcher = toMatcher(selector);
        return waitFor(async () => {
            const nodes = await this.driver.findNodes(matcher);
            return nodes[0] ?? null;
        }, { timeoutMs });
    }
    async tapControl(selector, timeoutMs) {
        const node = await this.findControl(selector, timeoutMs);
        await this.driver.tap(centerOf(node));
    }
    async input(step, context) {
        const text = step.from ? context[step.from] : step.value;
        if (!text) {
            throw new DeviceError('RECIPE_BAD_STEP', 'input resolved to empty text');
        }
        const selector = step.selector ?? DEFAULT_INPUT;
        const node = await this.findControl(selector, step.timeoutMs ?? 10000);
        await this.driver.tap(centerOf(node));
        await sleep(600);
        if (hasNonAscii(text)) {
            await this.driver.inputChinese(text);
        }
        else {
            await this.driver.inputText(text);
        }
        await sleep(400);
    }
}
