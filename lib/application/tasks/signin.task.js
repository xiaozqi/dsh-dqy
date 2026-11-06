import { DeviceError } from '../../domain/errors.js';
export function flattenUiText(roots) {
    const lines = [];
    const walk = (nodes) => {
        for (const node of nodes) {
            if (node.text)
                lines.push(node.text);
            walk(node.children);
        }
    };
    walk(roots);
    return lines.join('\n');
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export class SignInService {
    device;
    memory;
    plans;
    constructor(device, memory, plans) {
        this.device = device;
        this.memory = memory;
        this.plans = plans;
    }
    listPlans() {
        return this.plans;
    }
    async runByApp(app) {
        const plan = this.plans.find(p => p.app === app || p.appName === app);
        if (!plan)
            throw new DeviceError('PLAN_NOT_FOUND', `no sign-in plan for ${app}`);
        return this.run(plan);
    }
    async run(plan) {
        try {
            for (const step of plan.steps) {
                await this.executeStep(step);
                await sleep(800);
            }
            const observation = await this.device.observe();
            const uiText = flattenUiText(observation.roots);
            const succeeded = plan.successText.some(t => uiText.includes(t));
            const record = {
                app: plan.app,
                name: plan.appName,
                lastStatus: succeeded ? 'success' : 'failed',
                lastRunAt: new Date().toISOString(),
                detail: succeeded ? 'success markers found' : 'no success marker on screen',
            };
            await this.memory.saveTaskResult(record);
            return record;
        }
        catch (err) {
            const record = {
                app: plan.app,
                name: plan.appName,
                lastStatus: 'failed',
                lastRunAt: new Date().toISOString(),
                detail: err.message,
            };
            await this.memory.saveTaskResult(record);
            return record;
        }
    }
    async executeStep(step) {
        switch (step.kind) {
            case 'open_app':
                await this.device.openApp(step.target ?? '');
                break;
            case 'click_text': {
                const point = await this.device.findText(step.target ?? '');
                if (!point) {
                    throw new DeviceError('ELEMENT_NOT_FOUND', `text not found: ${step.target}`);
                }
                await this.device.tap(point);
                break;
            }
            case 'input_text':
                await this.device.inputText(step.value ?? '');
                break;
            case 'press_key':
                await this.device.pressKey(step.target ?? 'back');
                break;
            case 'wait':
                await sleep(step.durationMs ?? 1500);
                break;
        }
    }
}
