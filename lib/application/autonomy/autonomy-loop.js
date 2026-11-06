// Canonical capability -> primary interface method name. Every CapabilityId
// is covered; if a port later gains a second method, extend this map.
export const DEFAULT_CAPABILITY_METHOD_MAP = {
    signin: 'signIn',
    feed: 'browseFeed',
    pet: 'feedPet',
    moment: 'publishMoment',
    social: 'mention',
    message: 'sendMessage',
    comment: 'comment',
    game: 'runGame',
    live: 'watchLive',
};
export class AutonomyLoop {
    deps;
    methodMap;
    constructor(deps) {
        this.deps = deps;
        this.methodMap = deps.capabilityMethodMap ?? DEFAULT_CAPABILITY_METHOD_MAP;
    }
    // One full heartbeat: collect -> decide -> grade -> act/confirm/skip -> learn.
    async runOnce() {
        let result;
        try {
            result = await this.tick();
        }
        catch (err) {
            result = {
                decided: false,
                executed: false,
                confirmed: false,
                skipped: true,
                error: err.message,
            };
        }
        await this.writeDiaryIfDue();
        return result;
    }
    // Idempotent per calendar day and fully error-isolated: a failing model
    // must never break the loop.
    async writeDiaryIfDue() {
        if (!this.deps.diary)
            return;
        try {
            await this.deps.diary.writeIfDue();
        }
        catch (err) {
            console.warn('[autonomy] diary failed:', err.message);
        }
    }
    async tick() {
        const bundle = await this.deps.signals.collect();
        const messages = [
            { role: 'system', content: this.systemPrompt() },
            { role: 'user', content: this.renderBundle(bundle) },
        ];
        // Prefer JSON-mode completion when the LLM supports it: constrained
        // output is faster and parses cleanly.
        const raw = this.deps.llm.chatJson
            ? await this.deps.llm.chatJson([...messages])
            : await this.deps.llm.chat([...messages]);
        let decision = null;
        try {
            decision = parseDecision(raw);
        }
        catch (err) {
            console.warn('[autonomy] bad LLM JSON, skip:', err.message);
            return {
                decided: false,
                executed: false,
                confirmed: false,
                skipped: true,
                error: 'parse_failed',
            };
        }
        // A self-directed goal is stored regardless of how the accompanying
        // action grades out: the agent is allowed to steer its own learning.
        if (decision.newGoal) {
            await this.rememberSelfGoal(decision.newGoal);
        }
        if (decision.intent === 'idle') {
            return {
                decided: true,
                executed: false,
                confirmed: false,
                skipped: false,
                decision,
                nextWakeMs: decision.nextWakeMs,
            };
        }
        // Validate: app registered, capability implemented, method known.
        const invalid = this.validate(decision);
        if (invalid) {
            console.warn('[autonomy] invalid decision, skip:', invalid, decision);
            return {
                decided: true,
                executed: false,
                confirmed: false,
                skipped: true,
                decision,
                error: invalid,
                nextWakeMs: decision.nextWakeMs,
            };
        }
        const app = decision.app;
        const capability = decision.capability;
        const method = this.methodMap[capability];
        const level = this.deps.policy.classify(app, capability, method);
        if (level === 'confirm') {
            await this.runConfirm(decision, app, capability, method);
            return {
                decided: true,
                executed: false,
                confirmed: true,
                skipped: false,
                decision,
                nextWakeMs: decision.nextWakeMs,
            };
        }
        const result = await this.execute(app, capability, method, decision.args);
        await this.learn(decision, result.ok ? 'ok' : 'failed', result.detail);
        return {
            decided: true,
            executed: result.ok,
            confirmed: false,
            skipped: !result.ok,
            decision,
            error: result.ok ? undefined : result.detail,
            nextWakeMs: decision.nextWakeMs,
        };
    }
    // Returns null when valid, otherwise a short reason string.
    validate(d) {
        if (!d.app || !d.capability || !d.method) {
            return 'missing app/capability/method';
        }
        let adapter;
        try {
            adapter = this.deps.registry.get(d.app);
        }
        catch (err) {
            return `app not registered: ${err.message}`;
        }
        if (!adapter.capabilities.has(d.capability)) {
            return `adapter ${d.app} does not implement ${d.capability}`;
        }
        const expected = this.methodMap[d.capability];
        if (!expected || d.method !== expected) {
            return `method ${d.method} not mapped for ${d.capability} (expected ${expected})`;
        }
        return null;
    }
    async execute(app, capability, method, args) {
        const capIface = this.deps.registry.getCapability(app, capability);
        const fn = capIface[method];
        if (typeof fn !== 'function') {
            return { ok: false, detail: `method ${method} missing on adapter` };
        }
        let raw;
        try {
            raw = await fn.call(capIface, args ?? {});
        }
        catch (err) {
            return { ok: false, detail: err.message };
        }
        return normalizeResult(raw);
    }
    // Self-authored goal from the LLM decision, stored as a 'goal' record so
    // later ticks see it in the memory bundle.
    async rememberSelfGoal(goal) {
        try {
            await this.deps.memory.remember({
                kind: 'goal',
                content: goal,
                tags: ['goal', 'self-directed'],
            });
        }
        catch (err) {
            console.warn('[autonomy] self goal write failed:', err.message);
        }
    }
    async runConfirm(decision, app, capability, method) {
        const reason = `needs human confirm: ${app}/${capability}/${method}`;
        try {
            if (this.deps.confirm) {
                await this.deps.confirm.confirmRequired(decision, reason);
            }
            else {
                console.warn('[autonomy] confirm required but no hook:', reason);
            }
        }
        catch (err) {
            console.warn('[autonomy] confirm hook failed:', err.message);
        }
        await this.learn(decision, 'confirm_pending', reason);
    }
    // Simple concat-style lesson (no second LLM call per heartbeat).
    async learn(decision, outcome, detail) {
        try {
            await this.deps.memory.remember({
                kind: 'lesson',
                content: `autonomy ${outcome}: ${decision.app}/${decision.capability}/${decision.method} | reason=${decision.reason} | detail=${detail}`,
                tags: ['lesson', 'autonomy'],
            });
        }
        catch (err) {
            console.warn('[autonomy] lesson write failed:', err.message);
        }
    }
    systemPrompt() {
        return [
            'You are an autonomous phone assistant that wakes on a heartbeat.',
            'Based on the signal bundle, decide whether to act or stay idle.',
            'Reply with STRICT JSON only, no prose, no markdown fences.',
            'Schema:',
            '- idle: {"intent":"idle","reason":"short why"}',
            '- act: {"intent":"act","app":"<adapter id>","capability":"<one of: signin|feed|pet|moment|social|message|comment|game|live>","method":"<interface method name>","args":{...},"reason":"short why"}',
            'Rules:',
            '- Only pick an app/capability that is actually registered (you will be told which in the bundle).',
            '- Match the method name exactly to the capability, e.g. moment->publishMoment, signin->signIn, feed->browseFeed, pet->feedPet, social->mention, message->sendMessage, comment->comment, game->runGame, live->watchLive.',
            '- Argument keys per capability: feed->{"count":N}; moment->{"text":"..."}; message->{"text":"...","peer":"..."}; social->{"peer":"...","text":"..."}; signin/pet/game/live->{} or their natural inputs.',
            '- When nothing urgent is happening, choose idle.',
            '- Do not invent apps or capabilities; an invalid choice is silently dropped.',
            '- Optional field "nextWakeMs" (positive integer milliseconds): how long YOU want before the next heartbeat. Omit or 0 to let the system pick. If something interesting just happened and you want to check again soon, set a small value; if quiet, set a large value.',
            'Self-directed learning (you are in charge of your own growth):',
            '- You may add "newGoal":"<short goal>" to ANY decision (idle included). It is stored as your own goal and appears in later bundles. Use it to set a learning goal, change priorities, or plan what to practice next. Do this only when it genuinely helps, not every round.',
            '- Avoid repeating the same capability every round. Prefer variety among registered apps/capabilities you have not used recently; deliberate practice is better than grinding one action.',
            '- If memory shows repeated failures on the same action, do not retry blindly: change the approach, pick a different practice target, or stay idle and note a new plan in newGoal.',
            '- Your diary and distilled strategies carry across days; reuse them and refine them.',
        ].join('\n');
    }
    renderBundle(bundle) {
        const lines = [];
        lines.push(`now: ${bundle.now}`);
        const apps = this.deps.registry.list()
            .map(a => `${a.id} (${[...a.capabilities].join(', ')})`)
            .join(' | ');
        lines.push(`registered apps: ${apps || '(none)'}`);
        lines.push('notifications:');
        lines.push(bundle.notifications.length ? bundle.notifications.map(n => `- ${n}`).join('\n') : '- (none)');
        lines.push('memory:');
        lines.push(bundle.memory.length ? bundle.memory.map(m => `- ${m}`).join('\n') : '- (none)');
        return lines.join('\n');
    }
}
// Adapters may return either a canonical AdapterResult ({ok, detail}) or a
// legacy domain object (e.g. FeedSession {app,watched,liked,finishedAt}) with
// no `ok` field. Treat a returned object without `ok` as success and use a
// truncated JSON dump as the detail, so legacy shapes don't get mis-recorded
// as failures.
function normalizeResult(raw) {
    if (raw && typeof raw === 'object') {
        const rec = raw;
        if (typeof rec.ok === 'boolean') {
            return {
                ok: rec.ok,
                detail: typeof rec.detail === 'string' ? rec.detail : '',
                data: rec.data ?? undefined,
            };
        }
        // Legacy shape: no ok field => treat as success.
        let summary = '';
        try {
            summary = JSON.stringify(rec);
        }
        catch {
            summary = String(raw);
        }
        if (summary.length > 200)
            summary = summary.slice(0, 200) + '…';
        return { ok: true, detail: `legacy-result: ${summary}` };
    }
    if (raw === undefined || raw === null) {
        return { ok: true, detail: '(no return value)' };
    }
    return { ok: true, detail: String(raw) };
}
function parseDecision(raw) {
    const trimmed = raw.trim();
    // Strip ```json fences if the model wraps the object.
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    const body = fenced ? fenced[1] : trimmed;
    const obj = JSON.parse(body);
    if (obj.intent !== 'act' && obj.intent !== 'idle') {
        throw new Error(`bad intent: ${String(obj.intent)}`);
    }
    if (typeof obj.reason !== 'string') {
        throw new Error('missing reason');
    }
    return {
        intent: obj.intent,
        app: typeof obj.app === 'string' ? obj.app : undefined,
        capability: obj.capability,
        method: typeof obj.method === 'string' ? obj.method : undefined,
        args: obj.args && typeof obj.args === 'object'
            ? obj.args
            : {},
        reason: obj.reason,
        nextWakeMs: sanitizeNextWake(obj.nextWakeMs),
        newGoal: sanitizeNewGoal(obj.newGoal),
    };
}
function sanitizeNewGoal(v) {
    if (typeof v !== 'string')
        return undefined;
    const trimmed = v.trim();
    if (trimmed.length < 5)
        return undefined;
    return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}
// Accept any finite number (including 0 / negatives); the scheduler layer
// clamps into [min, max]. Only drop non-numbers / NaN / Infinity / missing.
function sanitizeNextWake(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return undefined;
    return v;
}
