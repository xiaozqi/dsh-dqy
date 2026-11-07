import { flattenUiText, } from '../application/tasks/signin.task.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CAPABILITIES } from '../domain/adapter-types.js';
import { AdapterError } from '../domain/errors.js';
import { registerAppTools } from './app-tools.js';
export function registerTools(ctx, services) {
    // Every tool gets a hard deadline and is declared non-concurrency-safe by
    // default, because all of them can drive the one phone. Read-only tools opt
    // into parallel execution below. A wedged adb or python call therefore ends
    // as a typed timeout instead of a model step that hangs forever.
    const register = (definition, concurrencySafe = false) => {
        ctx.tools.register({
            ...definition,
            timeoutMs: definition.timeoutMs ?? services.toolTimeoutMs,
            isConcurrencySafe: definition.isConcurrencySafe ?? (() => concurrencySafe),
        });
    };
    register(defineTool({
        name: 'fish_goal',
        description: 'Give DQY an open-ended goal on the Android phone; it plans and executes autonomously.',
        parameters: {
            goal: {
                type: 'string',
                required: true,
                description: 'Natural language goal',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    goal: { type: 'string', required: true },
                    completed: { type: 'boolean', required: true },
                    summary: { type: 'string', required: true },
                    steps: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: `${value.completed ? 'completed' : 'stopped'} after ${value.steps} steps: ${value.summary}`,
                },
            ],
        },
        async execute(args) {
            return services.loop.run(args.goal);
        },
    }));
    register(defineTool({
        name: 'fish_signin',
        description: 'Run a daily sign-in task. Uses a configured plan; falls back to autonomous mode for unknown apps.',
        parameters: {
            app: {
                type: 'string',
                required: true,
                description: 'App package name or display name',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: renderSignin(value),
                },
            ],
        },
        async execute(args) {
            const plan = services.signin
                .listPlans()
                .find(p => p.app === args.app || p.appName === args.app);
            if (plan) {
                const record = await services.signin.run(plan);
                return {
                    mode: 'plan',
                    app: args.app,
                    name: record.name,
                    status: record.lastStatus,
                    detail: record.detail,
                    ok: record.lastStatus === 'success',
                    data: {},
                };
            }
            for (const adapter of services.adapters.list()) {
                if ((adapter.id === args.app ||
                    adapter.displayName === args.app) &&
                    adapter.capabilities.has('signin')) {
                    const signin = services.adapters.getCapability(adapter.id, 'signin');
                    const result = await signin.signIn();
                    return {
                        mode: 'adapter',
                        app: adapter.id,
                        name: adapter.displayName,
                        status: result.ok ? 'success' : 'failed',
                        detail: result.detail,
                        ok: result.ok,
                        data: result.data ?? {},
                    };
                }
            }
            const result = await services.loop.run(`在${args.app}完成每日签到`);
            return {
                mode: 'autonomous',
                app: args.app,
                name: '',
                status: result.completed ? 'success' : 'stopped',
                detail: result.summary,
                ok: result.completed,
                data: { steps: result.steps },
            };
        },
    }));
    register(defineTool({
        name: 'fish_observe',
        description: 'Capture the current phone screen: foreground app, UI text and screenshot path.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    foreground: { type: 'string', required: true },
                    screenshotPath: { type: 'string', required: true },
                    nodeCount: { type: 'integer', required: true },
                    uiText: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: `foreground: ${value.foreground}\n${value.uiText}\nscreenshot: ${value.screenshotPath}`,
                },
            ],
        },
        async execute() {
            const observation = await services.device.observe();
            return {
                foreground: observation.foregroundApp,
                screenshotPath: observation.screenshotPath,
                nodeCount: countNodes(observation.roots),
                uiText: flattenUiText(observation.roots).slice(0, 2000),
            };
        },
    }));
    register(defineTool({
        name: 'fish_remember',
        description: 'Store a long-term fact in DQY memory.',
        parameters: {
            content: {
                type: 'string',
                required: true,
                description: 'Fact to remember',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    content: { type: 'string', required: true },
                    tags: {
                        type: 'array',
                        required: true,
                        items: { type: 'string' },
                    },
                    createdAt: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [
                { type: 'text', text: `saved: ${value.content}` },
            ],
        },
        async execute(args) {
            return services.memory.remember({
                kind: 'fact',
                content: args.content,
                tags: Array.isArray(args.tags) ? args.tags : [],
            });
        },
    }));
    register(defineTool({
        name: 'fish_recall',
        description: 'Search DQY memory for relevant facts and events.',
        parameters: {
            query: {
                type: 'string',
                required: true,
                description: 'Search query',
            },
        },
        output: {
            schema: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string', required: true },
                        kind: { type: 'string', required: true },
                        content: { type: 'string', required: true },
                        tags: {
                            type: 'array',
                            required: true,
                            items: { type: 'string' },
                        },
                        createdAt: { type: 'string', required: true },
                    },
                },
            },
            render: (_args, value) => {
                const text = value.length > 0
                    ? value.map(r => `- ${r.content}`).join('\n')
                    : 'no memory hit';
                return [{ type: 'text', text }];
            },
        },
        async execute(args) {
            return services.memory.recall(args.query, 5);
        },
    }), true);
    register(defineTool({
        name: 'fish_status',
        description: 'Show device connection, configured sign-in plans and task history.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    deviceConnected: { type: 'boolean', required: true },
                    plans: {
                        type: 'array',
                        required: true,
                        items: { type: 'object', additionalProperties: true },
                    },
                    taskHistory: {
                        type: 'array',
                        required: true,
                        items: { type: 'object', additionalProperties: true },
                    },
                },
            },
            render: (_args, value) => [
                { type: 'text', text: JSON.stringify(value, null, 2) },
            ],
        },
        async execute() {
            const connected = await services.device.isConnected();
            const taskHistory = await services.memory.listTaskResults();
            return {
                deviceConnected: connected,
                plans: services.signin
                    .listPlans()
                    .map(p => ({ app: p.app, name: p.appName })),
                taskHistory: taskHistory.map(t => ({ ...t })),
            };
        },
    }));
    register(defineTool({
        name: 'fish_reply_status',
        description: 'Show QQ/Douyin auto-reply health: queue state, recent send phases and recent failures.',
        parameters: {},
        output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [
                { type: 'text', text: JSON.stringify(value, null, 2) },
            ],
        },
        async execute() {
            // Round-trip through JSON: the tool protocol wants plain JSON values.
            return JSON.parse(JSON.stringify(await services.replyHealth()));
        },
    }), true);
    register(defineTool({
        name: 'fish_apps',
        description: 'List registered app adapters, their capabilities and unimplemented TODO items.',
        parameters: {},
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: renderApps(value),
                },
            ],
        },
        async execute() {
            return {
                apps: services.adapters.list().map(a => ({
                    id: a.id,
                    displayName: a.displayName,
                    packageName: a.packageName,
                    capabilities: [...a.capabilities],
                    actions: actionCatalog([...a.capabilities]),
                    todoCount: a.todos.length,
                })),
                todos: services.adapters.listTodos().map(t => ({
                    app: t.app,
                    capability: t.capability,
                    feature: t.feature,
                    note: t.note,
                })),
            };
        },
    }), true);
    register(defineTool({
        name: 'fish_app_run',
        description: 'Run one capability action on a registered app adapter. ' +
            'Call fish_apps first: it lists every action with the exact parameter ' +
            'names it accepts and the app id to pass here.',
        parameters: {
            app: {
                type: 'string',
                required: true,
                description: 'Adapter id or display name (see fish_apps)',
            },
            capability: {
                type: 'string',
                required: true,
                description: 'Capability id (see fish_apps)',
            },
            action: {
                type: 'string',
                required: true,
                description: 'Action name within the capability (see fish_apps)',
            },
            params: {
                type: 'object',
                additionalProperties: true,
                description: 'Action parameters, exactly as listed by fish_apps for that action',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    app: { type: 'string', required: true },
                    capability: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    ok: { type: 'boolean', required: true },
                    detail: { type: 'string', required: true },
                    sent: { type: 'boolean' },
                    data: { type: 'object', additionalProperties: true },
                },
            },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: renderAppRun(value),
                },
            ],
        },
        async execute(args) {
            const requestedApp = String(args.app);
            const capability = String(args.capability);
            const action = String(args.action);
            if (!CAPABILITIES.includes(capability)) {
                throw new AdapterError('BAD_CAPABILITY', `unknown capability ${capability}; call fish_apps for the catalog`);
            }
            const spec = actionSpec(capability, action);
            if (!spec) {
                throw new AdapterError('ACTION_NOT_FOUND', `no action ${capability}/${action}; call fish_apps for the catalog`);
            }
            const app = resolveAdapterId(services.adapters, requestedApp);
            const adapter = services.adapters.getCapability(app, capability);
            const fn = adapter[spec.method];
            if (typeof fn !== 'function') {
                throw new AdapterError('ACTION_NOT_FOUND', `adapter ${app} has no callable ${spec.method}`);
            }
            const params = normalizeParams(spec, readParams(args.params));
            try {
                // Some capability methods take positional arguments
                // (readConversation(peer, limit), browseComments(limit)); passing the
                // params object positionally used to make `peer` an object and the
                // read silently returned nothing.
                const raw = spec.positional
                    ? await fn.apply(adapter, spec.positional.map(key => params[key]))
                    : await fn.call(adapter, params);
                const result = normalizeAdapterResult(raw);
                return {
                    app,
                    capability,
                    action,
                    ok: result.ok,
                    detail: result.detail,
                    sent: result.sent,
                    data: result.data,
                };
            }
            catch (err) {
                return {
                    app,
                    capability,
                    action,
                    ok: false,
                    detail: err instanceof Error ? err.message : String(err),
                    sent: false,
                    data: {},
                };
            }
        },
    }));
    register(defineTool({
        name: 'fish_notifications',
        description: 'Inspect the phone notification pipeline: whether it runs, the live connection state, filter statistics and recently allowed notifications.',
        parameters: {},
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: renderNotifications(value),
                },
            ],
        },
        async execute() {
            const svc = services.notifications;
            const stats = svc.stats();
            const recent = svc.recent(20).map(d => ({
                app: d.event.app,
                title: d.event.title,
                text: d.event.text,
                when: d.event.when,
                action: d.action,
                reason: d.reason,
            }));
            return {
                enabled: svc.started,
                connected: svc.connected,
                stats,
                recent,
            };
        },
    }), true);
    register(defineTool({
        name: 'fish_confirmations',
        description: 'List the actions waiting for the phone owner to approve, plus the ' +
            'current send mode. DQY cannot approve her own actions: ' +
            'report the pending ids to the owner, who decides with /confirm.',
        parameters: {},
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [
                {
                    type: 'text',
                    text: renderConfirmations(value),
                },
            ],
        },
        async execute() {
            const snapshot = services.runMode.snapshot();
            return {
                enabled: snapshot.enabled,
                dryRun: snapshot.dryRun,
                halted: snapshot.halted,
                pending: services.confirmations.list().map(action => ({
                    id: action.id,
                    app: action.app,
                    capability: action.capability,
                    method: action.method,
                    reason: action.reason,
                    args: JSON.stringify(action.args).slice(0, 400),
                    createdAt: new Date(action.createdAt).toISOString(),
                    expiresAt: new Date(action.expiresAt).toISOString(),
                })),
            };
        },
    }), true);
    registerAppTools(ctx, services);
}
function countNodes(roots) {
    let count = 0;
    const walk = (nodes) => {
        for (const node of nodes) {
            count += 1;
            walk(node.children);
        }
    };
    walk(roots);
    return count;
}
function renderSignin(value) {
    if (value.mode === 'plan') {
        return `${value.name}: ${value.status} - ${value.detail}`;
    }
    if (value.mode === 'adapter') {
        return `${value.name}: ${value.ok ? 'ok' : 'failed'} - ${value.detail}`;
    }
    return `autonomous: ${value.status} - ${value.detail}`;
}
// Single source of truth for what fish_app_run can dispatch, what fish_apps
// advertises, and how parameters map onto the capability method.
const ACTION_CATALOG = {
    message: [
        { action: 'sendMessage', method: 'sendMessage', params: ['peer', 'text'] },
        {
            action: 'sendImage',
            method: 'sendImage',
            params: ['peer', 'localImagePath', 'caption'],
        },
        {
            action: 'readConversation',
            method: 'readConversation',
            params: ['peer', 'limit'],
            positional: ['peer', 'limit'],
        },
    ],
    comment: [
        { action: 'comment', method: 'comment', params: ['text', 'target'] },
        { action: 'replyComment', method: 'replyComment', params: ['text', 'target'] },
        {
            action: 'browseComments',
            method: 'browseComments',
            params: ['limit'],
            positional: ['limit'],
        },
    ],
    social: [
        { action: 'mention', method: 'mention', params: ['friend', 'text', 'context'] },
    ],
    moment: [
        { action: 'publishMoment', method: 'publishMoment', params: ['text', 'visibleTo'] },
    ],
    live: [{ action: 'watchLive', method: 'watchLive', params: ['anchor', 'durationMs'] }],
    feed: [
        {
            action: 'browseFeed',
            method: 'browseFeed',
            params: ['count', 'watchMs', 'likeKeywords'],
        },
    ],
    signin: [{ action: 'signIn', method: 'signIn', params: [] }],
    pet: [{ action: 'feedPet', method: 'feedPet', params: [] }],
    game: [
        { action: 'runGame', method: 'runGame', params: ['game', 'rounds', 'threshold'] },
    ],
};
function actionSpec(capability, action) {
    return ACTION_CATALOG[capability]?.find(item => item.action === action);
}
function actionCatalog(capabilities) {
    const out = {};
    for (const capability of capabilities) {
        out[capability] = ACTION_CATALOG[capability] ?? [];
    }
    return out;
}
function resolveAdapterId(registry, requested) {
    const name = requested.trim();
    try {
        return registry.get(name).id;
    }
    catch {
        const byName = registry.list().find(adapter => adapter.displayName === name);
        if (byName) {
            return byName.id;
        }
        throw new AdapterError('ADAPTER_NOT_FOUND', `no app adapter registered for: ${requested}; call fish_apps for the ids`);
    }
}
function readParams(input) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return input;
    }
    return {};
}
function normalizeParams(spec, params) {
    const out = { ...params };
    // Models emit `peer` for every person-targeted action, but the social
    // capability names its field `friend`; accept both instead of failing.
    if (spec.method === 'mention' &&
        out.friend === undefined &&
        out.peer !== undefined) {
        out.friend = out.peer;
    }
    if (spec.method === 'publishMoment' &&
        out.text === undefined &&
        out.content !== undefined) {
        out.text = out.content;
    }
    return out;
}
function normalizeAdapterResult(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const record = raw;
        if (typeof record.ok === 'boolean') {
            const data = record.data &&
                typeof record.data === 'object' &&
                !Array.isArray(record.data)
                ? record.data
                : {};
            return {
                ok: record.ok,
                detail: typeof record.detail === 'string' ? record.detail : '',
                // Adapters historically put `sent` inside data; honour both so a real
                // transmission is never reported as sent=false.
                sent: record.sent === true || data.sent === true,
                data,
            };
        }
        // Read-style results (ConversationPreview, {items}) carry no ok flag; a
        // resolved call is a completed read.
        let detail = 'read completed';
        let data = {};
        try {
            data = record;
            detail = `read: ${JSON.stringify(record).slice(0, 400)}`;
        }
        catch {
            // Circular payloads keep the generic detail.
        }
        return { ok: true, detail, sent: false, data };
    }
    return {
        ok: true,
        detail: raw === undefined || raw === null ? '(no return value)' : String(raw),
        sent: false,
        data: {},
    };
}
function renderNotifications(value) {
    const lines = [
        `enabled=${value.enabled} connected=${value.connected}`,
        `received=${value.stats.received} allowed=${value.stats.allowed} blocked=${value.stats.blocked} dropped=${JSON.stringify(value.stats.droppedBy)}`,
    ];
    if (value.recent.length === 0) {
        lines.push('no recent allowed notifications');
    }
    for (const r of value.recent) {
        const title = r.title || '-';
        const text = r.text || '-';
        lines.push(`- [${r.action}] ${r.app} | ${title} | ${text} | ${new Date(r.when).toLocaleTimeString()} | ${r.reason}`);
    }
    return lines.join('\n');
}
function renderApps(value) {
    const lines = [];
    for (const app of value.apps) {
        lines.push(`${app.id} (${app.displayName}, ${app.packageName}) todo ${app.todoCount}`);
        for (const [capability, actions] of Object.entries(app.actions ?? {})) {
            const rendered = actions
                .map(spec => spec.params.length > 0
                ? `${spec.action}(${spec.params.join(', ')})`
                : `${spec.action}()`)
                .join(' | ');
            lines.push(`  ${capability}: ${rendered}`);
        }
    }
    if (value.todos.length > 0) {
        lines.push('todos:');
        for (const todo of value.todos) {
            lines.push(`- ${todo.app}/${todo.capability}: ${todo.feature} (${todo.note})`);
        }
    }
    return lines.length > 0 ? lines.join('\n') : 'no adapters registered';
}
function renderAppRun(value) {
    const status = value.ok ? 'ok' : 'failed';
    let text = `${value.app}/${value.capability}/${value.action}: ${status} - ${value.detail}`;
    if (value.sent !== undefined)
        text += `, sent=${value.sent}`;
    if (value.data)
        text += `, data=${JSON.stringify(value.data)}`;
    return text;
}
function renderConfirmations(value) {
    const lines = [
        `send mode: enabled=${value.enabled} dryRun=${value.dryRun} halted=${value.halted}`,
    ];
    if (value.pending.length === 0) {
        lines.push('nothing is waiting for approval');
        return lines.join('\n');
    }
    lines.push(`${value.pending.length} action(s) waiting for the owner:`);
    for (const action of value.pending) {
        lines.push(`- ${action.id} ${action.app}/${action.capability}/${action.method} ` +
            `(${action.reason}) args=${JSON.stringify(action.args).slice(0, 200)} ` +
            `expires ${action.expiresAt}`);
    }
    lines.push('The owner can run /confirm list, /confirm approve <id> or /confirm deny <id>.');
    return lines.join('\n');
}
