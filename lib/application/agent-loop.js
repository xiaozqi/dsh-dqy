const ACTION_SPEC = [
    'actions:',
    '- tap {x,y}',
    '- long_press {x,y,durationMs}',
    '- swipe {x1,y1,x2,y2,durationMs}',
    '- input_text {text}',
    '- press_key {key: back|home|recents|enter}',
    '- open_app {packageName}',
    '- wait {durationMs}',
    '- remember {content,tags:[]}',
    '- recall {query}',
    '- speak {text}  # say it aloud in your own voice',
    '- finish {summary}',
].join('\n');
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export class AgentLoop {
    device;
    memory;
    llm;
    guardrails;
    persona;
    voice;
    constructor(device, memory, llm, guardrails, persona, voice) {
        this.device = device;
        this.memory = memory;
        this.llm = llm;
        this.guardrails = guardrails;
        this.persona = persona;
        this.voice = voice;
    }
    async run(goal) {
        try {
            return await this.runInner(goal);
        }
        catch (err) {
            // Learn from failure, then rethrow so the caller sees the original error.
            await this.learnFromFailure(goal, err).catch(() => undefined);
            throw err;
        }
    }
    async runInner(goal) {
        await this.device.connect();
        const messages = [
            { role: 'system', content: this.systemPrompt() },
            { role: 'user', content: `Goal: ${goal}` },
        ];
        const lessons = await this.recallLessons(goal);
        if (lessons.length > 0) {
            messages.push({ role: 'user', content: lessons });
        }
        let observation = await this.device.observe();
        messages.push({ role: 'user', content: this.describe(observation) });
        for (let step = 1;; step++) {
            this.guardrails.checkStep(step);
            const action = await this.llm.decide(messages);
            messages.push({ role: 'assistant', content: JSON.stringify(action) });
            this.guardrails.checkAction(action);
            if (action.name === 'finish') {
                const summary = String(action.args.summary ?? 'goal finished');
                await this.memory.remember({
                    kind: 'event',
                    content: `goal: ${goal} | result: ${summary}`,
                    tags: ['goal'],
                });
                await this.learnFromSuccess(goal, summary, step).catch(() => undefined);
                return { goal, completed: true, summary, steps: step };
            }
            if (action.name === 'remember') {
                await this.memory.remember({
                    kind: 'fact',
                    content: String(action.args.content ?? ''),
                    tags: Array.isArray(action.args.tags)
                        ? action.args.tags.map(String)
                        : [],
                });
                messages.push({ role: 'user', content: 'memory saved' });
                continue;
            }
            if (action.name === 'recall') {
                const hits = await this.memory.recall(String(action.args.query ?? ''), 5);
                const text = hits.length > 0
                    ? hits.map(h => h.content).join('\n')
                    : 'no relevant memory';
                messages.push({ role: 'user', content: text });
                continue;
            }
            if (action.name === 'speak') {
                const text = String(action.args.text ?? '');
                const spoken = await this.voice?.speak(text);
                messages.push({
                    role: 'user',
                    content: `spoken in my own voice: ${text}`,
                });
                void spoken;
                continue;
            }
            await this.executeDeviceAction(action);
            observation = await this.device.observe();
            messages.push({ role: 'user', content: this.describe(observation) });
        }
    }
    // ---- learning ----
    async recallLessons(goal) {
        const hits = await this.memory.recall(goal, 10, 'lesson');
        if (hits.length === 0)
            return '';
        const lines = hits.map(h => `- ${h.content}`).join('\n');
        return `[prior lessons from past runs]\n${lines}\nUse them to avoid known mistakes, but re-verify against the live screen.`;
    }
    async learnFromSuccess(goal, summary, steps) {
        const insight = await this.reflect(`Task: ${goal}\nOutcome: succeeded (${summary})\nSteps: ${steps}`);
        if (insight) {
            await this.memory.remember({
                kind: 'lesson',
                content: insight,
                tags: ['lesson'],
            });
        }
    }
    async learnFromFailure(goal, err) {
        const insight = await this.reflect(`Task: ${goal}\nOutcome: failed\nError: ${String(err)}`);
        if (insight) {
            await this.memory.remember({
                kind: 'lesson',
                content: insight,
                tags: ['lesson'],
            });
        }
    }
    async reflect(what) {
        const reply = await this.llm.chat([
            {
                role: 'system',
                content: 'You are a self-improving phone agent. After each task you distill \
one or two concise lessons worth remembering for future similar tasks. \
Reply with plain text lines starting with "- ", each under 40 words, \
stating what worked or what to avoid.',
            },
            { role: 'user', content: what },
        ]);
        const insight = reply.trim();
        if (!insight || !insight.startsWith('-'))
            return '';
        return insight;
    }
    async executeDeviceAction(action) {
        const args = action.args;
        switch (action.name) {
            case 'tap':
                await this.device.tap({ x: Number(args.x), y: Number(args.y) });
                break;
            case 'long_press':
                await this.device.longPress({ x: Number(args.x), y: Number(args.y) }, Number(args.durationMs ?? 800));
                break;
            case 'swipe':
                await this.device.swipe({ x: Number(args.x1), y: Number(args.y1) }, { x: Number(args.x2), y: Number(args.y2) }, Number(args.durationMs ?? 300));
                break;
            case 'input_text':
                await this.device.inputText(String(args.text ?? ''));
                break;
            case 'press_key':
                await this.device.pressKey(String(args.key ?? 'back'));
                break;
            case 'open_app':
                await this.device.openApp(String(args.packageName ?? ''));
                break;
            case 'wait':
                await sleep(Number(args.durationMs ?? 1500));
                break;
            default:
                break;
        }
    }
    systemPrompt() {
        return [
            this.persona,
            'You operate one real Android phone through the actions below.',
            'Every reply must be a single JSON object matching:',
            '{"thought":"short reason","name":"action name","args":{...}}',
            ACTION_SPEC,
            'Rules: one action per reply; rely on the observation; when stuck, press back or pick another element; call finish once the goal is achieved.',
        ].join('\n');
    }
    describe(observation) {
        return [
            '[observation]',
            `foreground: ${observation.foregroundApp}`,
            `screen: ${observation.screenSize.width}x${observation.screenSize.height}`,
            'ui nodes:',
            ...this.compactNodes(observation.roots).slice(0, 60),
            `screenshot: ${observation.screenshotPath}`,
        ].join('\n');
    }
    compactNodes(nodes) {
        const out = [];
        const walk = (nodes) => {
            for (const node of nodes) {
                if (node.text || node.resourceId || node.clickable) {
                    const b = node.bounds;
                    out.push(`- "${node.text}" id="${node.resourceId}" [${b.left},${b.top},${b.right},${b.bottom}] clickable=${node.clickable}`);
                }
                walk(node.children);
            }
        };
        walk(nodes);
        return out;
    }
}
