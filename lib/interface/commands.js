export function registerCommands(ctx, services) {
    const commands = ctx.get('commands');
    if (!commands)
        return;
    commands.register({
        name: 'fish',
        description: 'Give DQY a goal to execute autonomously on the phone',
        input: { hint: '<goal>' },
        handler: async (invocation) => {
            const result = await services.loop.run(invocation.rawInput.trim());
            return {
                kind: 'success',
                text: `${result.completed ? 'done' : 'stopped'} (${result.steps} steps): ${result.summary}`,
            };
        },
    });
    commands.register({
        name: 'signin',
        description: 'Run a daily sign-in task by app package or display name',
        input: { hint: '<app>' },
        handler: async (invocation) => {
            const app = invocation.rawInput.trim();
            const plan = services.signin
                .listPlans()
                .find(p => p.app === app || p.appName === app);
            if (plan) {
                const record = await services.signin.run(plan);
                return {
                    kind: 'success',
                    text: `${record.name}: ${record.lastStatus} - ${record.detail}`,
                };
            }
            for (const adapter of services.adapters.list()) {
                if ((adapter.id === app || adapter.displayName === app) &&
                    adapter.capabilities.has('signin')) {
                    const signin = services.adapters.getCapability(adapter.id, 'signin');
                    const result = await signin.signIn();
                    return {
                        kind: 'success',
                        text: `${adapter.displayName}: ${result.ok ? 'ok' : 'failed'} - ${result.detail}`,
                    };
                }
            }
            return {
                kind: 'error',
                text: `no plan or signin adapter for ${app}; use /fish for autonomous mode`,
            };
        },
    });
    commands.register({
        name: 'apps',
        description: 'List registered app adapters and their capabilities',
        handler: async () => {
            const lines = services.adapters.list().map(a => {
                const capabilities = [...a.capabilities].join(',');
                return `${a.id} (${a.displayName}, ${a.packageName}): [${capabilities}] todo=${a.todos.length}`;
            });
            return {
                kind: 'success',
                text: lines.length > 0
                    ? lines.join('\n')
                    : 'no adapters registered',
            };
        },
    });
    // Emergency stop: latches and blocks every outbound message immediately.
    commands.register({
        name: 'halt',
        description: 'Emergency stop all automatic sending',
        handler: async () => {
            services.runMode.halt();
            return { kind: 'success', text: 'halted: no message will be sent' };
        },
    });
    // Inspect or change the watch mode (enable / disable / dryrun / resume).
    commands.register({
        name: 'watch',
        description: 'Show or set the watch mode: enable, disable, dryrun, resume',
        input: { hint: '<action>' },
        handler: async (invocation) => {
            const raw = invocation.rawInput.trim();
            const [verb, ...rest] = raw.split(/\s+/);
            const action = (verb ?? '').toLowerCase();
            const argument = rest.join(' ').trim();
            switch (action) {
                case 'enable':
                    services.runMode.enable();
                    break;
                case 'disable':
                    services.runMode.disable();
                    break;
                case 'dryrun':
                    services.runMode.setDryRun(true);
                    break;
                case 'live':
                    services.runMode.setDryRun(false);
                    break;
                case 'resume':
                    services.runMode.resume();
                    break;
                case 'peer': {
                    // The hard part of the whitelist is remembering the package name and
                    // the exact key format; answer that instead of making the user look
                    // it up in the README.
                    if (!argument) {
                        return {
                            kind: 'error',
                            text: '用法：/watch peer <对方名>，例如 /watch peer 张三',
                        };
                    }
                    const qq = services.adapters
                        .list()
                        .find(adapter => adapter.id === 'qq');
                    const packageName = qq?.packageName ?? 'com.tencent.mobileqq';
                    return {
                        kind: 'success',
                        text: `把这一行加进 profile 的 control.allowedPeers：\n` +
                            `  - ${packageName}:${argument}\n` +
                            '格式是「包名:对方名」。改完重启 DSH 生效；不加白名单时她不会给任何人发消息。',
                    };
                }
                case '':
                    break;
                default:
                    return {
                        kind: 'error',
                        text: '未知动作；可用 enable、disable、dryrun、live、resume、peer <名字>',
                    };
            }
            const s = services.runMode.snapshot();
            return {
                kind: 'success',
                text: `${services.describePolicy()}\n\n当前：enabled=${s.enabled} dryRun=${s.dryRun} halted=${s.halted}`,
            };
        },
    });
    // Owner inbox: the only way an autonomy `confirm` action can ever run.
    // Deliberately NOT a tool: a prompt-injected model must not be able to
    // approve the action it just failed to execute.
    commands.register({
        name: 'confirm',
        description: 'List, approve or deny actions waiting for the owner (list|approve <id>|deny <id>)',
        input: { hint: '[list|approve <id>|deny <id>]' },
        handler: async (invocation) => {
            const raw = invocation.rawInput.trim();
            const [verb = 'list', id] = raw.split(/\s+/);
            if (verb === 'list' || verb === '') {
                const pending = services.confirmations.list();
                if (pending.length === 0) {
                    return {
                        kind: 'success',
                        text: '现在没有等她批准的动作。\n' +
                            '她不会自己批准，只有你能放行；想让她能自己说话，用 /watch enable 再 /watch live，' +
                            '并把常联系的人加进 control.allowedPeers。',
                    };
                }
                return {
                    kind: 'success',
                    text: `${pending.length} 个动作等她批准（只有你能批准）：\n` +
                        pending
                            .map(action => `${action.id} ${action.app}/${action.capability}/${action.method} ` +
                            `(${action.reason}) args=${JSON.stringify(action.args).slice(0, 160)}`)
                            .join('\n') +
                        '\n放行：/confirm approve <id>　丢弃：/confirm deny <id>',
                };
            }
            if (!id) {
                return {
                    kind: 'error',
                    text: `usage: /confirm ${verb} <id>`,
                };
            }
            if (verb === 'deny') {
                return services.confirmations.deny(id)
                    ? { kind: 'success', text: `denied ${id}` }
                    : {
                        kind: 'error',
                        text: `unknown or expired confirmation: ${id}`,
                    };
            }
            if (verb === 'approve') {
                const action = services.confirmations.take(id);
                if (!action) {
                    return {
                        kind: 'error',
                        text: `unknown or expired confirmation: ${id}`,
                    };
                }
                try {
                    return { kind: 'success', text: await services.approveAction(action) };
                }
                catch (err) {
                    return {
                        kind: 'error',
                        text: err instanceof Error ? err.message : String(err),
                    };
                }
            }
            return {
                kind: 'error',
                text: 'usage: /confirm [list|approve <id>|deny <id>]',
            };
        },
    });
    // Control the scrcpy mirror window: start, stop or inspect its status.
    commands.register({
        name: 'mirror',
        description: 'Start, stop or inspect the scrcpy phone mirror',
        input: { hint: '<start|stop|status>' },
        handler: async (invocation) => {
            const action = invocation.rawInput.trim().toLowerCase();
            if (action === 'start') {
                const r = await services.mirror.start();
                if (!r.ok) {
                    return { kind: 'error', text: r.error ?? 'mirror failed to start' };
                }
                return { kind: 'success', text: 'mirror starting' };
            }
            if (action === 'stop') {
                await services.mirror.stop();
                return { kind: 'success', text: 'mirror stopped' };
            }
            const s = services.mirror.getStatus();
            return {
                kind: 'success',
                text: `state=${String(s.state)} serial=${String(s.serial)} scrcpy=${String(s.scrcpy)}`,
            };
        },
    });
}
