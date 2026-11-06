export function registerCommands(ctx, services) {
    const commands = ctx.get('commands');
    if (!commands)
        return;
    commands.register({
        name: 'fish',
        description: 'Give Blue Fat Fish a goal to execute autonomously on the phone',
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
            const action = invocation.rawInput.trim().toLowerCase();
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
                case '':
                    break;
                default:
                    return {
                        kind: 'error',
                        text: 'unknown action; use enable, disable, dryrun, live or resume',
                    };
            }
            const s = services.runMode.snapshot();
            return {
                kind: 'success',
                text: `enabled=${s.enabled} dryRun=${s.dryRun} halted=${s.halted}`,
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
